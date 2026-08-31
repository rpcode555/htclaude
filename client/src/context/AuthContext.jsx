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

export const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [configuredAdminEmail, setConfiguredAdminEmail] = useState(ADMIN_EMAIL);

  useEffect(() => {
    // Fetch live backend config to sync dynamic whitelist without hardcoded secrets
    fetch('/api/config/firebase')
      .then((r) => r.json())
      .then((config) => {
        if (config.adminEmail) {
          setConfiguredAdminEmail(config.adminEmail.toLowerCase());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const targetAdmin = (configuredAdminEmail || ADMIN_EMAIL || '').toLowerCase();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.email && targetAdmin && user.email.toLowerCase() === targetAdmin) {
          setCurrentUser(user);
          setAuthError('');
        } else if (!targetAdmin) {
          // If no admin email is configured yet, allow authenticated user to proceed
          setCurrentUser(user);
          setAuthError('');
        } else {
          // Reject unauthorized user immediately
          console.warn(`[Security] Unauthorized access attempt by: ${user.email}`);
          await signOut(auth);
          setCurrentUser(null);
          setAuthError(`Access Denied: ${user.email} is not authorized. Only the administrator can access this private storage.`);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [configuredAdminEmail]);

  // Email/Password Signin with strict whitelist validation
  const loginWithEmail = async (email, password) => {
    setAuthError('');
    const targetAdmin = (configuredAdminEmail || ADMIN_EMAIL || '').toLowerCase();

    if (targetAdmin && email.trim().toLowerCase() !== targetAdmin) {
      throw new Error(`Access Denied: Only the administrator is authorized to access this private system.`);
    }

    const res = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (targetAdmin && res.user.email.toLowerCase() !== targetAdmin) {
      await signOut(auth);
      throw new Error(`Access Denied: You are not authorized.`);
    }
    return res;
  };

  // Email/Password Signup (only permitted for the admin email)
  const signupWithEmail = async (email, password, displayName = '') => {
    setAuthError('');
    const targetAdmin = (configuredAdminEmail || ADMIN_EMAIL || '').toLowerCase();

    if (targetAdmin && email.trim().toLowerCase() !== targetAdmin) {
      throw new Error(`Registration Denied: Only the administrator is authorized.`);
    }

    const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName && res.user) {
      await updateProfile(res.user, { displayName });
    }
    return res;
  };

  // Google Sign-In with strict whitelist check
  const loginWithGoogle = async () => {
    setAuthError('');
    const res = await signInWithPopup(auth, googleProvider);
    if (!res.user.email || res.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      const attemptedEmail = res.user.email || 'unknown';
      await signOut(auth);
      throw new Error(`Access Denied: Account (${attemptedEmail}) is not authorized. Please log in with ${ADMIN_EMAIL}.`);
    }
    return res;
  };

  // Signout
  const logout = () => {
    setAuthError('');
    return signOut(auth);
  };

  // Password Reset
  const resetPassword = (email) => {
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      throw new Error(`Password reset is only permitted for ${ADMIN_EMAIL}.`);
    }
    return sendPasswordResetEmail(auth, email.trim());
  };

  const isAuthorized = currentUser && currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const value = {
    currentUser,
    loading,
    isAuthorized,
    authError,
    setAuthError,
    adminEmail: ADMIN_EMAIL,
    signupWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
