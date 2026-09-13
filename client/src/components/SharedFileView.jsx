import React, { useState, useEffect } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Download,
  Copy,
  Check,
  Eye,
  Code2,
  Lock,
  ExternalLink,
  ShieldCheck,
  Moon,
  Sun,
  AlertCircle,
  FileCode,
  Globe,
} from 'lucide-react';
import { api } from '../api';
import { useTheme } from '../context/ThemeContext';
import { formatBytes, formatDate } from '../utils';

export default function SharedFileView({ fileId: propFileId }) {
  const { isDark, toggleTheme } = useTheme();

  // Extract ID from prop, path, or query
  const fileId =
    propFileId ||
    window.location.pathname.replace(/^\/(share|view)\//, '').split('/')[0] ||
    new URLSearchParams(window.location.search).get('share') ||
    new URLSearchParams(window.location.search).get('v');

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [htmlViewMode, setHtmlViewMode] = useState('preview'); // 'preview' | 'code'

  useEffect(() => {
    if (!fileId) {
      setError('Invalid or missing file link.');
      setLoading(false);
      return;
    }

    let isMounted = true;
    api
      .getSharedFileInfo(fileId)
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.file) {
          setFile(res.file);
          setLoading(false);

          // If text or html, load content
          const isTextLike =
            res.file.mime_type?.includes('text') ||
            res.file.mime_type?.includes('json') ||
            res.file.mime_type?.includes('javascript') ||
            /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|csv|env|log)$/i.test(res.file.name || '');

          if (isTextLike) {
            setLoadingText(true);
            fetch(`/api/files/${res.file.id}/stream`)
              .then((r) => r.text())
              .then((txt) => {
                if (isMounted) {
                  setTextContent(txt);
                  setLoadingText(false);
                }
              })
              .catch(() => {
                if (isMounted) setLoadingText(false);
              });
          }
        } else {
          setError(res.error || 'File not found or no longer available.');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Error loading shared file.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [fileId]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen w-screen bg-[#f8fafc] dark:bg-[#060911] text-gray-900 dark:text-gray-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center animate-pulse mb-4">
          <Eye className="w-6 h-6 text-rose-500" />
        </div>
        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Loading shared view...</p>
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="min-h-screen w-screen bg-[#f8fafc] dark:bg-[#060911] text-gray-900 dark:text-gray-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="glass-modal max-w-md w-full p-8 rounded-3xl border border-gray-200 dark:border-gray-800 text-center space-y-4 bg-white dark:bg-gray-900 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-500 mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">File Unavailable</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {error || 'The file you are looking for might have been deleted, moved, or the link is invalid.'}
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 transition-colors"
          >
            <span>Return to Home</span>
          </a>
        </div>
      </div>
    );
  }

  const streamUrl = `/api/files/${file.id}/stream`;
  const isImage = file.category === 'images' || file.mime_type?.startsWith('image/');
  const isVideo = file.category === 'videos' || file.mime_type?.startsWith('video/');
  const isAudio = file.category === 'audio' || file.mime_type?.startsWith('audio/');
  const isPdf = file.mime_type === 'application/pdf' || file.name?.endsWith('.pdf');
  const isHtml = file.mime_type?.includes('html') || /\.html?$/i.test(file.name || '');
  const isTextLike =
    !isPdf &&
    (file.mime_type?.includes('text') ||
      file.mime_type?.includes('json') ||
      file.mime_type?.includes('javascript') ||
      /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|csv|env|log)$/i.test(file.name || ''));

  return (
    <div className="min-h-screen w-screen bg-[#f8fafc] dark:bg-[#060911] text-gray-900 dark:text-gray-100 flex flex-col transition-colors">
      {/* Top Read-Only Navigation Bar */}
      <header className="h-16 px-4 sm:px-8 border-b border-gray-200 dark:border-gray-800/80 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-40 select-none">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/25 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-wider text-gray-900 dark:text-white">
                HT CLAUDE
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Read-Only View
              </span>
            </div>
            <p className="text-[10px] text-gray-400 font-mono">Public Secure Cloud Share</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Link Copied!' : 'Copy Link'}</span>
          </button>

          <a
            href={streamUrl}
            download={file.name}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>
        </div>
      </header>

      {/* Main Content Viewer */}
      <main className="flex-1 flex flex-col max-w-6xl w-full mx-auto p-4 sm:p-6 md:p-8 space-y-4">
        {/* File Info Card */}
        <div className="glass-card p-4 sm:p-5 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-gray-900/60 shadow-xs">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-500 shrink-0">
              {isImage ? <ImageIcon className="w-5 h-5" /> : isVideo ? <Film className="w-5 h-5" /> : isAudio ? <Music className="w-5 h-5" /> : isHtml ? <Globe className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate" title={file.name}>
                {file.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                <span>{formatBytes(file.size)}</span>
                <span>&bull;</span>
                <span className="capitalize">{file.category}</span>
                <span>&bull;</span>
                <span>{formatDate(file.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Special Toggle for HTML Pages */}
          {isHtml && (
            <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl text-xs font-semibold self-start sm:self-auto shrink-0">
              <button
                onClick={() => setHtmlViewMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  htmlViewMode === 'preview'
                    ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs font-bold'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Globe className="w-3 h-3 text-rose-500" />
                <span>Web Preview</span>
              </button>
              <button
                onClick={() => setHtmlViewMode('code')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  htmlViewMode === 'code'
                    ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs font-bold'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Code2 className="w-3 h-3 text-rose-500" />
                <span>HTML Code</span>
              </button>
            </div>
          )}
        </div>

        {/* Media Container */}
        <div className="flex-1 min-h-[450px] rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-950 flex flex-col shadow-xl relative">
          {/* IMAGE */}
          {isImage && (
            <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-black/5 dark:bg-black/40 overflow-auto">
              <img
                src={streamUrl}
                alt={file.name}
                className="max-h-[75vh] max-w-full object-contain rounded-xl shadow-2xl animate-fade-in"
              />
            </div>
          )}

          {/* VIDEO */}
          {isVideo && (
            <div className="flex-1 flex items-center justify-center bg-black p-2 sm:p-4">
              <video
                src={streamUrl}
                controls
                autoPlay
                playsInline
                className="max-h-[75vh] w-full object-contain rounded-xl shadow-2xl"
              />
            </div>
          )}

          {/* AUDIO */}
          {isAudio && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 space-y-6">
              <div className="w-24 h-24 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 animate-pulse">
                <Music className="w-12 h-12" />
              </div>
              <audio src={streamUrl} controls className="w-full max-w-md shadow-lg" autoPlay />
            </div>
          )}

          {/* HTML WEBPAGE PREVIEW */}
          {isHtml && htmlViewMode === 'preview' && (
            <div className="flex-1 w-full h-full min-h-[600px] bg-white">
              <iframe
                src={streamUrl}
                title={file.name}
                className="w-full h-full min-h-[600px] border-none"
                sandbox="allow-scripts allow-forms allow-popups"
              />
            </div>
          )}

          {/* CODE / TEXT / HTML SOURCE */}
          {((isHtml && htmlViewMode === 'code') || (isTextLike && !isHtml)) && (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0f1d] text-gray-200">
              <div className="px-5 py-3 border-b border-gray-800 bg-[#060a14] flex items-center justify-between text-xs">
                <span className="font-mono text-gray-400">
                  {textContent ? textContent.split('\n').length : 0} lines &bull; {textContent.length} characters
                </span>
                <button
                  onClick={handleCopyContent}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors cursor-pointer text-xs"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Content'}</span>
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 sm:p-6 font-mono text-xs sm:text-sm leading-relaxed">
                {loadingText ? (
                  <div className="p-8 text-center text-gray-500">Loading document text...</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words">{textContent || 'Empty file'}</pre>
                )}
              </div>
            </div>
          )}

          {/* PDF */}
          {isPdf && (
            <div className="flex-1 w-full h-full min-h-[650px] bg-gray-900">
              <iframe
                src={`${streamUrl}#toolbar=1`}
                title={file.name}
                className="w-full h-full min-h-[650px] border-none"
              />
            </div>
          )}

          {/* OTHER UNRECOGNIZED BINARIES */}
          {!isImage && !isVideo && !isAudio && !isHtml && !isTextLike && !isPdf && (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
              <div className="w-20 h-20 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-500 shadow-md">
                <FileText className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Preview not supported for this file type
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1">
                  You can download the original file to view it on your device.
                </p>
              </div>
              <a
                href={streamUrl}
                download={file.name}
                className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download {file.name}</span>
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
