import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { apiUrl } from '../apiConfig';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

const DEFAULT_ADMIN_EMAIL = 'palranjan144@gmail.com';

// Statuses that mean "the backend could not answer right now": cold starts,
// rate limits, gateway/timeout hiccups or a route that does not exist (wrong API
// base). None of them may be interpreted as a successful verification.
const UNAVAILABLE_STATUSES = new Set([
  404, 408, 425, 429, 500, 502, 503, 504, 507, 509, 520, 521, 522, 523, 524,
]);

const ADMIN_FLAG_KEY = 'htc_admin_auth';

function writeAdminFlag() {
  try {
    localStorage.setItem(ADMIN_FLAG_KEY, 'true');
  } catch (e) {}
}

function clearAdminFlag() {
  try {
    localStorage.removeItem(ADMIN_FLAG_KEY);
  } catch (e) {}
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Mirrors authError so async login helpers can surface the real reason.
  const authErrorRef = useRef('');

  // True only while the backend has confirmed *this* account during *this* page
  // session. The localStorage flag is deliberately not trusted for
  // authorization: a stale or hand-edited flag must never grant admin access.
  const serverVerifiedRef = useRef(false);

  const setError = (message = '') => {
    authErrorRef.current = message;
    setAuthError(message);
  };

  /** Backend confirmed the account: full access. */
  const grantAccess = (user) => {
    serverVerifiedRef.current = true;
    writeAdminFlag();
    setCurrentUser(user);
    setIsAdmin(true);
    setError('');
    return true;
  };

  /** Backend answered, but access is refused. */
  const denyAccess = async (message, { signOutUser = false } = {}) => {
    clearAdminFlag();
    serverVerifiedRef.current = false;
    setCurrentUser(null);
    setIsAdmin(false);
    setError(message);
    if (signOutUser && auth) {
      try {
        await signOut(auth);
      } catch (e) {
        console.warn('[Auth] signOut failed:', e.message);
      }
    }
    return false;
  };

  /**
   * Backend is temporarily unable to confirm the account.
   * Sessions that are already authorized (the hard-coded owner, or an account the
   * backend verified during this page session) stay usable; everyone else is
   * denied without any escalation.
   */
  const handleUnavailable = (user, isOwner, reason) => {
    if (isOwner || serverVerifiedRef.current) {
      console.log(`[Auth] Preserving already authorized session (${reason})`);
      setCurrentUser(user);
      setIsAdmin(true);
      setError('');
      return true;
    }
    setCurrentUser(null);
    setIsAdmin(false);
    setError(
      `Storage service is temporarily unavailable (${reason}). Your account was not changed — please retry in a moment.`
    );
    return false;
  };

  // Authenticate user against backend admin verification endpoint
  const verifyBackendAdmin = async (user, isRetry = false) => {
    if (!user) {
      serverVerifiedRef.current = false;
      setCurrentUser(null);
      setIsAdmin(false);
      return false;
    }

    const userEmail = (user.email || '').trim().toLowerCase();
    const isOwner = userEmail === DEFAULT_ADMIN_EMAIL.toLowerCase();

    // Keep an already authorized session usable while verification is in flight
    if (isOwner || serverVerifiedRef.current) {
      setCurrentUser(user);
      setIsAdmin(true);
    }

    let idToken = '';
    try {
      // Force refresh the token when this is a retry after 401/403
      idToken = await user.getIdToken(isRetry);
    } catch (err) {
      console.warn('[Auth] Could not obtain a Firebase ID token:', err.message);
      if (!isRetry) return verifyBackendAdmin(user, true);
      return handleUnavailable(user, isOwner, 'identity token unavailable');
    }

    let res;
    try {
      res = await fetch(apiUrl('/auth/me'), {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      });
    } catch (err) {
      console.warn('[Auth] Network error verifying credentials with server:', err.message);
      return handleUnavailable(user, isOwner, 'network error');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // Non-JSON body (e.g. an HTML error page) — handled by the status checks.
    }

    if (res.ok && data?.success && data?.user?.isAdmin) {
      return grantAccess(user);
    }

    // Token expired/revoked: retry exactly once with a force-refreshed token.
    if ((res.status === 401 || res.status === 403) && !isRetry) {
      console.log('[Auth] Token renewal required, retrying with force-refreshed token...');
      return verifyBackendAdmin(user, true);
    }

    // Serverless cold start, rate limit, gateway error or missing route:
    // never escalate, only preserve what is already authorized.
    if (UNAVAILABLE_STATUSES.has(res.status)) {
      return handleUnavailable(user, isOwner, `server responded ${res.status}`);
    }

    if (res.status === 401 || res.status === 403) {
      // The hard-coded owner account is the app's own guarantee and must never be
      // locked out by a misrouted or flaky backend. Any other account is denied:
      // a server that answers 401/403 has made a decision, not failed to answer.
      if (isOwner) {
        console.warn(`[Auth] Owner account received ${res.status}; keeping the owner session.`);
        setCurrentUser(user);
        setIsAdmin(true);
        setError('');
        return true;
      }

      if (res.status === 403) {
        // Authenticated, but not on the administrator whitelist.
        const errorMsg =
          data?.error ||
          `Access Denied: Account (${user.email || 'user'}) is not authorized. Only the verified administrator can access this storage.`;
        console.warn(`[Security Alert] Unauthorized account attempted login: ${user.email} - ${errorMsg}`);
        return denyAccess(errorMsg, { signOutUser: true });
      }

      // A brand-new token was still rejected, so the session itself is invalid.
      return denyAccess('Your session has expired or was revoked. Please sign in again.', {
        signOutUser: true,
      });
    }

    // Any other unexpected answer (400, 405, malformed body, ...): fail closed.
    if (isOwner || serverVerifiedRef.current) {
      console.warn(`[Auth] Unexpected verification response (${res.status}); keeping existing session.`);
      setCurrentUser(user);
      setIsAdmin(true);
      setError('');
      return true;
    }
    return denyAccess(data?.error || `Sign-in verification failed (server responded ${res.status}).`);
  };

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          await verifyBackendAdmin(user);
        } else {
          serverVerifiedRef.current = false;
          setCurrentUser(null);
          setIsAdmin(false);
        }
      } catch (err) {
        console.error('[Auth] Unexpected error during verification:', err);
        serverVerifiedRef.current = false;
        setCurrentUser(null);
        setIsAdmin(false);
        setError(err?.message || 'Authentication verification failed.');
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  // Email/Password Signin
  const loginWithEmail = async (email, password) => {
    setError('');
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify configuration.');

    const res = await signInWithEmailAndPassword(auth, email.trim(), password);
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      throw new Error(authErrorRef.current || 'Access Denied: Account is not authorized to access this storage.');
    }
    return res;
  };

  // Email/Password Signup (authorized accounts only)
  const signupWithEmail = async (email, password, displayName = '') => {
    setError('');
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify configuration.');

    const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName && res.user) {
      await updateProfile(res.user, { displayName });
    }
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      throw new Error(authErrorRef.current || 'Registration Denied: Account is not authorized.');
    }
    return res;
  };

  // Google Sign-In
  const loginWithGoogle = async () => {
    setError('');
    if (!auth || !googleProvider) {
      throw new Error('Google Sign-In is not initialized. Please verify Firebase environment variables.');
    }

    const res = await signInWithPopup(auth, googleProvider);
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      const attemptedEmail = res.user?.email || 'unknown';
      throw new Error(
        authErrorRef.current || `Access Denied: Account (${attemptedEmail}) is not authorized.`
      );
    }
    return res;
  };

  // Signout
  const logout = () => {
    setError('');
    setIsAdmin(false);
    setCurrentUser(null);
    serverVerifiedRef.current = false;
    clearAdminFlag();
    if (!auth) return Promise.resolve();
    return signOut(auth);
  };

  // Password Reset
  const resetPassword = (email) => {
    if (!auth) throw new Error('Firebase Auth is not initialized.');
    return sendPasswordResetEmail(auth, email.trim());
  };

  const isAuthorized = !!currentUser && isAdmin;

  const value = {
    currentUser,
    loading,
    isAuthorized,
    authError,
    setAuthError: setError,
    signupWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
