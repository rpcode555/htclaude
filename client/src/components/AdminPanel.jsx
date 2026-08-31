import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  Server,
  Cloud,
  Send,
  Database,
  Users,
  HardDrive,
  Activity,
  Lock,
  ExternalLink,
  Trash2,
  RefreshCw,
  LogOut,
  Check,
  CheckCircle2,
  AlertTriangle,
  Key,
  Flame,
  User,
  Mail,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatBytes, formatDate } from '../utils';

export default function AdminPanel({
  stats,
  authStatus,
  onRefreshData,
  onEmptyTrash,
  onClose,
}) {
  const { currentUser, logout } = useAuth();
  const [testingUpload, setTestingUpload] = useState(false);
  const [testResult, setTestResult] = useState('');

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleTestChannel = async () => {
    setTestingUpload(true);
    setTestResult('');
    try {
      const formData = new FormData();
      const testContent = `Admin diagnostic test ping from Hightech Claude at ${new Date().toISOString()}`;
      formData.append('files', new Blob([testContent], { type: 'text/plain' }), 'admin_diagnostic_ping.txt');

      const token = currentUser ? await currentUser.getIdToken() : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(`✅ Test file uploaded to Telegram Channel! Message ID: #${data.files[0]?.telegram_msg_id || 'N/A'}`);
        await onRefreshData();
      } else {
        setTestResult(`❌ Test upload failed: ${data.error}`);
      }
    } catch (err) {
      setTestResult(`❌ Connection error: ${err.message}`);
    } finally {
      setTestingUpload(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-transparent p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 p-1 flex items-center justify-center shadow-xl shadow-cyan-500/20 shrink-0">
            <img
              src="/logo.png"
              alt="HT Claude Logo"
              className="w-full h-full rounded-xl object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white tracking-wide" style={{ fontFamily: 'Poppins, sans-serif' }}>
                HT CLAUDE ADMIN CENTER
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                SYSTEM LIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Upload &bull; Store &bull; Share &bull; Telegram Cloud Infrastructure
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefreshData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Refresh Metrics</span>
          </button>

          {currentUser && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>

      {/* Admin User Profile Banner */}
      {currentUser && (
        <div className="glass-panel p-5 rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-blue-950/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold text-lg">
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Admin'}
                  className="w-full h-full rounded-2xl object-cover"
                />
              ) : (
                (currentUser.displayName || currentUser.email || 'A')[0].toUpperCase()
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">
                  {currentUser.displayName || 'Authenticated Administrator'}
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Firebase Verified
                </span>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>{currentUser.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-slate-500">UID: </span>
              <span className="text-slate-300">{currentUser.uid.slice(0, 12)}...</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-slate-500">Provider: </span>
              <span className="text-cyan-400 capitalize">
                {currentUser.providerData[0]?.providerId.replace('.com', '') || 'password'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Telegram Bot & Backend Health */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Send className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-100">Telegram Bot Backend</h3>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Bot Username</span>
              <a
                href="https://t.me/claudestorage_bot"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 font-semibold hover:underline flex items-center gap-1"
              >
                <span>@claudestorage_bot</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Storage Target</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Connected (Cloud Channel)
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Backend API</span>
              <span className="text-emerald-400 font-mono font-medium">
                http://localhost:5000/api
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Credential Storage</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <Lock className="w-3 h-3" /> Encrypted (.env)
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Firebase Auth Configuration */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Flame className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-100">Firebase Auth System</h3>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              v10 SDK
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Project ID</span>
              <span className="text-slate-200 font-mono font-medium">
                melodic-keyword-374810
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Auth Domain</span>
              <span className="text-slate-200 font-mono text-[11px]">
                melodic-keyword-374810.firebaseapp.com
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Auth Providers</span>
              <span className="text-cyan-400 font-medium">
                Google &bull; Email/Password
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Firebase Console</span>
              <a
                href="https://console.firebase.google.com/project/melodic-keyword-374810/authentication"
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 font-semibold hover:underline flex items-center gap-1"
              >
                <span>Manage Users</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Card 3: Storage Analytics */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <HardDrive className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-100">Storage Overview</h3>
            </div>
            <span className="text-cyan-400 font-mono font-bold text-xs">
              {formatBytes(stats?.totalSize || 0)}
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Total Files</span>
              <span className="text-white font-bold font-mono">{stats?.totalFiles || 0} files</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Total Folders</span>
              <span className="text-white font-mono">{stats?.totalFolders || 0}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Recycle Bin</span>
              <span className="text-red-400 font-mono font-semibold">{stats?.trashCount || 0} items</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
              <span className="text-slate-400">Starred Items</span>
              <span className="text-amber-400 font-mono font-semibold">{stats?.starredCount || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Diagnostic & Quick Actions Panel */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Diagnostic & Quick Actions</span>
        </h3>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleTestChannel}
            disabled={testingUpload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{testingUpload ? 'Pinging Storage...' : 'Test Upload & Ping Storage'}</span>
          </button>

          <button
            onClick={onEmptyTrash}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Empty Recycle Bin</span>
          </button>

          <a
            href="https://t.me/claudestorage_bot"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open @claudestorage_bot in Telegram</span>
          </a>
        </div>

        {testResult && (
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 animate-fade-in">
            {testResult}
          </div>
        )}
      </div>
    </div>
  );
}
