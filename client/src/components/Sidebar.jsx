import React from 'react';
import {
  HardDrive,
  Clock,
  Star,
  Trash2,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  Plus,
  ChevronRight,
  Folder,
  Code2,
  X,
  Cloud,
  LayoutDashboard,
} from 'lucide-react';
import { formatBytes } from '../utils';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({
  currentView,
  setCurrentView,
  selectedCategory,
  setSelectedCategory,
  currentFolderId,
  setCurrentFolderId,
  folders,
  stats,
  authStatus,
  onUploadClick,
  onOpenSettings,
  onNewFolderClick,
  onOpenAdminPanel,
  onOpenDeveloperSection,
  onRefreshData,
  isMobileOpen,
  onCloseMobile,
}) {
  const { currentUser } = useAuth();

  const mainNavItems = [
    { id: 'all',     label: 'All Files',    icon: HardDrive,      count: stats?.totalFiles || 0 },
    { id: 'recent',  label: 'Recent',       icon: Clock },
    { id: 'starred', label: 'Starred',      icon: Star,           count: stats?.starredCount || 0 },
    { id: 'trash',   label: 'Recycle Bin',  icon: Trash2,         count: stats?.trashCount || 0 },
  ];

  const categoryItems = [
    { id: 'images',    label: 'Images',      icon: ImageIcon, dotColor: 'bg-pink-500',    count: stats?.categories?.images?.count    || 0 },
    { id: 'videos',    label: 'Videos',      icon: Film,      dotColor: 'bg-violet-500',  count: stats?.categories?.videos?.count    || 0 },
    { id: 'audio',     label: 'Music',       icon: Music,     dotColor: 'bg-emerald-500', count: stats?.categories?.audio?.count     || 0 },
    { id: 'documents', label: 'Documents',   icon: FileText,  dotColor: 'bg-blue-500',    count: stats?.categories?.documents?.count || 0 },
    { id: 'archives',  label: 'Archives',    icon: Archive,   dotColor: 'bg-amber-500',   count: stats?.categories?.archives?.count  || 0 },
  ];

  const handleLogoClick = () => {
    setCurrentView('all');
    setSelectedCategory(null);
    setCurrentFolderId(null);
    if (onCloseMobile) onCloseMobile();
  };

  const handleMainNavClick = (id) => {
    setCurrentView(id);
    setSelectedCategory(null);
    setCurrentFolderId(null);
  };

  const handleCategoryClick = (id) => {
    setSelectedCategory(id);
    setCurrentView('category');
    setCurrentFolderId(null);
  };

  const handleFolderClick = (folderId) => {
    setCurrentFolderId(folderId);
    setCurrentView('all');
    setSelectedCategory(null);
  };

  // Storage bar segments
  const totalSize = stats?.totalSize || 0;
  const pct = (size) => totalSize ? Math.min(100, Math.max(size > 0 ? 3 : 0, (size / totalSize) * 100)) : 0;

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col bg-white border-r border-gray-200 h-screen select-none transition-transform duration-300 ease-in-out shrink-0 ${
          isMobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* ── Brand Header ── */}
        <div className="px-4 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handleLogoClick}
              className="flex items-center gap-3 group cursor-pointer"
              title="Go to All Files"
            >
              {/* Logo Icon */}
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/30 group-hover:shadow-indigo-600/45 transition-shadow shrink-0">
                <Cloud className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[15px] text-gray-900 tracking-tight group-hover:text-indigo-600 transition-colors">
                    HT Claude
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 leading-none">
                    PRO
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">Admin Storage Panel</p>
              </div>
            </button>

            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 lg:hidden transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Upload Button */}
          <button
            onClick={() => { onUploadClick?.(); onCloseMobile?.(); }}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Files</span>
          </button>
        </div>

        {/* ── Scrollable Nav ── */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">

          {/* Storage Section */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Storage</p>
            <div className="space-y-0.5">
              {mainNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id && !selectedCategory && (item.id !== 'all' || !currentFolderId);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleMainNavClick(item.id)}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        isActive
                          ? 'bg-indigo-200/70 text-indigo-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Developer API */}
              <button
                onClick={onOpenDeveloperSection}
                className={`nav-item ${currentView === 'developer' ? 'active' : ''}`}
              >
                <Code2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span className="flex-1 text-left">Developer API</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                  API
                </span>
              </button>
            </div>
          </div>

          {/* Categories Section */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Categories</p>
            <div className="space-y-0.5">
              {categoryItems.map((cat) => {
                const Icon = cat.icon;
                const isActive = currentView === 'category' && selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat.id)}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cat.dotColor}`} />
                    <Icon className="w-4 h-4 shrink-0 text-gray-400" />
                    <span className="flex-1 text-left">{cat.label}</span>
                    {cat.count > 0 && (
                      <span className="text-[11px] text-gray-400 font-mono">{cat.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folders Section */}
          <div>
            <div className="flex items-center justify-between px-3 mb-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Folders</p>
              <button
                onClick={onNewFolderClick}
                title="New folder"
                className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {(() => {
                const activeFolders = (folders || []).filter(f => !f.is_trash);
                if (activeFolders.length === 0) {
                  return (
                    <p className="px-3 py-2 text-xs text-gray-400 italic">No folders yet</p>
                  );
                }
                return activeFolders.map((folder) => {
                  const isSelected = currentFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => handleFolderClick(folder.id)}
                      className={`nav-item ${isSelected ? 'active' : ''}`}
                    >
                      <Folder
                        className="w-4 h-4 shrink-0"
                        style={{ color: isSelected ? '#4f46e5' : (folder.color || '#9ca3af') }}
                      />
                      <span className="flex-1 text-left truncate text-xs">{folder.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                        isSelected ? 'bg-indigo-200/60 text-indigo-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {folder.file_count || 0}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* ── Bottom: Storage & User ── */}
        <div className="px-4 py-4 border-t border-gray-100 bg-gray-50/60 space-y-3 shrink-0">
          {/* Storage Usage */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 font-medium">Storage Used</span>
              <span className="text-indigo-600 font-bold font-mono">{formatBytes(totalSize)}</span>
            </div>
            <div className="storage-bar">
              <div style={{ width: `${pct(stats?.categories?.images?.size || 0)}%` }}    className="h-full bg-pink-400" title="Images" />
              <div style={{ width: `${pct(stats?.categories?.videos?.size || 0)}%` }}    className="h-full bg-violet-500" title="Videos" />
              <div style={{ width: `${pct(stats?.categories?.audio?.size || 0)}%` }}     className="h-full bg-emerald-500" title="Audio" />
              <div style={{ width: `${pct(stats?.categories?.documents?.size || 0)}%` }} className="h-full bg-blue-500" title="Documents" />
              <div style={{ width: `${pct(stats?.categories?.archives?.size || 0)}%` }}  className="h-full bg-amber-400" title="Archives" />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>{stats?.totalFiles || 0} files</span>
              <span>Unlimited • Telegram Cloud</span>
            </div>
          </div>

          {/* User Card → opens Admin Panel */}
          {currentUser && (
            <button
              onClick={onOpenAdminPanel}
              className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all cursor-pointer group text-left"
              title="Open Admin Panel"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="Avatar" className="w-full h-full rounded-lg object-cover" />
                ) : (
                  (currentUser.displayName || currentUser.email || 'A')[0].toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 group-hover:text-indigo-700 transition-colors truncate">
                  {currentUser.displayName || currentUser.email?.split('@')[0]}
                </p>
                <p className="text-[10px] text-emerald-600 font-medium">● Admin • Online</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
