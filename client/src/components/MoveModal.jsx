import React, { useState } from 'react';
import { X, FolderInput, Folder, Home } from 'lucide-react';

export default function MoveModal({ isOpen, onClose, folders, onMove, selectedCount }) {
  const [targetFolderId, setTargetFolderId] = useState('root');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onMove(targetFolderId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="glass-modal w-full max-w-md rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-5 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500">
              <FolderInput className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Move Files</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Moving {selectedCount} item(s)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Select Destination</label>
            <div className="max-h-60 overflow-y-auto space-y-1 bg-gray-50 dark:bg-gray-950 rounded-2xl p-2 border border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setTargetFolderId('root')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  targetFolderId === 'root'
                    ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-850'
                }`}
              >
                <Home className="w-4 h-4 text-rose-500" />
                <span>My Cloud (Root)</span>
              </button>

              {(folders || []).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTargetFolderId(f.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    targetFolderId === f.id
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 font-semibold'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-850'
                  }`}
                >
                  <Folder className="w-4 h-4" style={{ color: f.color || '#e11d48' }} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
            >
              Move Here
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
