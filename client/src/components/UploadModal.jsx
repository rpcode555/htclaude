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
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 w-auto sm:w-96 max-w-[calc(100vw-2rem)] z-40 glass-modal rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl animate-fade-in bg-white dark:bg-gray-900 select-none">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploading ? (
            <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          )}
          <span className="text-xs font-bold text-gray-800 dark:text-gray-100">
            {isUploading
              ? `Uploading ${uploadQueue.length} file(s)...`
              : `Uploaded ${uploadQueue.length} file(s)`}
          </span>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress Bar */}
      {isUploading && (
        <div className="w-full bg-gray-200 dark:bg-gray-800 h-1 overflow-hidden">
          <div
            className="bg-gradient-to-r from-rose-500 to-red-600 h-full transition-all duration-300 ease-out"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* File List */}
      <div className="p-3 max-h-52 overflow-y-auto space-y-2 divide-y divide-gray-100 dark:divide-gray-800">
        {uploadQueue.map((item, idx) => (
          <div key={idx} className="pt-2 first:pt-0 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{item.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{formatBytes(item.size)}</p>
            </div>

            <div>
              {item.status === 'uploading' && (
                <span className="text-rose-600 dark:text-rose-400 font-mono text-[11px] font-bold">
                  {uploadProgress}%
                </span>
              )}
              {item.status === 'done' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              )}
              {item.status === 'error' && (
                <AlertCircle className="w-4 h-4 text-rose-500" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
