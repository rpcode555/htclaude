// Firebase Client - Dynamic Backend Initializer
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

// Default fallback config (in case offline or direct build)
const fallbackConfig = {
  apiKey: "AIzaSyBB_iq8REPny3J2f98oRtQe-og4rUIzm9Q",
  authDomain: "melodic-keyword-374810.firebaseapp.com",
  projectId: "melodic-keyword-374810",
  storageBucket: "melodic-keyword-374810.firebasestorage.app",
  messagingSenderId: "880421799981",
  appId: "1:880421799981:web:fc089f2727874529d110a4",
  measurementId: "G-E8DKCLKW09",
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(fallbackConfig) : getApp();
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Fetch live backend config to ensure sync
if (typeof window !== 'undefined') {
  fetch('/api/config/firebase')
    .then((r) => r.json())
    .then((backendConfig) => {
      if (backendConfig.apiKey && backendConfig.apiKey !== fallbackConfig.apiKey) {
        console.log('[Security] Synced Firebase configuration from backend environment.');
      }
    })
    .catch(() => {});
}

// Initialize Analytics conditionally
let analytics = null;
if (typeof window !== 'undefined') {
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
