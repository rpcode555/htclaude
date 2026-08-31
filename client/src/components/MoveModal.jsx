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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="glass-modal w-full max-w-md rounded-3xl overflow-hidden border border-slate-700/80 shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <FolderInput className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Move Files</h3>
              <p className="text-[11px] text-slate-400">Moving {selectedCount} item(s)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Select Destination</label>
            <div className="max-h-60 overflow-y-auto space-y-1 bg-slate-900/90 rounded-2xl p-2 border border-slate-800">
              <button
                type="button"
                onClick={() => setTargetFolderId('root')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  targetFolderId === 'root'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <Home className="w-4 h-4" />
                <span>My Cloud (Root)</span>
              </button>

              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTargetFolderId(f.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    targetFolderId === f.id
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <Folder className="w-4 h-4" style={{ color: f.color || '#38bdf8' }} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition-all cursor-pointer"
            >
              Move Here
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
