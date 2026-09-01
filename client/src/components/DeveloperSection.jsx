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
  ChevronRight,
  Zap,
  BookOpen,
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
  const [copiedSnippet, setCopiedSnippet] = useState(false);
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
        if (res.key?.key) {
          setSelectedKeyForSnippet(res.key.key);
        }
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

  // Dynamic Base URL detection
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
        return { label: 'Web App', icon: Globe, color: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60' };
      case 'mobile':
        return { label: 'Mobile App', icon: Smartphone, color: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800/60' };
      case 'backend':
        return { label: 'Backend Server', icon: Server, color: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60' };
      case 'desktop':
        return { label: 'Desktop App', icon: Monitor, color: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60' };
      default:
        return { label: 'General / API', icon: Code2, color: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/60' };
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
      <div className="flex-1 overflow-y-auto bg-transparent p-4 sm:p-6 space-y-6 animate-fade-in select-none">
        {/* Top Breadcrumb Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedKeyRecord(null);
                setKeyFilesData(null);
              }}
              className="p-2 rounded-xl bg-white dark:bg-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold shadow-xs"
            >
              <ArrowLeft className="w-4 h-4 text-rose-500" />
              <span>Back to All Keys</span>
            </button>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-800" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selectedKeyRecord.name}</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${purposeBadge.color} flex items-center gap-1 border`}>
                  <PurposeIcon className="w-3 h-3" />
                  <span>{purposeBadge.label}</span>
                </span>
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    selectedKeyRecord.status === 'active'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                      : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                  }`}
                >
                  {selectedKeyRecord.status}
                </span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Created {formatDate(selectedKeyRecord.created_at)} &bull; {selectedKeyRecord.expires_at ? `Expires ${formatDate(selectedKeyRecord.expires_at)}` : 'Permanent (Never Expires)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadKeyFiles(selectedKeyRecord)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 text-rose-500" />
              <span>Refresh Files</span>
            </button>
            <button
              onClick={() => handleToggleStatus(selectedKeyRecord)}
              className={`px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                selectedKeyRecord.status === 'active'
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 hover:bg-amber-100'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100'
              }`}
            >
              {selectedKeyRecord.status === 'active' ? 'Revoke Key' : 'Reactivate Key'}
            </button>
          </div>
        </div>

        {/* Key Info Banner Card */}
        <div className="glass-panel p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-950 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 flex-1 overflow-hidden">
              <span className="text-gray-400 dark:text-gray-500 font-bold select-none">TOKEN:</span>
              <span className="truncate select-all text-rose-600 dark:text-rose-400 font-bold">
                {isRevealed ? selectedKeyRecord.key : `${selectedKeyRecord.key.slice(0, 14)}••••••••••••••••••••••••`}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => toggleRevealKey(selectedKeyRecord.id)}
                className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title={isRevealed ? 'Hide Token' : 'Reveal Token'}
              >
                {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-rose-500" />}
              </button>
              <button
                onClick={() => handleCopyKey(selectedKeyRecord)}
                className="btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Copied' : 'Copy API Key'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 text-[11px] block">Files Uploaded</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">{keyFilesData?.totalFiles || 0} items</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 text-[11px] block">Total Cloud Size</span>
              <span className="text-sm font-bold text-rose-600 dark:text-rose-400 font-mono">{formatBytes(keyFilesData?.totalSize || 0)}</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 text-[11px] block">Key Purpose</span>
              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize">{selectedKeyRecord.purpose || 'Web'}</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800">
              <span className="text-gray-400 dark:text-gray-500 text-[11px] block">Validity / Expiry</span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {selectedKeyRecord.expires_at ? formatDate(selectedKeyRecord.expires_at) : 'Permanent'}
              </span>
            </div>
          </div>
        </div>

        {/* Uploaded Files Gallery Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-rose-500" />
              <span>Images & Documents Uploaded by this Key ({filteredFiles.length})</span>
            </h3>

            {/* Filter category pills */}
            <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-900 p-1 rounded-xl border border-gray-200 dark:border-gray-800 text-xs overflow-x-auto">
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
                      ? 'bg-rose-500 text-white shadow-xs'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {loadingKeyFiles ? (
            <div className="glass-panel p-12 text-center text-gray-400 dark:text-gray-500 text-xs font-mono">
              <Loader2 className="w-6 h-6 animate-spin text-rose-500 mx-auto mb-2" />
              Fetching files uploaded via this API key...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="glass-panel p-12 text-center rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500 mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">No Files Uploaded Yet</h4>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-sm mx-auto">
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
                    className="glass-card p-4 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-rose-300 dark:hover:border-rose-700 transition-all space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2.5">
                      {/* Image / Document Preview Box */}
                      {file.category === 'images' ? (
                        <div
                          onClick={() => onFileClick && onFileClick(file)}
                          className="h-36 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 hover:border-rose-400 overflow-hidden flex items-center justify-center p-2 relative group cursor-pointer transition-all shadow-inner select-none"
                          title="Click to view full-screen preview"
                        >
                          <img
                            src={directUrl}
                            alt={file.name}
                            className="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-xs font-bold text-white backdrop-blur-[2px] transition-opacity rounded-xl">
                            <Eye className="w-4 h-4 text-rose-400" />
                            <span>View Preview</span>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => onFileClick && onFileClick(file)}
                          className="h-24 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 hover:border-rose-400 flex items-center justify-center text-gray-400 cursor-pointer group transition-all relative overflow-hidden select-none"
                          title="Click to view file preview"
                        >
                          {file.category === 'documents' ? (
                            <FileText className="w-8 h-8 text-blue-500 group-hover:scale-110 transition-transform" />
                          ) : (
                            <FileCode className="w-8 h-8 text-amber-500 group-hover:scale-110 transition-transform" />
                          )}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-xs font-bold text-white backdrop-blur-[2px] transition-opacity rounded-xl">
                            <Eye className="w-4 h-4 text-rose-400" />
                            <span>View Document</span>
                          </div>
                        </div>
                      )}

                      <div>
                        <h4
                          onClick={() => onFileClick && onFileClick(file)}
                          className="text-xs font-bold text-gray-800 dark:text-gray-100 hover:text-rose-600 dark:hover:text-rose-400 truncate cursor-pointer transition-colors"
                          title={file.name}
                        >
                          {file.name}
                        </h4>
                        <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                          <span className="font-mono">{formatBytes(file.size)}</span>
                          <span>{formatDate(file.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Direct URL copy and action bar */}
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleCopyDirectUrl(file.id, directUrl)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 text-xs font-semibold cursor-pointer transition-colors"
                        title="Copy Public Direct Embed URL"
                      >
                        {isCopiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopiedUrl ? 'Link Copied' : 'Copy Direct Link'}</span>
                      </button>

                      <button
                        onClick={() => onFileClick && onFileClick(file)}
                        className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors cursor-pointer"
                        title="Open Full-Screen Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <a
                        href={directUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors"
                        title="Open in new browser tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      <button
                        onClick={() => handleDeleteKeyFile(file.id, file.name)}
                        className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
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

        {/* Quick Test Upload Card */}
        <div className="glass-panel p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3">
          <h4 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-500" />
            <span>Upload Test File to this API Key</span>
          </h4>
          <form onSubmit={handlePlaygroundUpload} className="flex flex-col sm:flex-row items-center gap-3">
            <input
              type="file"
              onChange={(e) => setTestFile(e.target.files?.[0] || null)}
              className="w-full sm:w-auto flex-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-50 dark:file:bg-rose-950/50 file:text-rose-600 dark:file:text-rose-400 cursor-pointer"
            />
            <button
              type="submit"
              disabled={!testFile || testUploading}
              className="btn-primary w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {testUploading ? 'Uploading...' : 'Upload Test Now'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: MAIN DEVELOPER PAGE — CLEAN, MODERN & PERFECT
  // =========================================================================
  return (
    <div className="flex-1 overflow-y-auto bg-transparent p-4 sm:p-6 space-y-6 select-none animate-fade-in">

      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3.5">
          {/* Crimson Icon badge */}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg shadow-rose-600/25 shrink-0">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                Developer API & Integrations
              </h2>
              <span className="badge-rose text-[10px] font-bold px-2 py-0.5 rounded-full border">
                UNIVERSAL v1
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Generate API keys to upload and embed images from any website, mobile app, or backend service.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadKeys}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-rose-500" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create New API Key</span>
          </button>
        </div>
      </div>

      {/* ── 4-Step Interactive Guide (Inspired by Screenshot 1 "Getting Started") ── */}
      <div className="glass-panel p-5 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3.5 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-900 dark:text-white">
          <Zap className="w-4 h-4 text-rose-500" />
          <span>Getting Started with Developer Integrations</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Step 1 */}
          <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-gray-900/60 border border-gray-200/80 dark:border-gray-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
              <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Create API Key</h4>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Name your key and select purpose (Web, Mobile, Backend).
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-gray-900/60 border border-gray-200/80 dark:border-gray-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
              <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Pick Target Domain</h4>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Use auto-detected host or specify your custom domain URL.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-gray-900/60 border border-gray-200/80 dark:border-gray-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
              <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Copy Code Snippet</h4>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Choose JS, Python, Node, cURL or HTML direct upload.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-gray-900/60 border border-gray-200/80 dark:border-gray-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
              <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Upload & Embed</h4>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Receive direct permanent URLs stored on unlimited Secure Cloud Storage.
            </p>
          </div>
        </div>
      </div>

      {/* ── API Keys Manager ── */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-rose-500" />
            <span>Your API Keys ({apiKeys.length})</span>
          </h3>
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">Click any key card to view its uploaded images & documents</span>
        </div>

        {loading ? (
          <div className="glass-panel p-8 rounded-2xl flex items-center justify-center text-gray-400 text-xs font-mono">
            <Loader2 className="w-5 h-5 animate-spin text-rose-500 mr-2" />
            Loading API keys...
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="glass-panel p-8 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500 mx-auto">
              <Key className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">No API Keys Generated Yet</h4>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-sm mx-auto">
                Create your first API key with a name, purpose, and validity to start uploading images from your apps.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
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
                      ? 'border-rose-300 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/20'
                      : isSelectedForSnippet
                      ? 'border-rose-500 dark:border-rose-500/80 bg-rose-50/30 dark:bg-rose-950/20 shadow-md shadow-rose-500/10'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                  }`}
                >
                  {/* Card Top Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800/70">
                    <div
                      onClick={() => loadKeyFiles(keyItem)}
                      className="flex items-center gap-2.5 cursor-pointer group flex-1"
                    >
                      <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500 group-hover:scale-105 transition-transform shrink-0">
                        <PurposeIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                            {keyItem.name}
                          </h4>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${purposeBadge.color} border`}>
                            {purposeBadge.label}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              keyItem.status === 'active'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                            }`}
                          >
                            {keyItem.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                          Created {formatDate(keyItem.created_at)} &bull; {keyItem.expires_at ? `Expires ${formatDate(keyItem.expires_at)}` : 'Permanent'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => loadKeyFiles(keyItem)}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 font-mono text-[11px] cursor-pointer flex items-center gap-1 transition-colors"
                        title="Click to view files & documents for this API key"
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>{keyItem.total_uploads || 0} files</span>
                      </button>
                      <button
                        onClick={() => setSelectedKeyForSnippet(keyItem.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                          isSelectedForSnippet
                            ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        {isSelectedForSnippet ? 'In Snippet' : 'Use in Snippet'}
                      </button>
                    </div>
                  </div>

                  {/* Card Bottom Row: Token Bar & Actions */}
                  <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div
                      onClick={() => loadKeyFiles(keyItem)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 font-mono text-xs text-gray-800 dark:text-gray-200 overflow-hidden cursor-pointer hover:border-rose-400 transition-colors"
                      title="Click to inspect this key's uploaded files"
                    >
                      <span className="text-gray-400 dark:text-gray-500 font-bold select-none">KEY:</span>
                      <span className="truncate">
                        {isRevealed
                          ? keyItem.key
                          : `${keyItem.key.slice(0, 14)}••••••••••••••••••••••••`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleRevealKey(keyItem.id)}
                        className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                        title={isRevealed ? 'Hide Key' : 'Reveal Key'}
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-rose-500" />}
                      </button>

                      <button
                        onClick={() => handleCopyKey(keyItem)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 text-xs font-semibold transition-colors cursor-pointer"
                        title="Copy API Key"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={() => handleToggleStatus(keyItem)}
                        className={`p-2 rounded-xl border transition-colors cursor-pointer text-xs font-semibold ${
                          keyItem.status === 'active'
                            ? 'bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                        }`}
                        title={keyItem.status === 'active' ? 'Revoke Key' : 'Activate Key'}
                      >
                        {keyItem.status === 'active' ? 'Revoke' : 'Activate'}
                      </button>

                      <button
                        onClick={() => handleDeleteKey(keyItem.id, keyItem.name)}
                        className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
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

      {/* ── Integration Code Snippets & Documentation ── */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 text-rose-500">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Integration Code Snippets</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">Copy and paste ready-to-use code into your project</p>
            </div>
          </div>

          {/* Domain Base URL Toggle */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 font-semibold">Target Domain:</span>
            <div className="flex items-center bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setUseCustomDomain(false)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  !useCustomDomain ? 'bg-rose-500 text-white shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Auto-Detect ({defaultBaseUrl.replace(/^https?:\/\//, '')})
              </button>
              <button
                type="button"
                onClick={() => setUseCustomDomain(true)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  useCustomDomain ? 'bg-rose-500 text-white shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Custom Domain
              </button>
            </div>
          </div>
        </div>

        {useCustomDomain && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/80 border border-rose-200 dark:border-rose-800/60 text-xs animate-fade-in">
            <Globe className="w-4 h-4 text-rose-500 shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-400 font-medium">Your Domain:</span>
              <input
                type="text"
                placeholder="e.g. https://api.yourdomain.com or https://htclaude.vercel.app"
                value={customDomainInput}
                onChange={(e) => setCustomDomainInput(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-rose-600 dark:text-rose-400 font-mono focus:border-rose-500 outline-none text-xs"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            API URL: <strong className="text-rose-600 dark:text-rose-400">{apiEndpointUrl}</strong>
          </span>

          {/* Language selector buttons */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-900 p-1 rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
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
                    ? 'btn-primary text-white shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Code Box */}
        <div className="relative">
          <pre className="p-4 rounded-xl bg-gray-950 border border-gray-800 font-mono text-xs text-rose-300 overflow-x-auto select-text leading-relaxed">
            {getCodeSnippet()}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(getCodeSnippet());
              setCopiedSnippet(true);
              setTimeout(() => setCopiedSnippet(false), 2000);
            }}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs font-semibold transition-colors cursor-pointer shadow-md"
          >
            {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-rose-400" />}
            <span>{copiedSnippet ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>
      </div>

      {/* ── Live Interactive Playground / Test Upload ── */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-emerald-500">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Live API Playground (Test Upload)</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">Test uploading an image right now using your active API key</p>
          </div>
        </div>

        <form onSubmit={handlePlaygroundUpload} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="file"
            accept="image/*,video/*,audio/*,application/*"
            onChange={(e) => setTestFile(e.target.files?.[0] || null)}
            className="w-full sm:w-auto flex-1 p-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs text-gray-700 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-50 dark:file:bg-rose-950/50 file:text-rose-600 dark:file:text-rose-400 cursor-pointer"
          />

          <button
            type="submit"
            disabled={!testFile || testUploading || apiKeys.length === 0}
            className="btn-primary w-full sm:w-auto px-5 py-2.5 rounded-xl disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {testUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploading to Cloud Storage...</span>
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
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{testError}</span>
          </div>
        )}

        {testResult && (
          <div className="p-4 rounded-xl bg-gray-950 border border-emerald-500/40 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>API Upload Test Successful! File is live.</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <span className="text-gray-400 text-[11px]">Direct Public Image URL:</span>
                <div className="p-2.5 rounded-lg bg-gray-900 border border-gray-800 font-mono text-xs text-rose-300 select-all break-all">
                  {testResult.file?.direct_url}
                </div>
              </div>

              {testResult.file?.category === 'images' && (
                <div className="space-y-1.5">
                  <span className="text-gray-400 text-[11px]">Live Preview:</span>
                  <div className="h-28 rounded-lg bg-gray-900 border border-gray-800 p-2 flex items-center justify-center overflow-hidden">
                    <img
                      src={testResult.file?.direct_url}
                      alt="Uploaded test"
                      className="max-h-full max-w-full rounded object-contain"
                    />
                  </div>
                </div>
              )}
            </div>

            <pre className="p-3 rounded-lg bg-gray-900/90 font-mono text-[11px] text-gray-300 overflow-x-auto select-text">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* ── Simple, Clean & Minimal Create Key Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-2xl glass-modal space-y-5 bg-white dark:bg-gray-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Create API Key</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Generate credentials for your website or app</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateKey} className="space-y-4">
              {/* Field 1: Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Key Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Website, Portfolio, App"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 focus:border-rose-500 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none transition-colors"
                />
              </div>

              {/* Field 2: Purpose */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Purpose</label>
                <select
                  value={newKeyPurpose}
                  onChange={(e) => setNewKeyPurpose(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 focus:border-rose-500 text-sm text-gray-900 dark:text-gray-100 outline-none cursor-pointer"
                >
                  <option value="web" className="dark:bg-gray-900">Web Application (React, Next.js, Vue, Website)</option>
                  <option value="mobile" className="dark:bg-gray-900">Mobile Application (iOS, Android, Flutter)</option>
                  <option value="backend" className="dark:bg-gray-900">Backend Server / API</option>
                  <option value="desktop" className="dark:bg-gray-900">Desktop / Others</option>
                </select>
              </div>

              {/* Field 3: Validity */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Expiration</label>
                <select
                  value={newKeyValidity}
                  onChange={(e) => setNewKeyValidity(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 focus:border-rose-500 text-sm text-gray-900 dark:text-gray-100 outline-none cursor-pointer"
                >
                  <option value="never" className="dark:bg-gray-900">Permanent (Never Expires)</option>
                  <option value="30d" className="dark:bg-gray-900">30 Days</option>
                  <option value="90d" className="dark:bg-gray-900">90 Days</option>
                  <option value="180d" className="dark:bg-gray-900">180 Days</option>
                  <option value="365d" className="dark:bg-gray-900">1 Year</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newKeyName.trim()}
                  className="btn-primary px-5 py-2.5 rounded-xl disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-2"
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
