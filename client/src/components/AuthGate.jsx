import React, { useState } from 'react';
import {
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthGate() {
  const { loginWithGoogle, authError, setAuthError } = useAuth();
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const displayError = localError || authError;

  const handleGoogleSignIn = async () => {
    setLocalError('');
    setAuthError('');
    setLoading(true);

    try {
      await loginWithGoogle();
    } catch (err) {
      console.error('[Google Auth Error]:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setLocalError(err.message || 'Google sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[var(--bg-app)] text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-gradient-to-tr from-cyan-600/15 via-blue-600/10 to-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-sm relative z-10 space-y-6">
        {/* Brand Header with New Official Logo */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-1.5 rounded-3xl bg-white/5 border border-white/10 shadow-2xl shadow-cyan-500/20 backdrop-blur-xl animate-float">
            <img
              src="/logo.png"
              alt="HT Claude Logo"
              className="w-24 h-24 rounded-2xl object-cover"
            />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-black text-white tracking-wider" style={{ fontFamily: 'Poppins, sans-serif' }}>
                HT CLAUDE
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                PRO
              </span>
            </div>
            <p className="text-[11px] font-bold tracking-widest text-cyan-400 uppercase mt-0.5">
              Upload &bull; Store &bull; Share
            </p>
          </div>
        </div>

        {/* Auth Glass Card */}
        <div className="glass-modal rounded-3xl p-6 border border-slate-700/80 shadow-2xl space-y-4 bg-[var(--bg-card)] backdrop-blur-2xl">
          {/* Security Alert if unauthorized */}
          {displayError && (
            <div className="p-3.5 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{displayError}</span>
            </div>
          )}

          {/* Single Action: Sign In with Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/60 text-white text-xs font-bold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-lg hover:shadow-cyan-500/20 group transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                <span>Authenticating with Google...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.5s.7 4.8 1.9 7.2l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.8-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 17C3.7 20.7 7.5 23.5 12 23.5z"
                  />
                </svg>
                <span>Sign In with Google</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
