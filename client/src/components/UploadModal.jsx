import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X, Cloud } from 'lucide-react';
import { formatBytes } from '../utils';

export default function UploadModal({
  uploadQueue,
  isUploading,
  uploadProgress,
  onDismiss,
  autoCloseDelay = 3500,
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef(null);

  // Check if all items in queue are successfully done
  const isAllDone =
    !isUploading &&
    Array.isArray(uploadQueue) &&
    uploadQueue.length > 0 &&
    uploadQueue.every((item) => item.status === 'done');

  // Any errors in the queue?
  const hasErrors =
    Array.isArray(uploadQueue) &&
    uploadQueue.some((item) => item.status === 'error');

  // Per-status counters so a partially failed batch is described precisely
  const totalCount = Array.isArray(uploadQueue) ? uploadQueue.length : 0;
  const doneCount = Array.isArray(uploadQueue)
    ? uploadQueue.filter((item) => item.status === 'done').length
    : 0;
  const errorCount = Array.isArray(uploadQueue)
    ? uploadQueue.filter((item) => item.status === 'error').length
    : 0;

  // Trigger dismissal with smooth exit transition
  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onDismiss?.();
      setIsClosing(false);
    }, 280);
  };

  useEffect(() => {
    // If not in all-done state or there are errors, cancel any pending auto-dismiss
    if (!isAllDone || hasErrors) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsClosing(false);
      return;
    }

    // If hovered, pause auto-dismiss
    if (isHovered) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Start auto-dismiss countdown
    timerRef.current = setTimeout(() => {
      handleClose();
    }, autoCloseDelay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isAllDone, hasErrors, isHovered, autoCloseDelay]);

  if (!uploadQueue || uploadQueue.length === 0) return null;

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 w-auto sm:w-96 max-w-[calc(100vw-2rem)] z-40 glass-modal rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl bg-white dark:bg-gray-900 select-none transition-all duration-300 ease-out ${
        isClosing
          ? 'opacity-0 translate-y-3 scale-95 pointer-events-none'
          : 'opacity-100 translate-y-0 scale-100 animate-fade-in'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploading ? (
            <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
          ) : hasErrors ? (
            <AlertCircle className="w-4 h-4 text-rose-500" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          )}
          <span className="text-xs font-bold text-gray-800 dark:text-gray-100">
            {isUploading
              ? `Uploading ${doneCount + errorCount} of ${totalCount} file(s)...`
              : hasErrors
              ? `Upload finished — ${doneCount}/${totalCount} uploaded, ${errorCount} failed`
              : `Uploaded ${doneCount} of ${totalCount} file(s)`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isAllDone && !hasErrors && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
              {isHovered ? 'Paused' : 'Auto-closing'}
            </span>
          )}
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Overall Progress Bar (During Upload) */}
      {isUploading && (
        <div className="w-full bg-gray-200 dark:bg-gray-800 h-1 overflow-hidden">
          <div
            className="bg-gradient-to-r from-rose-500 via-pink-500 to-red-600 h-full transition-all duration-300 ease-out"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* Auto-Dismiss Countdown Bar (When Upload Completed Successfully) */}
      {isAllDone && !hasErrors && (
        <div className="w-full bg-emerald-500/15 dark:bg-emerald-950/40 h-0.5 overflow-hidden">
          <div
            className="bg-emerald-500 h-full origin-left"
            style={{
              animation: `uploadCountdown ${autoCloseDelay}ms linear forwards`,
              animationPlayState: isHovered ? 'paused' : 'running',
            }}
          />
        </div>
      )}

      {/* File List */}
      <div className="p-3 max-h-56 overflow-y-auto space-y-3 divide-y divide-gray-100 dark:divide-gray-800">
        {uploadQueue.map((item, idx) => {
          const itemPercent = item.percent !== undefined ? item.percent : uploadProgress;
          return (
            <div key={idx} className="pt-2.5 first:pt-0 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                      {formatBytes(item.size)}
                    </span>
                    {item.status === 'uploading' && item.speed > 0 && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono font-medium">
                        • {formatBytes(item.speed)}/s
                      </span>
                    )}
                    {item.status === 'uploading' && item.timeRemaining !== null && item.timeRemaining !== undefined && item.timeRemaining > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                        • ~{item.timeRemaining}s left
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {item.status === 'uploading' && (
                    <span className="text-rose-600 dark:text-rose-400 font-mono text-xs font-bold">
                      {itemPercent}%
                    </span>
                  )}
                  {item.status === 'done' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  )}
                  {item.status === 'error' && (
                    <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  )}
                </div>
              </div>

              {/* Real-time Sub-stage badge & Progress Track for active upload */}
              {item.status === 'uploading' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium">
                      {item.stage === 'telegram' ? (
                        <>
                          <Cloud className="w-3 h-3 text-sky-500 animate-pulse" />
                          <span className="text-sky-600 dark:text-sky-400 font-medium">
                            Telegram Cloud Sync ({item.cloudPercent || 0}%)
                          </span>
                        </>
                      ) : (
                        <span>{item.stageText || 'Uploading...'}</span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-rose-500 via-pink-500 to-red-600 h-full transition-all duration-200 ease-out"
                      style={{ width: `${itemPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Failure reason stays visible until the panel is dismissed */}
              {item.status === 'error' && (
                <p
                  className="text-[11px] text-rose-600 dark:text-rose-400 font-medium break-words"
                  title={item.error || 'Upload failed'}
                >
                  {item.error || item.stageText || 'Upload failed.'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {hasErrors && (
        <div className="px-3 pb-3 -mt-1 text-[10px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>
            {errorCount} file(s) failed. Dismiss this panel to retry them individually.
          </span>
        </div>
      )}

      <style>{`
        @keyframes uploadCountdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
