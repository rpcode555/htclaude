import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ''),
    ...loadEnv(mode, path.resolve(process.cwd(), '..'), ''),
    ...process.env,
  };

  const firebaseEnv = {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY || ''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN || ''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || ''),
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || env.FIREBASE_STORAGE_BUCKET || ''),
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID || ''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || ''),
    'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': JSON.stringify(env.VITE_FIREBASE_MEASUREMENT_ID || env.FIREBASE_MEASUREMENT_ID || ''),
    'import.meta.env.VITE_ADMIN_EMAIL': JSON.stringify(env.VITE_ADMIN_EMAIL || env.ADMIN_EMAIL || ''),
    'import.meta.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE || env.API_BASE || '/api'),
  };

  const apiTarget = env.VITE_API_TARGET || env.API_TARGET || `http://localhost:${env.PORT || 5000}`;

  return {
    define: firebaseEnv,
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
