import React, { useState, useEffect } from 'react';
import {
  Key,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Code2,
  Terminal,
  Globe,
  Send,
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  ArrowLeft,
  Calendar,
  Clock,
  HardDrive,
  FileText,
  Film,
  Music,
  Archive,
  Download,
  FileCode,
  Smartphone,
  Server,
  Monitor,
  X,
} from 'lucide-react';
import { api } from '../api';
import { formatDate, formatBytes } from '../utils';

import { useConfirm } from '../context/ConfirmContext';

export default function DeveloperSection({ onRefreshStorage, onFileClick }) {
  const confirm = useConfirm();
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New key form fields
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyPurpose, setNewKeyPurpose] = useState('web');
  const [newKeyValidity, setNewKeyValidity] = useState('never');

  // Key detail inspection state
  const [selectedKeyRecord, setSelectedKeyRecord] = useState(null);
  const [keyFilesData, setKeyFilesData] = useState(null);
  const [loadingKeyFiles, setLoadingKeyFiles] = useState(false);
  const [keyFileCategory, setKeyFileCategory] = useState('all');

  const [copiedKeyId, setCopiedKeyId] = useState(null);
  const [copiedUrlId, setCopiedUrlId] = useState(null);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [selectedLanguage, setSelectedLanguage] = useState('js'); // 'js' | 'nodejs' | 'python' | 'curl' | 'html'
  const [selectedKeyForSnippet, setSelectedKeyForSnippet] = useState('');

  // Domain configuration
  const [customDomainInput, setCustomDomainInput] = useState('');
  const [useCustomDomain, setUseCustomDomain] = useState(false);

  // Playground tester states
  const [testFile, setTestFile] = useState(null);
  const [testUploading, setTestUploading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  const loadKeys = async () => {
    try {
      setLoading(true);
      const res = await api.getApiKeys();
      if (res.success) {
        setApiKeys(res.keys);
        if (res.keys.length > 0 && !selectedKeyForSnippet) {
          setSelectedKeyForSnippet(res.keys[0].key);
        }
      }
    } catch (err) {
      console.error('[DeveloperSection] loadKeys error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  // Load files for inspected key
  const loadKeyFiles = async (keyItem) => {
    try {
      setLoadingKeyFiles(true);
      setSelectedKeyRecord(keyItem);
      const res = await api.getApiKeyFiles(keyItem.id);
      if (res.success) {
        setKeyFilesData(res);
      }
    } catch (err) {
      console.error('[DeveloperSection] loadKeyFiles error:', err);
    } finally {
      setLoadingKeyFiles(false);
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createApiKey({
        name: newKeyName.trim(),
        purpose: newKeyPurpose,
        validity: newKeyValidity,
      });
      if (res.success) {
        setNewKeyName('');
        setNewKeyPurpose('web');
        setNewKeyValidity('never');
        setShowCreateModal(false);
        await loadKeys();
        setSelectedKeyForSnippet(res.key.key);
      }
    } catch (err) {
      alert(`Failed to create API key: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (keyItem) => {
    const nextStatus = keyItem.status === 'active' ? 'revoked' : 'active';
    try {
      await api.updateApiKey(keyItem.id, { status: nextStatus });
      await loadKeys();
      if (selectedKeyRecord && selectedKeyRecord.id === keyItem.id) {
        setSelectedKeyRecord((prev) => ({ ...prev, status: nextStatus }));
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteKey = async (id, name) => {
    const ok = await confirm({
      title: 'Delete API Key',
      message: `Are you sure you want to delete API key "${name}"? External websites or apps using this key will immediately lose upload access.`,
      confirmText: 'Delete API Key',
      variant: 'danger',
    });
    if (ok) {
      try {
        await api.deleteApiKey(id);
        if (selectedKeyRecord && selectedKeyRecord.id === id) {
          setSelectedKeyRecord(null);
          setKeyFilesData(null);
        }
        await loadKeys();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleCopyKey = (keyRecord) => {
    navigator.clipboard.writeText(keyRecord.key);
    setCopiedKeyId(keyRecord.id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleCopyDirectUrl = (fileId, url) => {
    navigator.clipboard.writeText(url);
    setCopiedUrlId(fileId);
    setTimeout(() => setCopiedUrlId(null), 2000);
  };

  const handleDeleteKeyFile = async (fileId, fileName) => {
    const ok = await confirm({
      title: 'Delete File',
      message: `Are you sure you want to delete "${fileName}"? It will be moved to the Recycle Bin.`,
      confirmText: 'Delete File',
      variant: 'danger',
    });
    if (ok) {
      try {
        await api.batchAction('trash', [fileId]);
        if (selectedKeyRecord) {
          await loadKeyFiles(selectedKeyRecord);
        }
        if (onRefreshStorage) onRefreshStorage();
      } catch (err) {
        alert(`Failed to delete file: ${err.message}`);
      }
    }
  };

  const toggleRevealKey = (id) => {
    setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Active key string used in code snippets
  const activeKeyStr = selectedKeyForSnippet || (apiKeys[0]?.key) || 'htc_live_YOUR_API_KEY_HERE';

  // Dynamic Base URL detection (Localhost vs Production / Vercel vs Custom Domain)
  const defaultBaseUrl =
    typeof window !== 'undefined'
      ? window.location.port === '3000'
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : window.location.origin
      : 'https://your-domain.com';

  const effectiveBaseUrl = useCustomDomain && customDomainInput.trim()
    ? (customDomainInput.trim().startsWith('http') ? customDomainInput.trim().replace(/\/+$/, '') : `https://${customDomainInput.trim().replace(/\/+$/, '')}`)
    : defaultBaseUrl;

  const apiEndpointUrl = `${effectiveBaseUrl}/api/v1/upload`;

  const getPurposeBadge = (purpose) => {
    switch (purpose) {
      case 'web':
        return { label: 'Web App', icon: Globe, color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
      case 'mobile':
        return { label: 'Mobile App', icon: Smartphone, color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'backend':
        return { label: 'Backend Server', icon: Server, color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
      case 'desktop':
        return { label: 'Desktop App', icon: Monitor, color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
      default:
        return { label: 'General / API', icon: Code2, color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' };
    }
  };

  // Code snippets generator
  const getCodeSnippet = () => {
    switch (selectedLanguage) {
      case 'js':
        return `// 🌐 JavaScript / React / Next.js / Vue
async function uploadImage(imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch('${apiEndpointUrl}', {
    method: 'POST',
    headers: {
      'X-API-Key': '${activeKeyStr}'
    },
    body: formData
  });

  const data = await response.json();
  if (data.success) {
    console.log('Direct Image URL:', data.file.direct_url);
    return data.file.direct_url;
  }
}`;

      case 'nodejs':
        return `// ⚡ Node.js (Axios + form-data)
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function uploadToHTClaude(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  const response = await axios.post('${apiEndpointUrl}', form, {
    headers: {
      ...form.getHeaders(),
      'X-API-Key': '${activeKeyStr}'
    }
  });

  console.log('Uploaded successfully!', response.data.file.direct_url);
  return response.data;
}`;

      case 'python':
        return `# 🐍 Python (Requests)
import requests

def upload_image(file_path):
    url = '${apiEndpointUrl}'
    headers = {
        'X-API-Key': '${activeKeyStr}'
    }
    with open(file_path, 'rb') as f:
        files = {'image': f}
        response = requests.post(url, headers=headers, files=files)
        data = response.json()
        print('Direct Image URL:', data['file']['direct_url'])
        return data['file']['direct_url']

upload_image('photo.jpg')`;

      case 'curl':
        return `# 💻 cURL (Command Line / Terminal)
curl -X POST \\
  "${apiEndpointUrl}" \\
  -H "X-API-Key: ${activeKeyStr}" \\
  -F "image=@/path/to/your/image.png"`;

      case 'html':
        return `<!-- 📱 HTML Direct Form Action -->
<form action="${apiEndpointUrl}" method="POST" enctype="multipart/form-data">
  <input type="hidden" name="api_key" value="${activeKeyStr}" />
  <input type="file" name="image" accept="image/*" required />
  <button type="submit">Upload to HT Claude Cloud</button>
</form>`;

      default:
        return '';
    }
  };

  // Playground Upload Handler
  const handlePlaygroundUpload = async (e) => {
    e.preventDefault();
    if (!testFile) return;
    setTestUploading(true);
    setTestError('');
    setTestResult(null);

    try {
      const formData = new FormData();
      formData.append('image', testFile);

      const targetKey = selectedKeyRecord ? selectedKeyRecord.key : activeKeyStr;

      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        headers: {
          'X-API-Key': targetKey,
        },
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult(data);
        if (onRefreshStorage) onRefreshStorage();
        if (selectedKeyRecord) {
          loadKeyFiles(selectedKeyRecord);
        }
        loadKeys();
      } else {
        setTestError(data.error || 'Upload failed');
      }
    } catch (err) {
      setTestError(err.message || 'Network error');
    } finally {
      setTestUploading(false);
    }
  };

  // =========================================================================
  // VIEW 1: DEDICATED API KEY DETAIL & UPLOADED FILES INSPECTOR
  // =========================================================================
  if (selectedKeyRecord) {
    const purposeBadge = getPurposeBadge(selectedKeyRecord.purpose);
    const PurposeIcon = purposeBadge.icon;
    const isRevealed = revealedKeys[selectedKeyRecord.id];
    const isCopied = copiedKeyId === selectedKeyRecord.id;

    const filteredFiles = keyFilesData?.files
      ? keyFileCategory === 'all'
        ? keyFilesData.files
        : keyFilesData.files.filter((f) => f.category === keyFileCategory)
      : [];

    return (
      <div className="flex-1 overflow-y-auto bg-transparent p-6 space-y-6 animate-fade-in select-none">
        {/* Top Breadcrumb Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedKeyRecord(null);
                setKeyFilesData(null);
              }}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to All Keys</span>
            </button>
            <div className="h-5 w-px bg-slate-800" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white">{selectedKeyRecord.name}</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${purposeBadge.color} flex items-center gap-1 border`}>
                  <PurposeIcon className="w-3 h-3" />
                  <span>{purposeBadge.label}</span>
                </span>
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    selectedKeyRecord.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}
                >
                  {selectedKeyRecord.status}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Created {formatDate(selectedKeyRecord.created_at)} &bull; {selectedKeyRecord.expires_at ? `Expires ${formatDate(selectedKeyRecord.expires_at)}` : 'Permanent / Never Expires'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadKeyFiles(selectedKeyRecord)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              <span>Refresh Files</span>
            </button>
            <button
              onClick={() => handleToggleStatus(selectedKeyRecord)}
              className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                selectedKeyRecord.status === 'active'
                  ? 'bg-slate-800/80 hover:bg-slate-700 text-amber-400 border-slate-700'
                  : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
              }`}
            >
              {selectedKeyRecord.status === 'active' ? 'Revoke Key' : 'Reactivate Key'}
            </button>
          </div>
        </div>

        {/* Key Info Banner */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-xs text-slate-300 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 flex-1 overflow-hidden">
              <span className="text-slate-500 select-none">TOKEN:</span>
              <span className="truncate select-all text-cyan-300 font-bold">
                {isRevealed ? selectedKeyRecord.key : `${selectedKeyRecord.key.slice(0, 12)}••••••••••••••••••••••••`}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => toggleRevealKey(selectedKeyRecord.id)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
                title="Reveal/Hide"
              >
                {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-cyan-400" />}
              </button>
              <button
                onClick={() => handleCopyKey(selectedKeyRecord)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold cursor-pointer"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Copied' : 'Copy API Key'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-slate-500 text-[11px] block">Total Files Uploaded</span>
              <span className="text-sm font-bold text-white font-mono">{keyFilesData?.totalFiles || 0} items</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-slate-500 text-[11px] block">Total Cloud Size</span>
              <span className="text-sm font-bold text-cyan-400 font-mono">{formatBytes(keyFilesData?.totalSize || 0)}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-slate-500 text-[11px] block">Key Purpose</span>
              <span className="text-xs font-semibold text-slate-200 capitalize">{selectedKeyRecord.purpose || 'Web'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-slate-500 text-[11px] block">Validity / Expiry</span>
              <span className="text-xs font-semibold text-emerald-400">
                {selectedKeyRecord.expires_at ? formatDate(selectedKeyRecord.expires_at) : 'Permanent'}
              </span>
            </div>
          </div>
        </div>

        {/* Uploaded Files Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-cyan-400" />
              <span>Images & Documents Uploaded by this Key ({filteredFiles.length})</span>
            </h3>

            {/* Filter category pills */}
            <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto">
              {[
                { id: 'all', label: 'All' },
                { id: 'images', label: 'Images' },
                { id: 'videos', label: 'Videos' },
                { id: 'documents', label: 'Documents' },
                { id: 'archives', label: 'Archives' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setKeyFileCategory(cat.id)}
                  className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                    keyFileCategory === cat.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {loadingKeyFiles ? (
            <div className="glass-panel p-12 text-center text-slate-500 text-xs font-mono">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mx-auto mb-2" />
              Fetching files uploaded via this API key...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="glass-panel p-12 text-center rounded-2xl border border-dashed border-slate-700/80 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-200">No Files Uploaded Yet</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Use this API key in your website or test upload a file below to see it appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFiles.map((file) => {
                const directUrl = `${effectiveBaseUrl}/api/v1/raw/${file.id}`;
                const isCopiedUrl = copiedUrlId === file.id;

                return (
                  <div
                    key={file.id}
                    className="glass-card p-4 rounded-2xl border border-slate-800/80 hover:border-cyan-500/40 transition-all space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2.5">
                      {/* Image / Document Preview Box with Click to View Modal */}
                      {file.category === 'images' ? (
                        <div
                          onClick={() => onFileClick && onFileClick(file)}
                          className="h-36 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-cyan-500/80 overflow-hidden flex items-center justify-center p-2 relative group cursor-pointer transition-all shadow-inner select-none"
                          title="Click to view full-screen preview"
                        >
                          <img
                            src={directUrl}
                            alt={file.name}
                            className="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          {/* Hover Overlay with Eye Icon */}
                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-xs font-bold text-white backdrop-blur-[2px] transition-opacity rounded-xl">
                            <Eye className="w-4 h-4 text-cyan-400" />
                            <span>View Preview</span>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => onFileClick && onFileClick(file)}
                          className="h-24 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-cyan-500/80 flex items-center justify-center text-slate-400 cursor-pointer group transition-all relative overflow-hidden select-none"
                          title="Click to view file preview"
                        >
                          {file.category === 'documents' ? (
                            <FileText className="w-8 h-8 text-blue-400 group-hover:scale-110 transition-transform" />
                          ) : (
                            <FileCode className="w-8 h-8 text-amber-400 group-hover:scale-110 transition-transform" />
                          )}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-xs font-bold text-white backdrop-blur-[2px] transition-opacity rounded-xl">
                            <Eye className="w-4 h-4 text-cyan-400" />
                            <span>View Document</span>
                          </div>
                        </div>
                      )}

                      <div>
                        <h4
                          onClick={() => onFileClick && onFileClick(file)}
                          className="text-xs font-bold text-slate-100 hover:text-cyan-400 truncate cursor-pointer transition-colors"
                          title={file.name}
                        >
                          {file.name}
                        </h4>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                          <span className="font-mono">{formatBytes(file.size)}</span>
                          <span>{formatDate(file.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Direct URL copy and action bar */}
                    <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleCopyDirectUrl(file.id, directUrl)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold cursor-pointer"
                        title="Copy Public Direct Embed URL"
                      >
                        {isCopiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopiedUrl ? 'Link Copied' : 'Copy Direct Link'}</span>
                      </button>

                      {/* View Modal Trigger */}
                      <button
                        onClick={() => onFileClick && onFileClick(file)}
                        className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400 border border-slate-700 transition-colors cursor-pointer"
                        title="Open Full-Screen Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <a
                        href={directUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                        title="Open in new browser tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      <button
                        onClick={() => handleDeleteKeyFile(file.id, file.name)}
                        className="p-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                        title="Delete this file"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Test Upload with this Key */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-3">
          <h4 className="text-xs font-bold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Upload Test File to this API Key</span>
          </h4>
          <form onSubmit={handlePlaygroundUpload} className="flex flex-col sm:flex-row items-center gap-3">
            <input
              type="file"
              onChange={(e) => setTestFile(e.target.files?.[0] || null)}
              className="w-full sm:w-auto flex-1 p-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-cyan-500/20 file:text-cyan-300"
            />
            <button
              type="submit"
              disabled={!testFile || testUploading}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
            >
              {testUploading ? 'Uploading...' : 'Upload Now'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: ALL API KEYS LIST & CODE GENERATOR
  // =========================================================================
  return (
    <div className="flex-1 overflow-y-auto bg-transparent p-6 space-y-6 select-none">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-cyan-500/20">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-white tracking-tight" style={{ fontFamily: 'Poppins, sans-serif' }}>
                Developer API & Integrations
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                UNIVERSAL v1
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Generate API keys to upload and embed images from any website, mobile app, or backend service.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadKeys}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all cursor-pointer transform hover:-translate-y-0.5"
          >
            <Plus className="w-4 h-4" />
            <span>Create New API Key</span>
          </button>
        </div>
      </div>

      {/* API Keys Manager */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Your API Keys ({apiKeys.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400 italic">Click any key card to view its uploaded images & documents</span>
        </div>

        {loading ? (
          <div className="glass-panel p-8 rounded-2xl flex items-center justify-center text-slate-500 text-xs font-mono">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mr-2" />
            Loading API keys...
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="glass-panel p-8 rounded-2xl border border-dashed border-slate-700/80 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mx-auto">
              <Key className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-200">No API Keys Generated Yet</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create your first API key with a name, purpose, and validity to start uploading images from your apps.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-bold border border-cyan-500/40 cursor-pointer"
            >
              + Generate First API Key
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((keyItem) => {
              const isRevealed = revealedKeys[keyItem.id];
              const isCopied = copiedKeyId === keyItem.id;
              const isSelectedForSnippet = selectedKeyForSnippet === keyItem.key;
              const purposeBadge = getPurposeBadge(keyItem.purpose);
              const PurposeIcon = purposeBadge.icon;

              return (
                <div
                  key={keyItem.id}
                  className={`glass-card p-4 rounded-2xl border transition-all ${
                    keyItem.status === 'revoked'
                      ? 'border-red-500/30 bg-red-950/10'
                      : isSelectedForSnippet
                      ? 'border-cyan-500/50 bg-cyan-950/20 shadow-md shadow-cyan-500/10'
                      : 'border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
                    <div
                      onClick={() => loadKeyFiles(keyItem)}
                      className="flex items-center gap-2.5 cursor-pointer group flex-1"
                    >
                      <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                        <PurposeIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">{keyItem.name}</h4>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${purposeBadge.color} border`}>
                            {purposeBadge.label}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              keyItem.status === 'active'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-red-500/20 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {keyItem.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Created {formatDate(keyItem.created_at)} &bull; {keyItem.expires_at ? `Expires ${formatDate(keyItem.expires_at)}` : 'Permanent'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => loadKeyFiles(keyItem)}
                        className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] cursor-pointer flex items-center gap-1"
                        title="Click to view files & documents for this API key"
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>{keyItem.total_uploads || 0} files</span>
                      </button>
                      <button
                        onClick={() => setSelectedKeyForSnippet(keyItem.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                          isSelectedForSnippet
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border-slate-700'
                        }`}
                      >
                        {isSelectedForSnippet ? 'In Snippet' : 'Use in Snippet'}
                      </button>
                    </div>
                  </div>

                  {/* Key Bar */}
                  <div className="pt-3 flex items-center justify-between gap-3">
                    <div
                      onClick={() => loadKeyFiles(keyItem)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs text-slate-300 overflow-hidden cursor-pointer hover:border-cyan-500/40 transition-colors"
                      title="Click to inspect this key's uploaded files"
                    >
                      <span className="text-slate-500 select-none">KEY:</span>
                      <span className="truncate">
                        {isRevealed
                          ? keyItem.key
                          : `${keyItem.key.slice(0, 12)}••••••••••••••••••••••••`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleRevealKey(keyItem.id)}
                        className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                        title={isRevealed ? 'Hide Key' : 'Reveal Key'}
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-cyan-400" />}
                      </button>

                      <button
                        onClick={() => handleCopyKey(keyItem)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-colors cursor-pointer"
                        title="Copy API Key"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={() => handleToggleStatus(keyItem)}
                        className={`p-2 rounded-xl border transition-colors cursor-pointer text-xs font-semibold ${
                          keyItem.status === 'active'
                            ? 'bg-slate-800/80 hover:bg-slate-700 text-amber-400 border-slate-700'
                            : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                        }`}
                        title={keyItem.status === 'active' ? 'Revoke Key' : 'Activate Key'}
                      >
                        {keyItem.status === 'active' ? 'Revoke' : 'Activate'}
                      </button>

                      <button
                        onClick={() => handleDeleteKey(keyItem.id, keyItem.name)}
                        className="p-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 transition-colors cursor-pointer"
                        title="Delete Key Permanently"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Code Snippets & Documentation */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Integration Code Snippets</h3>
              <p className="text-xs text-slate-400">Copy and paste ready-to-use code into your project</p>
            </div>
          </div>

          {/* Domain Base URL Toggle */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Target Domain:</span>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setUseCustomDomain(false)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  !useCustomDomain ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Auto-Detect ({defaultBaseUrl.replace(/^https?:\/\//, '')})
              </button>
              <button
                type="button"
                onClick={() => setUseCustomDomain(true)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  useCustomDomain ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom Domain
              </button>
            </div>
          </div>
        </div>

        {useCustomDomain && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 border border-cyan-500/30 text-xs animate-fade-in">
            <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <span className="text-slate-400 font-medium">Your Domain:</span>
              <input
                type="text"
                placeholder="e.g. https://api.yourdomain.com or https://htclaude.vercel.app"
                value={customDomainInput}
                onChange={(e) => setCustomDomainInput(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-cyan-300 font-mono focus:border-cyan-400 outline-none text-xs"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-slate-400 font-mono">
            API URL: <strong className="text-cyan-300">{apiEndpointUrl}</strong>
          </span>

          {/* Language selector buttons */}
          <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            {[
              { id: 'js', label: 'JavaScript' },
              { id: 'nodejs', label: 'Node.js' },
              { id: 'python', label: 'Python' },
              { id: 'curl', label: 'cURL' },
              { id: 'html', label: 'HTML' },
            ].map((lang) => (
              <button
                key={lang.id}
                onClick={() => setSelectedLanguage(lang.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  selectedLanguage === lang.id
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Code Box */}
        <div className="relative">
          <pre className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 font-mono text-xs text-cyan-300 overflow-x-auto select-text leading-relaxed">
            {getCodeSnippet()}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(getCodeSnippet());
              alert('Code snippet copied to clipboard!');
            }}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer shadow-md"
          >
            <Copy className="w-3.5 h-3.5 text-cyan-400" />
            <span>Copy Code</span>
          </button>
        </div>
      </div>

      {/* Live Interactive Playground / Test Upload */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-white">Live API Playground (Test Upload)</h3>
            <p className="text-xs text-slate-400">Test uploading an image right now using your active API key</p>
          </div>
        </div>

        <form onSubmit={handlePlaygroundUpload} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="file"
            accept="image/*,video/*,audio/*,application/*"
            onChange={(e) => setTestFile(e.target.files?.[0] || null)}
            className="w-full sm:w-auto flex-1 p-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 cursor-pointer"
          />

          <button
            type="submit"
            disabled={!testFile || testUploading || apiKeys.length === 0}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {testUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploading to Telegram Channel...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Execute API Test Upload</span>
              </>
            )}
          </button>
        </form>

        {testError && (
          <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{testError}</span>
          </div>
        )}

        {testResult && (
          <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>API Upload Test Successful! File is live.</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <span className="text-slate-400 text-[11px]">Direct Public Image URL:</span>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-cyan-300 select-all break-all">
                  {testResult.file?.direct_url}
                </div>
              </div>

              {testResult.file?.category === 'images' && (
                <div className="space-y-1.5">
                  <span className="text-slate-400 text-[11px]">Live Preview:</span>
                  <div className="h-28 rounded-lg bg-slate-900 border border-slate-800 p-2 flex items-center justify-center overflow-hidden">
                    <img
                      src={testResult.file?.direct_url}
                      alt="Uploaded test"
                      className="max-h-full max-w-full rounded object-contain"
                    />
                  </div>
                </div>
              )}
            </div>

            <pre className="p-3 rounded-lg bg-slate-900/90 font-mono text-[11px] text-slate-300 overflow-x-auto select-text">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Simple, Clean & Minimal Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-3xl p-6 border border-slate-800/90 shadow-2xl glass-modal space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Create API Key</h3>
                  <p className="text-xs text-slate-400">Generate credentials for your website or app</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Simple Form */}
            <form onSubmit={handleCreateKey} className="space-y-4">
              {/* Field 1: Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Key Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Website, Portfolio, App"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 text-sm text-slate-100 placeholder-slate-600 outline-none transition-colors"
                />
              </div>

              {/* Field 2: Purpose */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Purpose</label>
                <select
                  value={newKeyPurpose}
                  onChange={(e) => setNewKeyPurpose(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 text-sm text-slate-200 outline-none cursor-pointer"
                >
                  <option value="web" className="bg-slate-900">Web Application (React, Next.js, Vue, Website)</option>
                  <option value="mobile" className="bg-slate-900">Mobile Application (iOS, Android, Flutter)</option>
                  <option value="backend" className="bg-slate-900">Backend Server / API</option>
                  <option value="desktop" className="bg-slate-900">Desktop / Others</option>
                </select>
              </div>

              {/* Field 3: Validity */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Expiration</label>
                <select
                  value={newKeyValidity}
                  onChange={(e) => setNewKeyValidity(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 text-sm text-slate-200 outline-none cursor-pointer"
                >
                  <option value="never" className="bg-slate-900">Permanent (Never Expires)</option>
                  <option value="30d" className="bg-slate-900">30 Days</option>
                  <option value="90d" className="bg-slate-900">90 Days</option>
                  <option value="180d" className="bg-slate-900">180 Days</option>
                  <option value="365d" className="bg-slate-900">1 Year</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newKeyName.trim()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all cursor-pointer flex items-center gap-2"
                >
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Create API Key</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
