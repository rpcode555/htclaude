import React, { useState } from 'react';
import {
  Folder,
  File,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  MoreVertical,
  Download,
  Eye,
  Star,
  Trash2,
  RotateCcw,
  Edit2,
  FolderInput,
  CheckSquare,
  Square,
  ChevronRight,
  Home,
  CloudUpload,
  Plus,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';
import { formatBytes, formatDate } from '../utils';

// ── Category styling map ──────────────────────────────────────────────
const CATEGORY_STYLE = {
  images:    { badge: 'badge-rose',    iconBg: 'bg-rose-50 dark:bg-rose-950/50',    iconColor: 'text-rose-500' },
  videos:    { badge: 'badge-violet',  iconBg: 'bg-violet-50 dark:bg-violet-950/50',  iconColor: 'text-violet-500' },
  audio:     { badge: 'badge-emerald', iconBg: 'bg-emerald-50 dark:bg-emerald-950/50', iconColor: 'text-emerald-600' },
  documents: { badge: 'badge-blue',    iconBg: 'bg-blue-50 dark:bg-blue-950/50',    iconColor: 'text-blue-500' },
  archives:  { badge: 'badge-amber',   iconBg: 'bg-amber-50 dark:bg-amber-950/50',   iconColor: 'text-amber-600' },
  default:   { badge: 'badge-gray',    iconBg: 'bg-slate-100 dark:bg-slate-800',   iconColor: 'text-slate-500' },
};

function getCategoryStyle(category) {
  return CATEGORY_STYLE[category?.toLowerCase()] || CATEGORY_STYLE.default;
}

function FileCategoryIcon({ category, className = 'w-5 h-5' }) {
  switch (category?.toLowerCase()) {
    case 'images':    return <ImageIcon className={`${className} text-rose-500`} />;
    case 'videos':    return <Film      className={`${className} text-violet-500`} />;
    case 'audio':     return <Music     className={`${className} text-emerald-600`} />;
    case 'documents': return <FileText  className={`${className} text-blue-500`} />;
    case 'archives':  return <Archive   className={`${className} text-amber-600`} />;
    default:          return <File      className={`${className} text-slate-400`} />;
  }
}

export default function FileExplorer({
  files,
  folders,
  loadingFiles = false,
  currentFolderId,
  setCurrentFolderId,
  currentView,
  selectedCategory,
  viewMode,
  selectedFiles,
  setSelectedFiles,
  onFileClick,
  onDownloadFile,
  onToggleStar,
  onTrashFile,
  onRestoreFile,
  onDeletePermanent,
  onRenameFile,
  onMoveFiles,
  onOpenFolderModal,
  onDeleteFolder,
  onRestoreFolder,
  onDeleteFolderPermanent,
  onEmptyTrash,
  onUploadTrigger,
  isDragOver,
}) {
  const safeFiles         = Array.isArray(files)         ? files         : [];
  const safeFolders       = Array.isArray(folders)       ? folders       : [];
  const safeSelectedFiles = Array.isArray(selectedFiles) ? selectedFiles : [];

  const currentFolder   = safeFolders.find(f => f.id === currentFolderId);
  const activeSubfolders = safeFolders.filter(f => {
    if (f.is_trash) return false;
    return currentFolderId ? f.parent_id === currentFolderId : !f.parent_id;
  });
  const trashedFolders = safeFolders.filter(f => f.is_trash === 1);

  // Breadcrumbs
  const getBreadcrumbs = () => {
    const crumbs = [{ id: null, name: 'My Cloud' }];
    if (!currentFolderId) return crumbs;
    const findPath = (targetId) => {
      const f = safeFolders.find(item => item.id === targetId);
      if (!f) return;
      if (f.parent_id) findPath(f.parent_id);
      crumbs.push({ id: f.id, name: f.name });
    };
    findPath(currentFolderId);
    return crumbs;
  };
  const breadcrumbs = getBreadcrumbs();

  const toggleSelectFile = (id, e) => {
    e.stopPropagation();
    setSelectedFiles(
      safeSelectedFiles.includes(id)
        ? safeSelectedFiles.filter(item => item !== id)
        : [...safeSelectedFiles, id]
    );
  };
  const toggleSelectAll = () => {
    setSelectedFiles(
      safeSelectedFiles.length === safeFiles.length ? [] : safeFiles.map(f => f.id)
    );
  };

  // Hover prefetch for images
  const handleFileHover = (file) => {
    if (file?.category === 'images') {
      const img = new Image();
      img.src = api.getStreamUrl(file.id);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto relative p-4 sm:p-6 space-y-5 select-none animate-fade-in">

      {/* ── Drag & Drop Overlay ── */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-300 dark:border-rose-700 flex items-center justify-center mb-4 shadow-lg">
            <CloudUpload className="w-8 h-8 text-rose-600 dark:text-rose-400" />
          </div>
          <h2 className="text-xl font-bold text-rose-700 dark:text-rose-300">Drop files to upload</h2>
          <p className="text-sm text-rose-500 font-medium mt-1">Files will be stored permanently in your secure cloud</p>
        </div>
      )}

      {/* ── Breadcrumb Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={crumb.id || 'root'} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />}
                <button
                  onClick={() => setCurrentFolderId(crumb.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-xs ${
                    isLast
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {idx === 0 && <Home className="w-3.5 h-3.5 text-rose-500" />}
                  <span>{crumb.name}</span>
                </button>
              </div>
            );
          })}

          {selectedCategory && (
            <div className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
              <span className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold uppercase text-xs tracking-wider border border-rose-200 dark:border-rose-800/80 shadow-xs">
                {selectedCategory}
              </span>
            </div>
          )}

          {currentView === 'trash' && (
            <div className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
              <span className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold border border-rose-200 dark:border-rose-800/80 text-xs shadow-xs">
                Recycle Bin
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {currentFolderId && currentView !== 'trash' && (
            <button
              onClick={onUploadTrigger}
              className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload to {currentFolder?.name || 'Folder'}</span>
            </button>
          )}

          {currentView === 'trash' && safeFiles.length > 0 && (
            <button
              onClick={onEmptyTrash}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Empty Bin</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Batch Selection Toolbar ── */}
      {safeSelectedFiles.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 animate-fade-in shadow-xs">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-rose-800 dark:text-rose-200">
            <CheckSquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>{safeSelectedFiles.length} item{safeSelectedFiles.length !== 1 ? 's' : ''} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onMoveFiles(safeSelectedFiles)}
              className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <FolderInput className="w-3.5 h-3.5 text-rose-500" />
              Move to...
            </button>
            {currentView === 'trash' ? (
              <>
                <button
                  onClick={() => onRestoreFile(safeSelectedFiles)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore
                </button>
                <button
                  onClick={() => onDeletePermanent(safeSelectedFiles)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Forever
                </button>
              </>
            ) : (
              <button
                onClick={() => onTrashFile(safeSelectedFiles)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Move to Trash
              </button>
            )}
            <button
              onClick={() => setSelectedFiles([])}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-2 py-1 font-semibold cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── FOLDERS SECTION ── */}
      {!selectedCategory && currentView !== 'trash' && activeSubfolders.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Folder className="w-4 h-4 text-rose-500" />
            <span>Folders ({activeSubfolders.length})</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {activeSubfolders.map(folder => (
              <div
                key={folder.id}
                onDoubleClick={() => setCurrentFolderId(folder.id)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-700 shadow-xs hover:shadow-md p-3.5 rounded-2xl cursor-pointer flex items-center justify-between gap-2 group transition-all"
              >
                <div
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="flex items-center gap-2.5 min-w-0 flex-1"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs"
                    style={{ backgroundColor: `${folder.color || '#e11d48'}18` }}
                  >
                    <Folder className="w-5 h-5" style={{ color: folder.color || '#e11d48' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 truncate transition-colors">
                      {folder.name}
                    </p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                      {folder.file_count || 0} {folder.file_count === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-all cursor-pointer"
                  title="Move to Trash"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── TRASHED FOLDERS ── */}
      {currentView === 'trash' && trashedFolders.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-xs font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-2">
            <Folder className="w-4 h-4 text-rose-500" />
            <span>Deleted Folders ({trashedFolders.length})</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {trashedFolders.map(folder => (
              <div
                key={folder.id}
                className="p-3.5 rounded-2xl flex items-center justify-between gap-3 bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center shrink-0">
                    <Folder className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{folder.name}</p>
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">Deleted folder</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRestoreFolder?.(folder.id)}
                    className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 text-emerald-800 dark:text-emerald-200 transition-colors cursor-pointer border border-emerald-200 dark:border-emerald-800 font-bold"
                    title="Restore"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteFolderPermanent?.(folder.id)}
                    className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/60 hover:bg-rose-200 text-rose-700 dark:text-rose-200 transition-colors cursor-pointer border border-rose-200 dark:border-rose-800 font-bold"
                    title="Delete permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── FILES SECTION ── */}
      <section className="space-y-3 flex-1 flex flex-col">
        {/* Files header */}
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Files ({safeFiles.length})
          </h3>
          {safeFiles.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 font-bold transition-colors cursor-pointer"
            >
              {safeSelectedFiles.length === safeFiles.length
                ? <><CheckSquare className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" /> Deselect All</>
                : <><Square className="w-3.5 h-3.5" /> Select All</>
              }
            </button>
          )}
        </div>

        {/* ── Skeleton Loading ── */}
        {loadingFiles && safeFiles.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="skeleton w-4 h-4 rounded" />
                  <div className="skeleton w-14 h-4 rounded-full" />
                  <div className="skeleton w-4 h-4 rounded" />
                </div>
                <div className="flex justify-center py-4">
                  <div className="skeleton w-12 h-12 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <div className="skeleton w-3/4 h-3 rounded" />
                  <div className="flex justify-between">
                    <div className="skeleton w-1/3 h-2.5 rounded" />
                    <div className="skeleton w-1/4 h-2.5 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty State ── */}
        {!loadingFiles && safeFiles.length === 0 && (
          currentView === 'trash'
            ? trashedFolders.length === 0
            : activeSubfolders.length === 0
        ) && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/70 dark:bg-slate-900/40 my-2">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center mb-4 shadow-sm">
              {currentView === 'trash'
                ? <Trash2 className="w-8 h-8 text-rose-500" />
                : <CloudUpload className="w-8 h-8 text-rose-500" />
              }
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
              {currentView === 'trash' ? 'Recycle bin is empty' : 'No files here yet'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xs mb-6 font-medium">
              {currentView === 'trash'
                ? 'Deleted files appear here until permanently removed or restored.'
                : 'Drag & drop files anywhere, or click Upload to store directly to your secure cloud.'}
            </p>
            {currentView !== 'trash' && (
              <button
                onClick={onUploadTrigger}
                className="btn-primary px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
              >
                Upload Files Now
              </button>
            )}
          </div>
        )}

        {/* ── No files but folders exist hint ── */}
        {!loadingFiles && safeFiles.length === 0 && currentView !== 'trash' && activeSubfolders.length > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-semibold shadow-xs">
            <CloudUpload className="w-4 h-4 shrink-0 text-rose-500" />
            <span>No files in this folder. Open a subfolder or click Upload to add files here.</span>
          </div>
        )}

        {/* ── GRID VIEW ── */}
        {viewMode === 'grid' && safeFiles.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {safeFiles.map(file => {
              const isSelected = safeSelectedFiles.includes(file.id);
              const style = getCategoryStyle(file.category);

              return (
                <div
                  key={file.id}
                  onClick={() => onFileClick(file)}
                  onMouseEnter={() => handleFileHover(file)}
                  className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-700 shadow-xs hover:shadow-md rounded-2xl p-3 flex flex-col justify-between cursor-pointer group transition-all relative ${
                    isSelected ? '!border-rose-500 !bg-rose-50/50 dark:!bg-rose-950/40 shadow-md shadow-rose-500/10' : ''
                  }`}
                >
                  {/* Top Row */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <button
                      onClick={e => toggleSelectFile(file.id, e)}
                      className={`p-0.5 rounded transition-colors cursor-pointer ${isSelected ? 'text-rose-600 dark:text-rose-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-slate-500'}`}
                    >
                      {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                    <span className={`badge ${style.badge} text-[9px]`}>{file.category}</span>
                    {currentView !== 'trash' && (
                      <button
                        onClick={e => { e.stopPropagation(); onToggleStar(file.id, !file.is_starred); }}
                        className={`p-0.5 rounded transition-colors cursor-pointer ${file.is_starred ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-slate-400 hover:text-amber-400'}`}
                        title={file.is_starred ? 'Starred' : 'Star'}
                      >
                        <Star className={`w-3.5 h-3.5 ${file.is_starred ? 'fill-amber-400' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Thumbnail / Icon */}
                  <div className="flex flex-col items-center justify-center py-2 flex-1">
                    {file.category === 'images' ? (
                      <div className="w-full h-20 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center">
                        <img
                          src={api.getStreamUrl(file.id)}
                          alt={file.name}
                          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${style.iconBg} group-hover:scale-105 transition-transform`}>
                        <FileCategoryIcon category={file.category} />
                      </div>
                    )}
                  </div>

                  {/* Bottom Info */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 truncate transition-colors" title={file.name}>
                      {file.name}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                      <span className="font-mono">{formatBytes(file.size)}</span>
                      <span>{formatDate(file.created_at)}</span>
                    </div>
                  </div>

                  {/* Hover Action Bar */}
                  <div className="absolute inset-x-2 bottom-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1 shadow-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-around">
                    <button onClick={e => { e.stopPropagation(); onFileClick(file); }} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Preview">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDownloadFile(file); }} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Download">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onRenameFile(file); }} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Rename">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {currentView === 'trash' ? (
                      <>
                        <button onClick={e => { e.stopPropagation(); onRestoreFile([file.id]); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer" title="Restore">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); onDeletePermanent([file.id]); }} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" title="Delete Forever">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); onTrashFile([file.id]); }} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" title="Move to Trash">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && safeFiles.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                    <th className="w-10 text-center">
                      <button onClick={toggleSelectAll} className="cursor-pointer flex items-center justify-center mx-auto">
                        {safeSelectedFiles.length === safeFiles.length
                          ? <CheckSquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                          : <Square className="w-4 h-4 text-slate-400" />
                        }
                      </button>
                    </th>
                    <th className="text-slate-800 dark:text-slate-200 font-bold">Name</th>
                    <th className="w-28 text-slate-800 dark:text-slate-200 font-bold">Type</th>
                    <th className="w-24 text-slate-800 dark:text-slate-200 font-bold">Size</th>
                    <th className="w-32 text-slate-800 dark:text-slate-200 font-bold">Uploaded</th>
                    <th className="w-28 text-right text-slate-800 dark:text-slate-200 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {safeFiles.map(file => {
                    const isSelected = safeSelectedFiles.includes(file.id);
                    const style = getCategoryStyle(file.category);
                    return (
                      <tr
                        key={file.id}
                        onClick={() => onFileClick(file)}
                        onMouseEnter={() => handleFileHover(file)}
                        className={`group border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${isSelected ? 'bg-rose-50/60 dark:bg-rose-950/40' : ''}`}
                      >
                        <td className="text-center" onClick={e => toggleSelectFile(file.id, e)}>
                          <button className="cursor-pointer flex items-center justify-center mx-auto">
                            {isSelected
                              ? <CheckSquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                              : <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-500" />
                            }
                          </button>
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${style.iconBg} shrink-0`}>
                              <FileCategoryIcon category={file.category} className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 truncate max-w-xs transition-colors">
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${style.badge}`}>{file.category}</span>
                        </td>
                        <td className="font-mono font-semibold text-slate-600 dark:text-slate-300">{formatBytes(file.size)}</td>
                        <td className="text-slate-600 dark:text-slate-400 font-medium">{formatDate(file.created_at)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={e => { e.stopPropagation(); onFileClick(file); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Preview"><Eye className="w-4 h-4" /></button>
                            <button onClick={e => { e.stopPropagation(); onDownloadFile(file); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Download"><Download className="w-4 h-4" /></button>
                            <button onClick={e => { e.stopPropagation(); onRenameFile(file); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer" title="Rename"><Edit2 className="w-4 h-4" /></button>
                            {currentView === 'trash' ? (
                              <>
                                <button onClick={e => { e.stopPropagation(); onRestoreFile([file.id]); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer" title="Restore"><RotateCcw className="w-4 h-4" /></button>
                                <button onClick={e => { e.stopPropagation(); onDeletePermanent([file.id]); }} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" title="Delete Forever"><Trash2 className="w-4 h-4" /></button>
                              </>
                            ) : (
                              <button onClick={e => { e.stopPropagation(); onTrashFile([file.id]); }} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" title="Move to Trash"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
