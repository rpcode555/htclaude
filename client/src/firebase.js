// Firebase Client - Dynamic Initializer with Environment Variable Overrides & Safe Fallback
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Firebase Web Client Public Configuration (Overrides from VITE_FIREBASE_* if present)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBB_iq8REPny3J2f98oRtQe-og4rUIzm9Q",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "melodic-keyword-374810.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "melodic-keyword-374810",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "melodic-keyword-374810.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "880421799981",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:880421799981:web:fc089f2727874529d110a4",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-E8DKCLKW09",
};

// Safely initialize Firebase App
let app = null;
let auth = null;
let googleProvider = null;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
} catch (err) {
  console.error('[Firebase Init Error]:', err);
}

// Initialize Analytics conditionally
let analytics = null;
if (typeof window !== 'undefined' && app) {
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {});
}

export {
  app,
  auth,
  googleProvider,
  analytics,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
};
