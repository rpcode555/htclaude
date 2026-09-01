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
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
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
      const testContent = `Admin diagnostic test ping from Hightech Claude at ${new Date().toISOString()}`;
      const testFile = new File([testContent], 'admin_diagnostic_ping.txt', { type: 'text/plain' });

      const data = await api.uploadFilesWithProgress([testFile], null);
      if (data.success) {
        setTestResult(`✅ Test file uploaded to Storage Channel! Message ID: #${data.files?.[0]?.telegram_msg_id || 'N/A'}`);
        await onRefreshData();
      } else {
        setTestResult(`❌ Test upload failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setTestResult(`❌ Connection error: ${err.message}`);
    } finally {
      setTestingUpload(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-transparent p-4 sm:p-6 space-y-6 select-none animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg shadow-rose-600/25 shrink-0">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                HT Claude Admin Center
              </h2>
              <span className="badge-rose text-[10px] font-bold px-2 py-0.5 rounded-full border">
                SYSTEM LIVE
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Upload &bull; Store &bull; Share &bull; Cloud Infrastructure
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefreshData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-rose-500" />
            <span>Refresh Metrics</span>
          </button>

          {currentUser && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/80 text-rose-600 dark:text-rose-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors cursor-pointer"
              title="Close Admin Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Admin User Profile Banner */}
      {currentUser && (
        <div className="glass-panel p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-gradient-to-r from-rose-50/50 via-white to-red-50/40 dark:from-rose-950/20 dark:via-gray-900/60 dark:to-gray-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500 to-red-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
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
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                  {currentUser.displayName || 'Authenticated Administrator'}
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  Firebase Verified
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                <span>{currentUser.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
            <div className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400">UID: </span>
              <span className="text-gray-800 dark:text-gray-200">{currentUser.uid.slice(0, 12)}...</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400">Provider: </span>
              <span className="text-rose-600 dark:text-rose-400 capitalize font-bold">
                {currentUser.providerData[0]?.providerId.replace('.com', '') || 'password'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Telegram Bot & Backend Health */}
        <div className="glass-card p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500">
                <Send className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Cloud Storage Backend</h3>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Bot Username</span>
              <a
                href="https://t.me/claudestorage_bot"
                target="_blank"
                rel="noreferrer"
                className="text-rose-600 dark:text-rose-400 font-semibold hover:underline flex items-center gap-1"
              >
                <span>@claudestorage_bot</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Storage Target</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Connected (Cloud Channel)
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Backend API</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                /api/v1 (Operational)
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Credential Storage</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <Lock className="w-3 h-3" /> Encrypted (.env)
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Firebase Auth Configuration */}
        <div className="glass-card p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-500">
                <Flame className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Firebase Auth System</h3>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
              v10 SDK
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Project ID</span>
              <span className="text-gray-800 dark:text-gray-200 font-mono font-medium">
                melodic-keyword-374810
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Auth Domain</span>
              <span className="text-gray-800 dark:text-gray-200 font-mono text-[11px]">
                melodic-keyword-374810.firebaseapp.com
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Auth Providers</span>
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                Google &bull; Email/Password
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Firebase Console</span>
              <a
                href="https://console.firebase.google.com/project/melodic-keyword-374810/authentication"
                target="_blank"
                rel="noreferrer"
                className="text-amber-600 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1"
              >
                <span>Manage Users</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Card 3: Storage Analytics */}
        <div className="glass-card p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/60 flex items-center justify-center text-purple-500">
                <HardDrive className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Storage Overview</h3>
            </div>
            <span className="text-rose-600 dark:text-rose-400 font-mono font-bold text-xs">
              {formatBytes(stats?.totalSize || 0)}
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Total Files</span>
              <span className="text-gray-900 dark:text-white font-bold font-mono">{stats?.totalFiles || 0} files</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Total Folders</span>
              <span className="text-gray-900 dark:text-white font-mono">{stats?.totalFolders || 0}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Recycle Bin</span>
              <span className="text-rose-600 dark:text-rose-400 font-mono font-semibold">{stats?.trashCount || 0} items</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Starred Items</span>
              <span className="text-amber-500 font-mono font-semibold">{stats?.starredCount || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Diagnostic & Quick Actions Panel */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-rose-500" />
          <span>Diagnostic & Quick Actions</span>
        </h3>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleTestChannel}
            disabled={testingUpload}
            className="btn-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{testingUpload ? 'Pinging Storage...' : 'Test Upload & Ping Storage'}</span>
          </button>

          <button
            onClick={onEmptyTrash}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Empty Recycle Bin</span>
          </button>

          <a
            href="https://t.me/claudestorage_bot"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-rose-500" />
            <span>Open Storage Channel Bot</span>
          </a>
        </div>

        {testResult && (
          <div className="p-3.5 rounded-xl bg-gray-950 border border-gray-800 text-xs font-mono text-gray-200 animate-fade-in">
            {testResult}
          </div>
        )}
      </div>
    </div>
  );
}
