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
  Play,
  Share2,
  Plus,
  Upload,
} from 'lucide-react';
import { api } from '../api';
import { formatBytes, formatDate, getFileCategoryColor } from '../utils';

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
  const [activeContextMenu, setActiveContextMenu] = useState(null);

  const safeFiles = Array.isArray(files) ? files : [];
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeSelectedFiles = Array.isArray(selectedFiles) ? selectedFiles : [];

  // Get current folder object and breadcrumbs
  const currentFolder = safeFolders.find((f) => f.id === currentFolderId);

  const getBreadcrumbs = () => {
    const crumbs = [{ id: null, name: 'My Cloud' }];
    if (!currentFolderId) return crumbs;

    const findPath = (targetId) => {
      const f = safeFolders.find((item) => item.id === targetId);
      if (!f) return;
      if (f.parent_id) findPath(f.parent_id);
      crumbs.push({ id: f.id, name: f.name });
    };

    findPath(currentFolderId);
    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  // Intelligent media prefetch on hover for 0ms preview opening
  const handleFileHover = (file) => {
    if (!file || !file.id) return;
    if (file.category === 'images') {
      const img = new Image();
      img.src = api.getStreamUrl(file.id);
    }
  };

  // Active child folders in current folder
  const activeSubfolders = safeFolders.filter((f) => {
    if (f.is_trash) return false;
    if (!currentFolderId) return !f.parent_id;
    return f.parent_id === currentFolderId;
  });

  // Trashed folders in Recycle Bin
  const trashedFolders = safeFolders.filter((f) => f.is_trash === 1);

  // Toggle selection
  const toggleSelectFile = (id, e) => {
    e.stopPropagation();
    if (safeSelectedFiles.includes(id)) {
      setSelectedFiles(safeSelectedFiles.filter((item) => item !== id));
    } else {
      setSelectedFiles([...safeSelectedFiles, id]);
    }
  };

  const toggleSelectAll = () => {
    if (safeSelectedFiles.length === safeFiles.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(safeFiles.map((f) => f.id));
    }
  };

  const getFileCategoryIcon = (category) => {
    switch (category?.toLowerCase()) {
      case 'images':
        return <ImageIcon className="w-5 h-5 text-pink-400" />;
      case 'videos':
        return <Film className="w-5 h-5 text-purple-400" />;
      case 'audio':
        return <Music className="w-5 h-5 text-emerald-400" />;
      case 'documents':
        return <FileText className="w-5 h-5 text-blue-400" />;
      case 'archives':
        return <Archive className="w-5 h-5 text-amber-400" />;
      default:
        return <File className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto relative bg-transparent p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-cyan-950/80 backdrop-blur-md border-2 border-dashed border-cyan-400 rounded-3xl m-4 flex flex-col items-center justify-center text-cyan-300 pointer-events-none animate-pulse">
          <CloudUpload className="w-16 h-16 mb-4 text-cyan-400" />
          <h2 className="text-2xl font-bold">Drop files here to upload to Hightech Claude Storage</h2>
          <p className="text-sm text-cyan-200/80 mt-2">Unlimited storage with @claudestorage_bot & Saved Messages streaming</p>
        </div>
      )}

      {/* Breadcrumb Navigation & Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        {/* Breadcrumb path */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={crumb.id || 'root'} className="flex items-center gap-1.5">
                {idx > 0 && <ChevronRight className="w-4 h-4 text-slate-600" />}
                <button
                  onClick={() => setCurrentFolderId(crumb.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                    isLast
                      ? 'bg-slate-800/80 text-cyan-300 font-semibold border border-slate-700/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  {idx === 0 && <Home className="w-3.5 h-3.5" />}
                  <span>{crumb.name}</span>
                </button>
              </div>
            );
          })}

          {selectedCategory && (
            <div className="flex items-center gap-1.5">
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 text-cyan-300 font-semibold uppercase text-xs tracking-wider">
                Category: {selectedCategory}
              </span>
            </div>
          )}

          {currentView === 'trash' && (
            <div className="flex items-center gap-1.5">
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <span className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 font-semibold border border-red-500/20 text-xs">
                Recycle Bin
              </span>
            </div>
          )}
        </div>

        {/* Specific Folder Action & Trash Actions */}
        <div className="flex items-center gap-2">
          {currentFolderId && currentView !== 'trash' && (
            <button
              onClick={onUploadTrigger}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 hover:shadow-sky-500/35 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0 animate-fade-in"
              title={currentFolder ? `Upload directly to ${currentFolder.name}` : 'Upload files to this folder'}
            >
              <Plus className="w-4 h-4" />
              <span>{currentFolder ? `Upload to ${currentFolder.name}` : 'Upload to Folder'}</span>
            </button>
          )}

          {/* Trash Actions */}
          {currentView === 'trash' && files.length > 0 && (
            <button
              onClick={onEmptyTrash}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-semibold transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Empty Recycle Bin</span>
            </button>
          )}
        </div>
      </div>

      {/* Batch Selection Toolbar */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-cyan-950/60 border border-cyan-500/30 backdrop-blur-xl shadow-lg shadow-cyan-500/10 animate-fade-in">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200 cursor-pointer"
            >
              <CheckSquare className="w-4 h-4 text-cyan-400" />
              <span>{selectedFiles.length} item(s) selected</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onMoveFiles(selectedFiles)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
            >
              <FolderInput className="w-3.5 h-3.5 text-cyan-400" />
              <span>Move to...</span>
            </button>
            {currentView === 'trash' ? (
              <>
                <button
                  onClick={() => onRestoreFile(selectedFiles)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>
                <button
                  onClick={() => onDeletePermanent(selectedFiles)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Forever</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => onTrashFile(selectedFiles)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Move to Trash</span>
              </button>
            )}
            <button
              onClick={() => setSelectedFiles([])}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Folders Section (Active view) */}
      {!selectedCategory && currentView !== 'trash' && activeSubfolders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span>Folders ({activeSubfolders.length})</span>
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
            {activeSubfolders.map((folder) => (
              <div
                key={folder.id}
                onDoubleClick={() => setCurrentFolderId(folder.id)}
                className="group relative glass-card p-2.5 sm:p-3 rounded-2xl cursor-pointer flex items-center justify-between gap-2 border border-slate-800/80 hover:border-cyan-500/40 transition-all select-none"
              >
                <div
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1"
                >
                  <div
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                    style={{ backgroundColor: `${folder.color}20` }}
                  >
                    <Folder className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: folder.color || '#38bdf8' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white truncate block">
                      {folder.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {folder.file_count || 0} {folder.file_count === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-400 border border-slate-700/60 font-semibold group-hover:border-cyan-500/40 group-hover:text-cyan-300 transition-colors">
                    {folder.file_count || 0}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFolder(folder.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-all"
                    title="Move Folder to Recycle Bin"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trashed Folders in Recycle Bin */}
      {currentView === 'trash' && trashedFolders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
            <Folder className="w-3.5 h-3.5" />
            <span>Deleted Folders in Recycle Bin ({trashedFolders.length})</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {trashedFolders.map((folder) => (
              <div
                key={folder.id}
                className="glass-card p-3 rounded-2xl flex items-center justify-between gap-3 border border-red-500/30 bg-red-950/20 shadow-md shadow-red-500/5 select-none transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm bg-red-500/15 border border-red-500/30">
                    <Folder className="w-4 h-4 text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-200 truncate block">
                      {folder.name}
                    </span>
                    <span className="text-[10px] text-red-400 font-mono">Deleted Folder</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRestoreFolder && onRestoreFolder(folder.id)}
                    className="p-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors cursor-pointer border border-emerald-500/30"
                    title="Restore Folder and its files"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteFolderPermanent && onDeleteFolderPermanent(folder.id)}
                    className="p-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors cursor-pointer border border-red-500/30"
                    title="Delete Folder Permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Section */}
      <div className="space-y-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Files ({files.length})
          </h3>
          {files.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="text-xs text-slate-400 hover:text-cyan-400 font-medium flex items-center gap-1.5 cursor-pointer"
            >
              {selectedFiles.length === files.length ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Deselect All</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" />
                  <span>Select All</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Loading Skeleton State */}
        {loadingFiles && files.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4 animate-pulse">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="glass-card rounded-2xl p-3 sm:p-4 flex flex-col justify-between border border-slate-800/60 bg-slate-900/30 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="w-4 h-4 rounded bg-slate-800" />
                  <div className="w-14 h-4 rounded-full bg-slate-800" />
                  <div className="w-4 h-4 rounded bg-slate-800" />
                </div>
                <div className="flex items-center justify-center py-5">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/80" />
                </div>
                <div className="pt-2 border-t border-slate-800/60 space-y-2">
                  <div className="w-3/4 h-3 bg-slate-800 rounded" />
                  <div className="flex justify-between">
                    <div className="w-1/3 h-2.5 bg-slate-800/60 rounded" />
                    <div className="w-1/4 h-2.5 bg-slate-800/60 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loadingFiles && files.length === 0 && (currentView === 'trash' ? trashedFolders.length === 0 : activeSubfolders.length === 0) && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center border border-dashed border-slate-800 rounded-3xl bg-slate-900/20 my-auto">
            <div className="w-16 h-16 rounded-3xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-4 shadow-lg shadow-sky-500/10">
              {currentView === 'trash' ? <Trash2 className="w-8 h-8 text-red-400" /> : <CloudUpload className="w-8 h-8" />}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-200 mb-1">
              {currentView === 'trash' ? 'Recycle Bin is empty' : 'This folder is empty'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-sm mb-6">
              {currentView === 'trash'
                ? 'Deleted files and folders will appear here until permanently deleted or restored.'
                : 'Drag & drop any files anywhere on the screen or click below to upload directly to your Telegram storage.'}
            </p>
            {currentView !== 'trash' && (
              <button
                onClick={onUploadTrigger}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-sky-500/25 transition-all cursor-pointer transform hover:-translate-y-0.5"
              >
                Upload Files Now
              </button>
            )}
          </div>
        )}

        {/* Grid View */}
        {viewMode === 'grid' && files.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4">
            {files.map((file) => {
              const isSelected = selectedFiles.includes(file.id);
              const colorInfo = getFileCategoryColor(file.category);

              return (
                <div
                  key={file.id}
                  onClick={() => onFileClick(file)}
                  onMouseEnter={() => handleFileHover(file)}
                  className={`group relative glass-card rounded-2xl p-3 sm:p-4 flex flex-col justify-between cursor-pointer border transition-all select-none ${
                    isSelected
                      ? 'border-cyan-500/80 bg-cyan-950/30 shadow-md shadow-cyan-500/10'
                      : 'border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  {/* Card Top: Checkbox, Category Badge, Star */}
                  <div className="flex items-center justify-between gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    <button
                      onClick={(e) => toggleSelectFile(file.id, e)}
                      className={`p-1 rounded-md transition-colors ${
                        isSelected
                          ? 'text-cyan-400'
                          : 'text-slate-500 group-hover:text-slate-300 hover:text-cyan-400'
                      }`}
                    >
                      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>

                    <span
                      className={`text-[9px] sm:text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${colorInfo.badge}`}
                    >
                      {file.category}
                    </span>

                    {currentView !== 'trash' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(file.id, !file.is_starred);
                        }}
                        className={`p-1 rounded-md transition-colors ${
                          file.is_starred
                            ? 'text-amber-400'
                            : 'text-slate-600 group-hover:text-slate-400 hover:text-amber-400'
                        }`}
                        title={file.is_starred ? 'Starred' : 'Star file'}
                      >
                        <Star className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${file.is_starred ? 'fill-amber-400' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Card Body: Thumbnail / Icon Preview */}
                  <div className="flex-1 flex flex-col items-center justify-center py-2 sm:py-3 relative overflow-hidden">
                    {file.category === 'images' ? (
                      <div className="w-full h-24 sm:h-28 rounded-xl bg-slate-950/60 border border-slate-800/80 overflow-hidden flex items-center justify-center relative group-hover:border-cyan-500/40 transition-colors p-1">
                        <img
                          src={api.getStreamUrl(file.id)}
                          alt={file.name}
                          className="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div
                        className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform ${colorInfo.iconBg}`}
                      >
                        {getFileCategoryIcon(file.category)}
                      </div>
                    )}
                  </div>

                  {/* Card Bottom: Name, Size, Date, Actions */}
                  <div className="pt-2 border-t border-slate-800/60">
                    <h4
                      className="text-xs font-semibold text-slate-200 group-hover:text-white truncate mb-0.5"
                      title={file.name}
                    >
                      {file.name}
                    </h4>

                    <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-slate-400">
                      <span className="font-mono">{formatBytes(file.size)}</span>
                      <span>{formatDate(file.created_at)}</span>
                    </div>
                  </div>

                  {/* Quick Action Overlay on Hover */}
                  <div className="absolute inset-x-2 bottom-2 pt-2 bg-slate-900/95 backdrop-blur-md rounded-xl p-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-around border border-slate-700/80 shadow-lg">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onFileClick(file);
                      }}
                      className="p-1.5 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                      title="Preview / Play"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadFile(file);
                      }}
                      className="p-1.5 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRenameFile(file);
                      }}
                      className="p-1.5 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                      title="Rename"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {currentView === 'trash' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestoreFile([file.id]);
                        }}
                        className="p-1.5 text-emerald-400 hover:bg-slate-800 rounded-lg"
                        title="Restore"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTrashFile([file.id]);
                        }}
                        className="p-1.5 text-red-400 hover:bg-slate-800 rounded-lg"
                        title="Move to Recycle Bin"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && files.length > 0 && (
          <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800/80">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 min-w-[600px]">
                <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-semibold select-none">
                  <tr>
                    <th className="p-3.5 w-10 text-center">
                      <button onClick={toggleSelectAll} className="cursor-pointer">
                        {selectedFiles.length === files.length ? (
                          <CheckSquare className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                      </button>
                    </th>
                    <th className="p-3.5">Name</th>
                    <th className="p-3.5 w-32">Category</th>
                    <th className="p-3.5 w-28">Size</th>
                    <th className="p-3.5 w-36">Uploaded</th>
                    <th className="p-3.5 w-28 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {files.map((file) => {
                    const isSelected = selectedFiles.includes(file.id);
                    const colorInfo = getFileCategoryColor(file.category);

                    return (
                      <tr
                        key={file.id}
                        onClick={() => onFileClick(file)}
                        onMouseEnter={() => handleFileHover(file)}
                        className={`hover:bg-slate-800/50 transition-colors cursor-pointer group ${
                          isSelected ? 'bg-cyan-950/25' : ''
                        }`}
                      >
                        <td className="p-3.5 text-center" onClick={(e) => toggleSelectFile(file.id, e)}>
                          <button className="cursor-pointer">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                            )}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${colorInfo.iconBg}`}>
                              {getFileCategoryIcon(file.category)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-200 group-hover:text-white truncate block max-w-xs sm:max-w-md">
                                {file.name}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${colorInfo.badge}`}
                          >
                            {file.category}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono text-slate-400">{formatBytes(file.size)}</td>
                        <td className="p-3.5 text-slate-400">{formatDate(file.created_at)}</td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onFileClick(file);
                              }}
                              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                              title="Preview"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDownloadFile(file);
                              }}
                              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRenameFile(file);
                              }}
                              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg"
                              title="Rename"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {currentView === 'trash' ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRestoreFile([file.id]);
                                }}
                                className="p-1.5 text-emerald-400 hover:bg-slate-800 rounded-lg"
                                title="Restore"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTrashFile([file.id]);
                                }}
                                className="p-1.5 text-red-400 hover:bg-slate-800 rounded-lg"
                                title="Move to Recycle Bin"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
      </div>
    </div>
  );
}
