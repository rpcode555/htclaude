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
  Moon,
  Sun,
  Palette,
} from 'lucide-react';
import { api } from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useTheme } from '../context/ThemeContext';

export default function SettingsModal({ authStatus, onClose, onRefreshStatus }) {
  const confirm = useConfirm();
  const { theme, isDark, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState(
    authStatus?.authType === 'bot' ? 'bot' : 'saved_messages'
  );

  // User Account Form State
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password2FA, setPassword2FA] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);

  // Bot Form State
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 md:p-6 animate-fade-in select-none">
      <div className="glass-modal w-full max-w-2xl rounded-3xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl bg-white dark:bg-gray-900">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-900/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Cloud & System Settings</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Manage storage, theme, and backend configuration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 px-6 pt-3 gap-2 overflow-x-auto">
          <button
            onClick={() => {
              setActiveTab('bot');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'bot'
                ? 'border-rose-500 text-rose-600 dark:text-rose-400 bg-white dark:bg-gray-900'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Telegram Bot & Channel</span>
            {isBotConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
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
                ? 'border-rose-500 text-rose-600 dark:text-rose-400 bg-white dark:bg-gray-900'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Saved Messages (MTProto)</span>
            {isUserConnected && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse ml-1" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('appearance');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'appearance'
                ? 'border-rose-500 text-rose-600 dark:text-rose-400 bg-white dark:bg-gray-900'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Appearance / Theme</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[65vh] space-y-5">
          {/* Alerts */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: TELEGRAM BOT & CHANNEL */}
          {activeTab === 'bot' && (
            <div className="space-y-4">
              {isBotConnected ? (
                <div className="p-5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <span>Bot & Channel Connected</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold">
                            Active
                          </span>
                        </h4>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-mono mt-0.5">
                          @{authStatus?.user?.username || 'claudestorage_bot'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnect}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-semibold border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs space-y-2 text-gray-600 dark:text-gray-300">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Target Storage:</span>
                      <span className="text-rose-600 dark:text-rose-400 font-medium">
                        {authStatus?.user?.target ? 'Connected Cloud Channel' : 'Connected Storage Channel'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Security Mode:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Encrypted in Backend (.env)
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All file uploads from the web app are securely sent to your private storage channel. You can also send files directly to <strong>@{authStatus?.user?.username || 'claudestorage_bot'}</strong> on Telegram!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                      <Cloud className="w-4 h-4 text-rose-500" />
                      <span>Connect Telegram Bot & Channel:</span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400">
                      Credentials submitted here are stored securely on the backend server and are never exposed to browser clients.
                    </p>
                  </div>

                  <form onSubmit={handleConnectBot} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Bot Token</label>
                      <input
                        type="password"
                        required
                        placeholder="Paste your Telegram Bot Token"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Target Storage Channel ID
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. -100xxxxxxxxxx"
                        value={botChatId}
                        onChange={(e) => setBotChatId(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold cursor-pointer"
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
                <div className="p-5 rounded-2xl bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-900/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-500">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                          Connected as {authStatus.user.firstName}
                        </h4>
                        <p className="text-xs text-rose-600 dark:text-rose-400">
                          Target: {authStatus.user.target}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnect}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 dark:text-rose-300 text-xs font-semibold border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                    >
                      Disconnect
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All uploaded files are being stored directly in your personal Telegram <strong>"Saved Messages"</strong> chat with up to 2GB per file!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                      <Info className="w-4 h-4 text-rose-500" />
                      <span>How to get Telegram API ID & Hash:</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-gray-500 dark:text-gray-400 pl-1">
                      <li>
                        Visit{' '}
                        <a
                          href="https://my.telegram.org/auth"
                          target="_blank"
                          rel="noreferrer"
                          className="text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 font-medium"
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
                          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">API ID</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 12345678"
                            value={apiId}
                            onChange={(e) => setApiId(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">API Hash</label>
                          <input
                            type="password"
                            required
                            placeholder="e.g. 0123456789abcdef0123456789abcdef"
                            value={apiHash}
                            onChange={(e) => setApiHash(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Phone Number (with country code)
                        </label>
                        <input
                          type="tel"
                          required
                          placeholder="e.g. +1234567890"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold cursor-pointer"
                      >
                        {loading ? 'Sending Code...' : 'Send Verification Code'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-4 animate-fade-in">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Enter Verification Code (sent to your Telegram app)
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. 12345"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                        />
                      </div>

                      {requires2FA && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Two-Step Verification Password (2FA)
                          </label>
                          <input
                            type="password"
                            placeholder="Enter 2FA Password"
                            value={password2FA}
                            onChange={(e) => setPassword2FA(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCodeSent(false)}
                          className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={loading}
                          className="btn-primary flex-1 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
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

          {/* TAB 3: APPEARANCE & THEME */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 space-y-3">
                <h4 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Palette className="w-4 h-4 text-rose-500" />
                  <span>Theme Selection</span>
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Choose between sleek Light Mode or deep Dark Mode.
                </p>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => { if (isDark) toggleTheme(); }}
                    className={`p-4 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                      !isDark
                        ? 'border-rose-500 bg-rose-50/50 text-rose-700 font-bold shadow-sm'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    <Sun className="w-6 h-6 text-amber-500" />
                    <span className="text-xs">Light Mode (Default)</span>
                  </button>

                  <button
                    onClick={() => { if (!isDark) toggleTheme(); }}
                    className={`p-4 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                      isDark
                        ? 'border-rose-500 bg-rose-950/40 text-rose-300 font-bold shadow-sm'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    <Moon className="w-6 h-6 text-rose-400" />
                    <span className="text-xs">Dark Mode</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="btn-secondary px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
