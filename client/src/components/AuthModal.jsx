import React, { useState } from 'react';
import {
  X,
  Lock,
  Mail,
  User,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Send,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isForgotPassword, setIsForgotPassword] = useState(false);

  const { loginWithEmail, signupWithEmail, loginWithGoogle, resetPassword } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isForgotPassword) {
        await resetPassword(email.trim());
        setMessage('Password reset email sent! Check your inbox.');
        setLoading(false);
        return;
      }

      if (isSignUp) {
        await signupWithEmail(email.trim(), password, displayName.trim());
      } else {
        await loginWithEmail(email.trim(), password);
      }

      if (onAuthSuccess) onAuthSuccess();
      onClose();
    } catch (err) {
      console.error('[Auth Error]:', err);
      let errMsg = err.message;
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        errMsg = 'Invalid email or password. Please check your credentials.';
      } else if (err.code === 'auth/email-already-in-use') {
        errMsg = 'An account with this email already exists. Try signing in instead.';
      } else if (err.code === 'auth/weak-password') {
        errMsg = 'Password must be at least 6 characters long.';
      } else if (err.code === 'auth/popup-closed-by-user') {
        errMsg = 'Google sign-in was cancelled.';
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setMessage('');
    setLoading(true);

    try {
      await loginWithGoogle();
      if (onAuthSuccess) onAuthSuccess();
      onClose();
    } catch (err) {
      console.error('[Google Auth Error]:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-fade-in">
      <div className="glass-modal w-full max-w-md rounded-3xl overflow-hidden border border-slate-700/80 shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/25">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {isForgotPassword
                  ? 'Reset Password'
                  : isSignUp
                  ? 'Create Admin Account'
                  : 'Admin Authentication'}
              </h3>
              <p className="text-xs text-slate-400">Hightech Claude Secure Cloud</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error / Success Feedback */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        {/* Google 1-Click Sign-In */}
        {!isForgotPassword && (
          <>
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm hover:border-slate-600"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
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
              <span>Continue with Google</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                Or with email
              </span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
          </>
        )}

        {/* Email / Password Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isSignUp && !isForgotPassword && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Display Name</label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Admin User"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-100 focus:border-cyan-500 outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Email Address</label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
              <input
                type="email"
                required
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-100 focus:border-cyan-500 outline-none"
              />
            </div>
          </div>

          {!isForgotPassword && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">Password</label>
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(true)}
                  className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-100 focus:border-cyan-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : isForgotPassword ? (
              <span>Send Reset Instructions</span>
            ) : isSignUp ? (
              <span>Create Account</span>
            ) : (
              <span>Sign In to Admin Panel</span>
            )}
          </button>
        </form>

        {/* Footer Toggle */}
        <div className="text-center pt-1 text-xs text-slate-400 border-t border-slate-800/80">
          {isForgotPassword ? (
            <button
              onClick={() => {
                setIsForgotPassword(false);
                setError('');
                setMessage('');
              }}
              className="text-cyan-400 hover:underline font-semibold cursor-pointer"
            >
              Back to Sign In
            </button>
          ) : isSignUp ? (
            <p>
              Already have an account?{' '}
              <button
                onClick={() => {
                  setIsSignUp(false);
                  setError('');
                }}
                className="text-cyan-400 hover:underline font-semibold cursor-pointer"
              >
                Sign In
              </button>
            </p>
          ) : (
            <p>
              Need an account?{' '}
              <button
                onClick={() => {
                  setIsSignUp(true);
                  setError('');
                }}
                className="text-cyan-400 hover:underline font-semibold cursor-pointer"
              >
                Create Account
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
