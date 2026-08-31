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

export const ADMIN_EMAIL = 'palranjan144@gmail.com';

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          setCurrentUser(user);
          setAuthError('');
        } else {
          // Reject unauthorized user immediately
          console.warn(`[Security] Unauthorized access attempt by: ${user.email}`);
          await signOut(auth);
          setCurrentUser(null);
          setAuthError(`Access Denied: ${user.email} is not authorized. Only ${ADMIN_EMAIL} can access this private storage.`);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Email/Password Signin with strict whitelist validation
  const loginWithEmail = async (email, password) => {
    setAuthError('');
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      throw new Error(`Access Denied: Only ${ADMIN_EMAIL} is authorized to access this private system.`);
    }

    const res = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (res.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await signOut(auth);
      throw new Error(`Access Denied: Only ${ADMIN_EMAIL} is authorized.`);
    }
    return res;
  };

  // Email/Password Signup (only permitted for the admin email)
  const signupWithEmail = async (email, password, displayName = '') => {
    setAuthError('');
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      throw new Error(`Registration Denied: Only ${ADMIN_EMAIL} is authorized.`);
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
