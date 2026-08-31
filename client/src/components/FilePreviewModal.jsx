import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Copy,
  Check,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  Archive,
  Info,
  Calendar,
  HardDrive,
  Send,
  Tag,
  Maximize2,
  Minimize2,
  StretchHorizontal,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { formatBytes, formatDate } from '../utils';

export default function FilePreviewModal({ file, onClose, onDownload, onTrash }) {
  const { currentUser } = useAuth();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fitMode, setFitMode] = useState('fit'); // 'fit' | 'full-width' | 'actual'
  const [textContent, setTextContent] = useState(null);
  const [loadingText, setLoadingText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef(null);

  // Lock body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!file) return;
    let isMounted = true;

    async function initStreamUrl() {
      const token = currentUser ? await currentUser.getIdToken() : '';
      const url = `${api.getStreamUrl(file.id)}?token=${encodeURIComponent(token)}`;
      if (isMounted) {
        setStreamUrl(url);
      }
    }

    initStreamUrl();
    return () => {
      isMounted = false;
    };
  }, [file, currentUser]);

  // Reset loading state when file or streamUrl changes
  useEffect(() => {
    setMediaLoading(true);
    setMediaError(false);
    setZoom(1);
    setRotation(0);
    setFitMode('fit');
  }, [file?.id, streamUrl]);

  if (!file) return null;

  const isTextLike =
    file.category === 'documents' &&
    (file.mime_type.includes('text') ||
      file.mime_type.includes('json') ||
      file.mime_type.includes('javascript') ||
      /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|csv|env|log)$/i.test(file.name));

  useEffect(() => {
    if (isTextLike && streamUrl) {
      setLoadingText(true);
      fetch(streamUrl)
        .then((r) => r.text())
        .then((txt) => {
          setTextContent(txt);
          setLoadingText(false);
        })
        .catch((err) => {
          setTextContent(`Failed to load preview: ${err.message}`);
          setLoadingText(false);
        });
    }
  }, [file.id, isTextLike, streamUrl]);

  const handleCopyText = () => {
    if (textContent) {
      navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleBrowserFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const renderLoader = (label = 'Loading Preview...') => (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md animate-fade-in select-none">
      <div className="relative mb-5">
        {/* Ambient Glow Aura */}
        <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-sky-500/20 via-cyan-500/25 to-purple-500/20 blur-xl animate-pulse" />
        <div className="relative w-16 h-16 rounded-2xl bg-slate-900/90 border border-sky-500/30 flex items-center justify-center shadow-2xl shadow-sky-500/20">
          <div className="w-8 h-8 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin" />
        </div>
      </div>
      <div className="text-center space-y-1.5 max-w-sm">
        <h4 className="text-sm font-bold text-slate-200 tracking-wide">{label}</h4>
        <p className="text-xs text-slate-400 font-mono flex items-center justify-center gap-1.5">
          <span className="truncate max-w-xs">{file.name}</span>
          <span>&bull;</span>
          <span className="text-sky-400 font-semibold">{formatBytes(file.size)}</span>
        </p>
      </div>
      {/* Mini Shimmer Bar */}
      <div className="w-44 h-1 bg-slate-800 rounded-full overflow-hidden mt-4">
        <div className="w-full h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-purple-500 animate-pulse" />
      </div>
    </div>
  );

  const renderViewer = () => {
    if (!streamUrl) {
      return renderLoader('Securing Encrypted Cloud Stream...');
    }

    // 1. Image Viewer (Full-Width & Full-Height Screen Canvas)
    if (file.category === 'images') {
      const getImageClass = () => {
        if (fitMode === 'full-width') {
          return 'w-full max-w-full h-auto object-contain rounded-xl shadow-2xl transition-all duration-300';
        }
        if (fitMode === 'actual') {
          return 'max-w-none max-h-none object-none rounded-xl shadow-2xl transition-all duration-300';
        }
        // Default fit to full screen
        return 'max-h-[calc(100vh-7.5rem)] max-w-[calc(100vw-2rem)] object-contain rounded-2xl shadow-2xl transition-all duration-300';
      };

      return (
        <div className="flex-1 flex flex-col items-center justify-center overflow-hidden relative select-none w-full h-full bg-black/50">
          {mediaLoading && renderLoader('Rendering High-Res Image...')}

          {mediaError ? (
            <div className="flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shadow-xl">
                <ImageIcon className="w-8 h-8" />
              </div>
              <p className="text-sm text-slate-200 font-medium">Unable to display image preview</p>
              <button
                onClick={() => onDownload(file)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-sky-400 font-semibold border border-slate-700 transition-colors"
              >
                Download File ({formatBytes(file.size)})
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-2 sm:p-4">
              <img
                src={streamUrl}
                alt={file.name}
                onLoad={() => setMediaLoading(false)}
                onError={() => {
                  setMediaLoading(false);
                  setMediaError(true);
                }}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className={`${getImageClass()} ${mediaLoading ? 'opacity-0' : 'opacity-100'}`}
              />
            </div>
          )}

          {/* Floating Image Control Bar (Bottom Center) */}
          {!mediaLoading && !mediaError && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl px-4 py-2 flex items-center gap-2.5 shadow-2xl animate-fade-in z-10">
              <button
                onClick={() => setZoom((z) => Math.max(0.2, z - 0.25))}
                className="p-1.5 text-slate-300 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-slate-200 px-1 font-semibold min-w-[3rem] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
                className="p-1.5 text-slate-300 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-slate-700 mx-1" />

              {/* Fit Mode Toggle */}
              <button
                onClick={() => setFitMode((m) => (m === 'fit' ? 'full-width' : 'fit'))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                  fitMode === 'full-width'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title="Toggle Full Width View"
              >
                <StretchHorizontal className="w-3.5 h-3.5" />
                <span>{fitMode === 'full-width' ? 'Full Width' : 'Fit Screen'}</span>
              </button>

              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1.5 text-slate-300 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Rotate 90°"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                  setFitMode('fit');
                }}
                className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 hover:bg-slate-800 rounded-lg font-medium transition-colors cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      );
    }

    // 2. Video Player (Full Width)
    if (file.category === 'videos') {
      return (
        <div className="flex-1 flex items-center justify-center p-2 sm:p-6 bg-black/60 relative w-full h-full">
          {mediaLoading && renderLoader('Buffering Video Stream...')}
          <video
            controls
            autoPlay
            src={streamUrl}
            onLoadedData={() => setMediaLoading(false)}
            onWaiting={() => setMediaLoading(true)}
            onPlaying={() => setMediaLoading(false)}
            className={`w-full h-full max-h-[calc(100vh-6rem)] max-w-full object-contain rounded-2xl shadow-2xl border border-slate-800 outline-none transition-opacity duration-300 ${
              mediaLoading ? 'opacity-30' : 'opacity-100'
            }`}
          >
            Your browser does not support HTML5 video playback.
          </video>
        </div>
      );
    }

    // 3. Audio Player (Full Width Centered)
    if (file.category === 'audio') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 space-y-6 relative w-full h-full bg-slate-950/40">
          {mediaLoading && renderLoader('Buffering Audio Track...')}
          <div className="w-32 h-32 rounded-3xl bg-gradient-to-tr from-sky-500/20 via-cyan-500/20 to-purple-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-2xl shadow-sky-500/20 animate-float">
            <Music className="w-16 h-16" />
          </div>
          <div className="text-center space-y-1.5">
            <h3 className="text-lg font-bold text-slate-100 max-w-xl truncate">{file.name}</h3>
            <p className="text-xs text-slate-400 font-mono">{formatBytes(file.size)}</p>
          </div>
          <audio
            controls
            autoPlay
            src={streamUrl}
            onCanPlay={() => setMediaLoading(false)}
            className="w-full max-w-2xl rounded-2xl shadow-2xl"
          >
            Your browser does not support audio playback.
          </audio>
        </div>
      );
    }

    // 4. Text / Code Document (Full Width)
    if (isTextLike) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6 relative w-full h-full bg-slate-950/40">
          {loadingText && renderLoader('Parsing Document Contents...')}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-xs text-slate-400 shrink-0">
            <span className="font-semibold text-slate-300">Document Content Preview</span>
            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Text'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-slate-950/90 rounded-2xl p-6 font-mono text-xs sm:text-sm text-slate-200 border border-slate-800/80 select-text leading-relaxed w-full">
            {loadingText ? (
              <div className="space-y-3.5 py-6 animate-pulse">
                <div className="h-4 bg-slate-800 rounded w-3/4" />
                <div className="h-4 bg-slate-800/60 rounded w-1/2" />
                <div className="h-4 bg-slate-800/40 rounded w-5/6" />
                <div className="h-4 bg-slate-800/70 rounded w-2/3" />
                <div className="h-4 bg-slate-800/50 rounded w-4/5" />
                <div className="h-4 bg-slate-800/60 rounded w-3/5" />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-inherit">{textContent}</pre>
            )}
          </div>
        </div>
      );
    }

    // 5. PDF Document (True Full Width & Height)
    if (file.mime_type.includes('pdf') || /\.pdf$/i.test(file.name)) {
      return (
        <div className="flex-1 w-full h-full relative p-1 sm:p-2">
          {mediaLoading && renderLoader('Loading PDF Document...')}
          <iframe
            src={streamUrl}
            title={file.name}
            onLoad={() => setMediaLoading(false)}
            className={`w-full h-full border-0 rounded-xl shadow-2xl transition-opacity duration-300 ${
              mediaLoading ? 'opacity-0' : 'opacity-100'
            }`}
          />
        </div>
      );
    }

    // 6. Generic File Fallback
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4 w-full h-full bg-slate-950/40">
        <div className="w-24 h-24 rounded-3xl bg-slate-800/60 border border-slate-700 flex items-center justify-center text-slate-400 shadow-2xl">
          <FileText className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-200">{file.name}</h3>
          <p className="text-xs text-slate-400 mt-1">{file.mime_type}</p>
        </div>
        <p className="text-xs text-slate-500 max-w-md">
          In-browser preview is not available for this format. You can download the file directly.
        </p>
        <button
          onClick={() => onDownload(file)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-sky-500/25 cursor-pointer transform hover:-translate-y-0.5"
        >
          <Download className="w-4 h-4" />
          <span>Download File ({formatBytes(file.size)})</span>
        </button>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] w-full h-full flex flex-col bg-slate-950/95 backdrop-blur-2xl animate-fade-in overflow-hidden select-none"
    >
      {/* Full-Width Header Bar */}
      <div className="h-16 px-4 sm:px-6 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-xl flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            {file.category === 'images' ? (
              <ImageIcon className="w-4 h-4" />
            ) : file.category === 'videos' ? (
              <Film className="w-4 h-4" />
            ) : file.category === 'audio' ? (
              <Music className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100 truncate max-w-xs sm:max-w-md md:max-w-xl" title={file.name}>
              {file.name}
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-sky-400">{file.category}</span>
              <span>&bull;</span>
              <span className="font-mono">{formatBytes(file.size)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Metadata Drawer Toggle */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all cursor-pointer text-xs font-semibold ${
              showDetails
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm shadow-sky-500/20'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
            title="File Information & Metadata"
          >
            <Info className="w-4 h-4 text-sky-400" />
            <span className="hidden sm:inline">Details</span>
          </button>

          {/* Fullscreen Mode Toggle */}
          <button
            onClick={toggleBrowserFullscreen}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer hidden sm:flex"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Direct Download Button */}
          <button
            onClick={() => onDownload(file)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition-all cursor-pointer transform hover:-translate-y-0.5"
            title="Download file"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>

          {/* Move to Recycle Bin Button */}
          {onTrash && (
            <button
              onClick={() => onTrash(file)}
              className="p-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-400 hover:text-red-300 border border-red-500/30 transition-colors cursor-pointer"
              title="Move to Recycle Bin"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Close Modal Button */}
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
            title="Close Preview (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Full-Width Main Viewer Area & Slide-over Inspector */}
      <div className="flex-1 flex overflow-hidden relative w-full h-[calc(100vh-4rem)]">
        {/* Main Content Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden w-full h-full">{renderViewer()}</div>

        {/* Details Inspector Sidebar */}
        {showDetails && (
          <div className="w-80 sm:w-96 border-l border-slate-800/80 bg-slate-900/95 backdrop-blur-2xl p-6 overflow-y-auto space-y-5 text-xs text-slate-300 shrink-0 animate-fade-in shadow-2xl z-30">
            <h4 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Info className="w-4 h-4 text-sky-400" />
              <span>File Details & Metadata</span>
            </h4>

            <div className="space-y-4 divide-y divide-slate-800/80">
              <div className="space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">File Name</span>
                <p className="text-slate-200 font-medium break-all">{file.name}</p>
              </div>

              <div className="pt-3.5 space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">File Size</span>
                <p className="text-slate-200 font-mono font-medium">{formatBytes(file.size)}</p>
              </div>

              <div className="pt-3.5 space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">MIME Type</span>
                <p className="text-slate-200 font-mono text-[11px] break-all">{file.mime_type}</p>
              </div>

              <div className="pt-3.5 space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">Category</span>
                <p className="text-sky-400 capitalize font-medium">{file.category}</p>
              </div>

              <div className="pt-3.5 space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">Uploaded Date</span>
                <p className="text-slate-200">{formatDate(file.created_at)}</p>
              </div>

              <div className="pt-3.5 space-y-1">
                <span className="text-slate-500 text-[11px] uppercase font-semibold">Storage Location</span>
                <div className="flex items-center gap-1.5 text-sky-400 font-medium mt-1">
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {file.storage_type === 'telegram'
                      ? 'Telegram Cloud Storage'
                      : 'Local Cache'}
                  </span>
                </div>
                {file.telegram_msg_id && (
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Telegram Message ID: #{file.telegram_msg_id}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
