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
  Database,
  Terminal,
} from 'lucide-react';
import { api } from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useTheme } from '../context/ThemeContext';

export default function SettingsModal({ authStatus, onClose, onRefreshStatus }) {
  const confirm = useConfirm();
  const { theme, isDark, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('saved_messages');

  // MTProto Form State
  const [loginMethod, setLoginMethod] = useState('phone'); // 'phone' | 'session'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password2FA, setPassword2FA] = useState('');
  const [sessionStringInput, setSessionStringInput] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sentToPhone, setSentToPhone] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Send Phone Code Handler
  const handleSendCode = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    let rawPhone = phoneNumber.trim().replace(/[\s\-()]/g, '');
    if (!rawPhone) {
      setErrorMsg('Please enter your mobile phone number.');
      setLoading(false);
      return;
    }

    // Auto prepend country code if not present
    let formattedPhone = rawPhone;
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.startsWith('0')) formattedPhone = formattedPhone.substring(1);
      formattedPhone = `${countryCode}${formattedPhone}`;
    }

    try {
      const res = await api.sendPhoneCode(formattedPhone, apiId.trim() || null, apiHash.trim() || null);
      if (res.success) {
        setCodeSent(true);
        setSentToPhone(formattedPhone);
        if (res.phoneCodeHash) {
          setPhoneCodeHash(res.phoneCodeHash);
        }
        setSuccessMsg(res.message || `Verification code sent to Telegram for ${formattedPhone}!`);
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
      const res = await api.verifyPhoneCode(
        otpCode.trim(),
        password2FA,
        phoneCodeHash,
        sentToPhone || phoneNumber
      );
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

  // 3. Connect via Session String Handler
  const handleConnectSession = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await api.connectSessionString(sessionStringInput.trim(), apiId.trim() || null, apiHash.trim() || null);
      if (res.success) {
        setSuccessMsg(`Successfully connected to Telegram Saved Messages!`);
        await onRefreshStatus();
      } else {
        setErrorMsg(res.error || 'Failed to connect using session string.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Connection failed.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Backup Database Handler
  const handleBackupDb = async () => {
    setBackingUp(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await api.backupDatabase();
      if (res.success) {
        setSuccessMsg('Database snapshot backed up to Telegram Saved Messages!');
      } else {
        setErrorMsg(res.error || 'Failed to backup database.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  };

  // 5. Disconnect Handler
  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Saved Messages',
      message: 'Are you sure you want to disconnect Telegram Saved Messages? The app will revert to Sandbox Demo mode.',
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
        setPhoneCodeHash('');
      } catch (err) {
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const isUserConnected = authStatus?.authType === 'saved_messages' && authStatus?.connected;

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
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Manage Telegram Saved Messages storage & system preferences</p>
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
            <span>Telegram Saved Messages</span>
            {isUserConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
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

          {/* TAB 1: SAVED MESSAGES (MTProto) */}
          {activeTab === 'saved_messages' && (
            <div className="space-y-5">
              {isUserConnected ? (
                <div className="p-5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <span>Connected as {authStatus?.user?.firstName || 'Telegram User'}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold">
                            Active
                          </span>
                        </h4>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-mono mt-0.5">
                          {authStatus?.user?.username ? `@${authStatus.user.username}` : (authStatus?.user?.phone || 'Saved Messages')}
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
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">
                        Telegram Saved Messages (me)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Upload Limit:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        Unlimited (Auto-chunked MTProto streaming)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Real-Time Sync:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        Active (Files dropped in Telegram app appear here)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleBackupDb}
                      disabled={backingUp}
                      className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>{backingUp ? 'Backing Up...' : 'Backup Database to Saved Messages'}</span>
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All file uploads from the web app or API are saved directly to your private <strong>Saved Messages</strong> chat.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                      <Smartphone className="w-4 h-4 text-rose-500" />
                      <span>Instant Telegram Saved Messages Login:</span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400">
                      Enter your mobile number below. You will receive an official login OTP in your Telegram app to securely link your unlimited cloud storage.
                    </p>
                  </div>

                  {/* Toggle between Phone Login and Session String */}
                  <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setLoginMethod('phone')}
                      className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                        loginMethod === 'phone'
                          ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Phone Number (OTP)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginMethod('session')}
                      className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                        loginMethod === 'session'
                          ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Direct Session String
                    </button>
                  </div>

                  {loginMethod === 'phone' ? (
                    !codeSent ? (
                      <form onSubmit={handleSendCode} className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center justify-between">
                            <span>Telegram Mobile Number</span>
                            <span className="text-[10px] text-gray-400 font-normal">Fast 1-Click Login</span>
                          </label>

                          <div className="flex gap-2">
                            {/* Country Code Dropdown */}
                            <select
                              value={countryCode}
                              onChange={(e) => setCountryCode(e.target.value)}
                              className="h-11 px-3 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none cursor-pointer"
                            >
                              <option value="+91">🇮🇳 +91 (India)</option>
                              <option value="+1">🇺🇸 +1 (US/CA)</option>
                              <option value="+44">🇬🇧 +44 (UK)</option>
                              <option value="+971">🇦🇪 +971 (UAE)</option>
                              <option value="+61">🇦🇺 +61 (AU)</option>
                              <option value="+65">🇸🇬 +65 (SG)</option>
                              <option value="+49">🇩🇪 +49 (DE)</option>
                              <option value="+33">🇫🇷 +33 (FR)</option>
                              <option value="+7">🇷🇺 +7 (RU)</option>
                              <option value="+880">🇧🇩 +880 (BD)</option>
                              <option value="+977">🇳🇵 +977 (NP)</option>
                              <option value="+92">🇵🇰 +92 (PK)</option>
                            </select>

                            {/* 10-Digit Mobile Input */}
                            <input
                              type="tel"
                              required
                              placeholder="Enter mobile number (e.g. 9876543210)"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9+]/g, ''))}
                              className="flex-1 h-11 px-3.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm font-semibold text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none tracking-wide"
                            />
                          </div>

                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            A verification code will be sent to your official Telegram app for this number.
                          </p>
                        </div>

                        {/* Optional Advanced Toggle for custom API ID/Hash */}
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <span>{showAdvanced ? '− Hide Custom API ID & Hash' : '+ Custom API ID & Hash (Optional)'}</span>
                          </button>

                          {showAdvanced && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2.5 animate-fade-in">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">Custom API ID</label>
                                <input
                                  type="text"
                                  placeholder="Leave empty for default"
                                  value={apiId}
                                  onChange={(e) => setApiId(e.target.value)}
                                  className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">Custom API Hash</label>
                                <input
                                  type="password"
                                  placeholder="Leave empty for default"
                                  value={apiHash}
                                  onChange={(e) => setApiHash(e.target.value)}
                                  className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-rose-500/20"
                        >
                          {loading ? 'Sending Verification Code...' : 'Send Verification Code'}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleVerifyCode} className="space-y-4 animate-fade-in">
                        <div className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between">
                          <span>Code sent to: <strong>{sentToPhone || phoneNumber}</strong></span>
                          <button
                            type="button"
                            onClick={() => { setCodeSent(false); setOtpCode(''); setPhoneCodeHash(''); }}
                            className="text-[11px] text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer"
                          >
                            Change
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Enter Verification Code (from Telegram app)
                          </label>
                          <input
                            type="text"
                            required
                            autoFocus
                            placeholder="e.g. 12345"
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            className="w-full h-11 px-3.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-base font-mono font-bold tracking-widest text-center text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                          />
                        </div>

                        {requires2FA && (
                          <div className="space-y-1.5 animate-fade-in">
                            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                              Two-Step Verification Password (2FA)
                            </label>
                            <input
                              type="password"
                              placeholder="Enter your 2FA cloud password"
                              value={password2FA}
                              onChange={(e) => setPassword2FA(e.target.value)}
                              className="w-full h-11 px-3.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                            />
                          </div>
                        )}

                        <div className="flex gap-2.5">
                          <button
                            type="button"
                            onClick={() => { setCodeSent(false); setOtpCode(''); setPhoneCodeHash(''); }}
                            className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Back
                          </button>
                          <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary flex-1 py-2.5 rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-rose-500/20"
                          >
                            {loading ? 'Verifying...' : 'Verify & Connect'}
                          </button>
                        </div>
                      </form>
                    )
                  ) : (
                    <form onSubmit={handleConnectSession} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Telegram GramJS Session String
                        </label>
                        <textarea
                          required
                          rows={3}
                          placeholder="Paste your base64 GramJS session string..."
                          value={sessionStringInput}
                          onChange={(e) => setSessionStringInput(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs font-mono text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none resize-none"
                        />
                      </div>

                      {/* Optional Advanced Toggle for custom API ID/Hash */}
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>{showAdvanced ? '− Hide Custom API ID & Hash' : '+ Custom API ID & Hash (Optional)'}</span>
                        </button>

                        {showAdvanced && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2.5 animate-fade-in">
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">Custom API ID</label>
                              <input
                                type="text"
                                placeholder="Leave empty for default"
                                value={apiId}
                                onChange={(e) => setApiId(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">Custom API Hash</label>
                              <input
                                type="password"
                                placeholder="Leave empty for default"
                                value={apiHash}
                                onChange={(e) => setApiHash(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-rose-500/20"
                      >
                        {loading ? 'Authenticating...' : 'Connect With Session String'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: APPEARANCE & THEME */}
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
