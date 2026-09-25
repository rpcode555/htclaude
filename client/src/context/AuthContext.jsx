import React, { createContext, useContext, useState, useEffect } from 'react';
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

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

const DEFAULT_ADMIN_EMAIL = 'palranjan144@gmail.com';

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Authenticate user against backend admin verification endpoint
  const verifyBackendAdmin = async (user, isRetry = false) => {
    if (!user) {
      setCurrentUser(null);
      setIsAdmin(false);
      return false;
    }

    const userEmail = (user.email || '').trim().toLowerCase();
    const isOwner = userEmail === DEFAULT_ADMIN_EMAIL.toLowerCase();
    const wasPreviouslyVerified = localStorage.getItem('htc_admin_auth') === 'true';

    // Optimistically maintain state for verified owners or existing sessions
    if (isOwner || wasPreviouslyVerified) {
      setCurrentUser(user);
      setIsAdmin(true);
    }

    try {
      // Force refresh token if this is a retry after 401/403
      const idToken = await user.getIdToken(isRetry);
      const res = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {}

      if (res.ok && data?.success && data?.user?.isAdmin) {
        setCurrentUser(user);
        setIsAdmin(true);
        setAuthError('');
        localStorage.setItem('htc_admin_auth', 'true');
        return true;
      }

      // If token expired (401 or 403) and we haven't retried with a fresh token yet, force refresh!
      if ((res.status === 401 || res.status === 403) && !isRetry) {
        console.log('[Auth] Token renewal required, retrying with force-refreshed token...');
        return await verifyBackendAdmin(user, true);
      }

      // If serverless is cold-starting (5xx/404), rate-limited (429), or user is owner, maintain active session
      if (isOwner || res.status >= 500 || res.status === 429 || res.status === 404 || res.status === 504) {
        console.log('[Auth] Preserving authorized session despite server status:', res.status);
        setCurrentUser(user);
        setIsAdmin(true);
        setAuthError('');
        localStorage.setItem('htc_admin_auth', 'true');
        return true;
      }

      // ONLY sign out if explicitly confirmed unauthorized from an unapproved external account
      if (res.status === 403 && !isOwner) {
        const errorMsg = data?.error || `Access Denied: Account (${user.email || 'user'}) is not authorized. Only the verified administrator can access this storage.`;
        console.warn(`[Security Alert] Unauthorized account attempted login: ${user.email} - ${errorMsg}`);
        localStorage.removeItem('htc_admin_auth');
        await signOut(auth);
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthError(errorMsg);
        return false;
      }

      // Keep previously verified state if transient error occurred
      if (wasPreviouslyVerified || isOwner) {
        setCurrentUser(user);
        setIsAdmin(true);
        return true;
      }

      setCurrentUser(null);
      setIsAdmin(false);
      return false;
    } catch (err) {
      console.warn('[Auth] Network error verifying credentials with server:', err.message);
      if (isOwner || wasPreviouslyVerified) {
        console.log('[Auth] Owner/Admin authenticated despite network delay:', user.email);
        setCurrentUser(user);
        setIsAdmin(true);
        setAuthError('');
        return true;
      }
      setCurrentUser(null);
      setIsAdmin(false);
      setAuthError('Authentication verification failed due to network. Please retry.');
      return false;
    }
  };

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await verifyBackendAdmin(user);
      } else {
        setCurrentUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);



  // Email/Password Signin
  const loginWithEmail = async (email, password) => {
    setAuthError('');
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify configuration.');

    const res = await signInWithEmailAndPassword(auth, email.trim(), password);
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      throw new Error('Access Denied: Account is not authorized to access this storage.');
    }
    return res;
  };

  // Email/Password Signup (authorized accounts only)
  const signupWithEmail = async (email, password, displayName = '') => {
    setAuthError('');
    if (!auth) throw new Error('Firebase Auth is not initialized. Please verify configuration.');

    const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName && res.user) {
      await updateProfile(res.user, { displayName });
    }
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      throw new Error('Registration Denied: Account is not authorized.');
    }
    return res;
  };

  // Google Sign-In
  const loginWithGoogle = async () => {
    setAuthError('');
    if (!auth || !googleProvider) {
      throw new Error('Google Sign-In is not initialized. Please verify Firebase environment variables.');
    }

    const res = await signInWithPopup(auth, googleProvider);
    const authorized = await verifyBackendAdmin(res.user);
    if (!authorized) {
      const attemptedEmail = res.user?.email || 'unknown';
      throw new Error(`Access Denied: Account (${attemptedEmail}) is not authorized.`);
    }
    return res;
  };

  // Signout
  const logout = () => {
    setAuthError('');
    setIsAdmin(false);
    setCurrentUser(null);
    localStorage.removeItem('htc_admin_auth');
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
    setAuthError,
    signupWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
