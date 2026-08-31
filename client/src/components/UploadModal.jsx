import React from 'react';
import { CloudUpload, CheckCircle2, AlertCircle, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { formatBytes } from '../utils';

export default function UploadModal({
  uploadQueue,
  isUploading,
  uploadProgress,
  onDismiss,
}) {
  if (!uploadQueue || uploadQueue.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 w-96 glass-modal rounded-2xl overflow-hidden border border-slate-700/80 shadow-2xl animate-fade-in">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploading ? (
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          <span className="text-xs font-bold text-slate-200">
            {isUploading
              ? `Uploading ${uploadQueue.length} file(s)...`
              : `Uploaded ${uploadQueue.length} file(s)`}
          </span>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress Bar */}
      {isUploading && (
        <div className="w-full bg-slate-800 h-1 overflow-hidden">
          <div
            className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-300 ease-out"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* File List */}
      <div className="p-3 max-h-52 overflow-y-auto space-y-2 divide-y divide-slate-800/40">
        {uploadQueue.map((item, idx) => (
          <div key={idx} className="pt-2 first:pt-0 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-200 truncate">{item.name}</p>
              <p className="text-[10px] text-slate-400 font-mono">{formatBytes(item.size)}</p>
            </div>

            <div>
              {item.status === 'uploading' && (
                <span className="text-cyan-400 font-mono text-[11px] font-bold">
                  {uploadProgress}%
                </span>
              )}
              {item.status === 'done' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              {item.status === 'error' && (
                <AlertCircle className="w-4 h-4 text-red-400" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
