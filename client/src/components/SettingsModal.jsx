import React, { useState } from 'react';
import {
  X,
  Send,
  Cloud,
  Shield,
  Key,
  Smartphone,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Trash2,
  RefreshCw,
  Server,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useTheme } from '../context/ThemeContext';

export default function SettingsModal({ authStatus, onClose, onRefreshStatus }) {
  const confirm = useConfirm();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState(
    authStatus?.authType === 'bot' ? 'bot' : 'saved_messages'
  );

  // User Account Form State (Cleaned - no hardcoded credentials)
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password2FA, setPassword2FA] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);

  // Bot Form State (Empty by default for maximum security)
  const [botToken, setBotToken] = useState('');
  const [botChatId, setBotChatId] = useState('');

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Send Phone Code Handler
  const handleSendCode = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.sendPhoneCode(apiId.trim(), apiHash.trim(), phoneNumber.trim());
      if (res.success) {
        setCodeSent(true);
        setSuccessMsg(res.message || 'Verification code sent to your Telegram app!');
      } else {
        setErrorMsg(res.error || 'Failed to send verification code.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send code.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Verify Code Handler
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.verifyPhoneCode(otpCode.trim(), password2FA);
      if (res.requires2FA) {
        setRequires2FA(true);
        setErrorMsg('Please enter your Two-Step Verification (2FA) password.');
      } else if (res.success) {
        setSuccessMsg('Successfully connected to Telegram Saved Messages!');
        await onRefreshStatus();
      } else {
        setErrorMsg(res.error || 'Invalid code.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Connect Bot Handler
  const handleConnectBot = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.connectBot(botToken.trim(), botChatId.trim());
      if (res.success) {
        setSuccessMsg(`Successfully connected as @${res.bot.username}!`);
        await onRefreshStatus();
        setBotToken('');
      } else {
        setErrorMsg(res.error || 'Failed to connect bot.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Bot connection failed.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Disconnect Handler
  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Storage',
      message: 'Are you sure you want to disconnect Telegram Cloud Storage? The app will revert to Sandbox Demo mode.',
      confirmText: 'Disconnect',
      variant: 'warning',
    });
    if (ok) {
      setLoading(true);
      try {
        await api.disconnect();
        await onRefreshStatus();
        setSuccessMsg('Disconnected from Telegram. Now using Sandbox Mode.');
        setCodeSent(false);
      } catch (err) {
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const isUserConnected = authStatus?.authType === 'saved_messages';
  const isBotConnected = authStatus?.authType === 'bot' && authStatus?.hasCredentials?.hasBotToken;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 md:p-6 animate-fade-in">
      <div className="glass-modal w-full max-w-2xl rounded-3xl flex flex-col overflow-hidden border border-slate-700/80 shadow-2xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Telegram Cloud Settings</h3>
              <p className="text-[11px] text-slate-400">Manage your secure cloud storage backend</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800/80 bg-slate-950/40 px-6 pt-3 gap-2">
          <button
            onClick={() => {
              setActiveTab('bot');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'bot'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Telegram Bot & Channel</span>
            {isBotConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('saved_messages');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'saved_messages'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Saved Messages (MTProto)</span>
            {isUserConnected && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse ml-1" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('sandbox');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'sandbox'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Sandbox Mode</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[65vh] space-y-5">
          {/* Alerts */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: TELEGRAM BOT & CHANNEL MODE */}
          {activeTab === 'bot' && (
            <div className="space-y-4">
              {isBotConnected ? (
                <div className="p-5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-500/10">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>Bot & Channel Connected</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        </h4>
                        <p className="text-xs text-emerald-300/90 font-mono mt-0.5">
                          @{authStatus?.user?.username || 'claudestorage_bot'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnect}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-2 text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Target Storage:</span>
                      <span className="text-cyan-400 font-medium">
                        {authStatus?.user?.target ? 'Connected Cloud Channel' : 'Connected Storage Channel'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Security Mode:</span>
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Encrypted in Backend (.env)
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400">
                    All file uploads from the web app are securely sent to your private storage channel. You can also send files directly to <strong>@{authStatus?.user?.username || 'claudestorage_bot'}</strong> on Telegram!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-100">
                      <Cloud className="w-4 h-4 text-emerald-400" />
                      <span>Connect Telegram Bot & Channel:</span>
                    </div>
                    <p className="text-slate-400">
                      Credentials submitted here are stored securely on the backend server and are never exposed to browser clients.
                    </p>
                  </div>

                  <form onSubmit={handleConnectBot} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Bot Token</label>
                      <input
                        type="password"
                        required
                        placeholder="Paste your Telegram Bot Token"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        Target Storage Channel ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. -100xxxxxxxxxx"
                        value={botChatId}
                        onChange={(e) => setBotChatId(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 transition-all cursor-pointer"
                    >
                      {loading ? 'Testing & Connecting...' : 'Connect Telegram Bot'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SAVED MESSAGES (MTProto) */}
          {activeTab === 'saved_messages' && (
            <div className="space-y-5">
              {isUserConnected ? (
                <div className="p-5 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Connected as {authStatus.user.firstName}
                        </h4>
                        <p className="text-xs text-cyan-300/80">
                          Target: {authStatus.user.target}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnect}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold border border-red-500/30 transition-colors cursor-pointer"
                    >
                      Disconnect
                    </button>
                  </div>

                  <p className="text-xs text-slate-400">
                    All uploaded files are being stored directly in your personal Telegram <strong>"Saved Messages"</strong> chat with up to 2GB per file!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-100">
                      <Info className="w-4 h-4 text-cyan-400" />
                      <span>How to get Telegram API ID & Hash:</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1">
                      <li>
                        Visit{' '}
                        <a
                          href="https://my.telegram.org/auth"
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          my.telegram.org <ExternalLink className="w-3 h-3" />
                        </a>{' '}
                        and log in with your phone number.
                      </li>
                      <li>Go to <strong>API development tools</strong>.</li>
                      <li>Create a new application (e.g. "Hightech Claude").</li>
                      <li>Paste your <strong>API ID</strong> and <strong>API Hash</strong> below.</li>
                    </ol>
                  </div>

                  {!codeSent ? (
                    <form onSubmit={handleSendCode} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-300">API ID</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 12345678"
                            value={apiId}
                            onChange={(e) => setApiId(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-300">API Hash</label>
                          <input
                            type="password"
                            required
                            placeholder="e.g. 0123456789abcdef0123456789abcdef"
                            value={apiHash}
                            onChange={(e) => setApiHash(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">
                          Phone Number (with country code)
                        </label>
                        <input
                          type="tel"
                          required
                          placeholder="e.g. +1234567890"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition-all cursor-pointer"
                      >
                        {loading ? 'Sending Code...' : 'Send Verification Code'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-4 animate-fade-in">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">
                          Enter Verification Code (sent to your Telegram app)
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. 12345"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                        />
                      </div>

                      {requires2FA && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-300">
                            Two-Step Verification Password (2FA)
                          </label>
                          <input
                            type="password"
                            placeholder="Enter 2FA Password"
                            value={password2FA}
                            onChange={(e) => setPassword2FA(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCodeSent(false)}
                          className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={loading}
                          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition-all cursor-pointer"
                        >
                          {loading ? 'Verifying...' : 'Verify & Connect Saved Messages'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SANDBOX / DEMO MODE */}
          {activeTab === 'sandbox' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-slate-300 space-y-3">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <Server className="w-4 h-4" />
                  <span>Sandbox Demo Mode</span>
                </div>
                <p className="text-slate-400">
                  In Sandbox mode, all file uploads, media players, streaming, folder nesting, and tag features work locally inside your server directory without connecting Telegram.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Close Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
