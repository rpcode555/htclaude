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
  const verifyBackendAdmin = async (user) => {
    if (!user) {
      setCurrentUser(null);
      setIsAdmin(false);
      return false;
    }

    try {
      const idToken = await user.getIdToken();
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
        return true;
      }

      // If user's verified Google account is palranjan144@gmail.com, grant access even if serverless endpoint is cold-starting
      const isOwner = (user.email || '').trim().toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase();
      if (isOwner && (!res || res.status >= 500 || res.status === 404)) {
        console.log('[Auth] Owner account recognized, granting access:', user.email);
        setCurrentUser(user);
        setIsAdmin(true);
        setAuthError('');
        return true;
      }

      // Not authorized as admin
      const errorMsg = data?.error || `Access Denied: Account (${user.email}) is not authorized. Only the verified administrator can access this storage.`;
      console.warn(`[Security Alert] Unauthorized account attempted login: ${user.email} - ${errorMsg}`);
      await signOut(auth);
      setCurrentUser(null);
      setIsAdmin(false);
      setAuthError(errorMsg);
      return false;
    } catch (err) {
      console.error('[Auth Error] Failed to verify credentials with server:', err);
      const isOwner = (user.email || '').trim().toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase();
      if (isOwner) {
        console.log('[Auth] Owner authenticated despite network delay:', user.email);
        setCurrentUser(user);
        setIsAdmin(true);
        setAuthError('');
        return true;
      }
      setCurrentUser(null);
      setIsAdmin(false);
      setAuthError('Authentication verification failed. Please try again.');
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
