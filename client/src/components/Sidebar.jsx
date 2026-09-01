import React, { useState } from 'react';
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
  ChevronLeft,
  Folder,
  Code2,
  X,
  Cloud,
  LayoutDashboard,
  Search,
  RotateCcw,
  Power,
  Sliders,
  Shield,
  Layers,
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
  isCollapsed = false,
  onToggleCollapse,
}) {
  const { currentUser, logout } = useAuth();
  const [sidebarSearch, setSidebarSearch] = useState('');

  const mainNavItems = [
    { id: 'all',     label: 'All Files',    subtitle: 'Browse all cloud files',    icon: HardDrive,      count: stats?.totalFiles || 0 },
    { id: 'recent',  label: 'Recent',       subtitle: 'Latest uploads & edits',    icon: Clock },
    { id: 'starred', label: 'Starred',      subtitle: 'Favorite pinned items',     icon: Star,           count: stats?.starredCount || 0 },
    { id: 'trash',   label: 'Recycle Bin',  subtitle: 'Recently deleted files',    icon: Trash2,         count: stats?.trashCount || 0 },
  ];

  const categoryItems = [
    { id: 'images',    label: 'Images',    icon: ImageIcon, dotColor: 'bg-rose-500',    count: stats?.categories?.images?.count    || 0 },
    { id: 'videos',    label: 'Videos',    icon: Film,      dotColor: 'bg-violet-500',  count: stats?.categories?.videos?.count    || 0 },
    { id: 'audio',     label: 'Music',     icon: Music,     dotColor: 'bg-emerald-500', count: stats?.categories?.audio?.count     || 0 },
    { id: 'documents', label: 'Documents', icon: FileText,  dotColor: 'bg-blue-500',    count: stats?.categories?.documents?.count || 0 },
    { id: 'archives',  label: 'Archives',  icon: Archive,   dotColor: 'bg-amber-500',   count: stats?.categories?.archives?.count  || 0 },
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
    if (onCloseMobile) onCloseMobile();
  };

  const handleCategoryClick = (id) => {
    setSelectedCategory(id);
    setCurrentView('category');
    setCurrentFolderId(null);
    if (onCloseMobile) onCloseMobile();
  };

  const handleFolderClick = (folderId) => {
    setCurrentFolderId(folderId);
    setCurrentView('all');
    setSelectedCategory(null);
    if (onCloseMobile) onCloseMobile();
  };

  // Storage bar calculations
  const totalSize = stats?.totalSize || 0;
  const pct = (size) => totalSize ? Math.min(100, Math.max(size > 0 ? 3 : 0, (size / totalSize) * 100)) : 0;

  // Filtered navigation items if search term is provided in sidebar
  const filteredNavItems = sidebarSearch.trim()
    ? mainNavItems.filter((i) => i.label.toLowerCase().includes(sidebarSearch.toLowerCase()))
    : mainNavItems;

  const filteredCategories = sidebarSearch.trim()
    ? categoryItems.filter((c) => c.label.toLowerCase().includes(sidebarSearch.toLowerCase()))
    : categoryItems;

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-white dark:bg-[#0d131f] border-r border-gray-200 dark:border-gray-800/80 h-screen select-none transition-all duration-300 ease-in-out shrink-0 ${
          isCollapsed ? 'w-[74px]' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* ── Top Header: Window Dots & Collapse Toggle ── */}
        <div className="px-4 py-3.5 border-b border-gray-100 dark:border-gray-800/70 shrink-0">
          <div className="flex items-center justify-between">
            {/* Window Dots (macOS style like Screenshot 1) */}
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/90 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/90 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/90 inline-block" />
            </div>

            {/* Desktop Collapse / Expand Toggle Button (< / >) */}
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors cursor-pointer"
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4 text-rose-500" /> : <ChevronLeft className="w-4 h-4" />}
            </button>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Brand Logo & Name */}
          {!isCollapsed ? (
            <div className="mt-3">
              <button
                onClick={handleLogoClick}
                className="flex items-center gap-3 group cursor-pointer text-left w-full"
                title="Go to All Files"
              >
                {/* Logo Icon with Rose Red Glow */}
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center shadow-md shadow-rose-600/30 group-hover:shadow-rose-600/50 transition-all shrink-0">
                  <Cloud className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[15px] text-gray-900 dark:text-white tracking-tight group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors truncate">
                      HT Claude
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 leading-none shrink-0">
                      v3.8
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium truncate">Secure Cloud Storage</p>
                </div>
              </button>

              {/* Upload Button */}
              <div className="mt-3.5">
                <button
                  onClick={() => { onUploadClick?.(); onCloseMobile?.(); }}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Upload Files</span>
                </button>
              </div>

              {/* Sidebar Quick Filter Input */}
              <div className="mt-3 relative">
                <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter menu..."
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-gray-50 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-800 rounded-lg text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:border-rose-500 dark:focus:border-rose-500 transition-all"
                />
              </div>
            </div>
          ) : (
            /* Collapsed Brand Icon & Upload Icon */
            <div className="mt-3 flex flex-col items-center gap-3">
              <button
                onClick={handleLogoClick}
                className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center shadow-md shadow-rose-600/30 cursor-pointer"
                title="HT Claude v3.8 - All Files"
              >
                <Cloud className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={onUploadClick}
                className="w-10 h-10 rounded-xl btn-primary flex items-center justify-center cursor-pointer shadow-md shadow-rose-600/25"
                title="Upload Files"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          )}
        </div>

        {/* ── Scrollable Nav ── */}
        <div className={`flex-1 overflow-y-auto px-2.5 py-3 space-y-5 ${isCollapsed ? 'flex flex-col items-center space-y-4 px-1.5' : ''}`}>

          {/* Storage / Main Section */}
          <div className={isCollapsed ? 'w-full flex flex-col items-center' : ''}>
            {!isCollapsed && (
              <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                Storage
              </p>
            )}
            <div className="space-y-1 w-full">
              {filteredNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id && !selectedCategory && (item.id !== 'all' || !currentFolderId);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleMainNavClick(item.id)}
                    className={`nav-item ${isActive ? 'active' : ''} ${
                      isCollapsed ? 'justify-center p-2.5' : ''
                    }`}
                    title={isCollapsed ? `${item.label} (${item.count || 0})` : undefined}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!isCollapsed && (
                      <>
                        <div className="flex-1 text-left min-w-0">
                          <span className="block font-medium text-xs truncate">{item.label}</span>
                          <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">{item.subtitle}</span>
                        </div>
                        {item.count !== undefined && item.count > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                            isActive
                              ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                          }`}>
                            {item.count}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}

              {/* Developer API */}
              <button
                onClick={() => { onOpenDeveloperSection(); if (onCloseMobile) onCloseMobile(); }}
                className={`nav-item ${currentView === 'developer' ? 'active' : ''} ${
                  isCollapsed ? 'justify-center p-2.5' : ''
                }`}
                title={isCollapsed ? 'Developer API & Integrations' : undefined}
              >
                <Code2 className="w-4 h-4 shrink-0 text-rose-500" />
                {!isCollapsed && (
                  <>
                    <div className="flex-1 text-left min-w-0">
                      <span className="block font-medium text-xs text-gray-900 dark:text-gray-100 truncate">Developer API</span>
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">API keys & code snippets</span>
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
                      API
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Categories Section */}
          <div className={isCollapsed ? 'w-full flex flex-col items-center' : ''}>
            {!isCollapsed && (
              <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                Categories
              </p>
            )}
            <div className="space-y-0.5 w-full">
              {filteredCategories.map((cat) => {
                const Icon = cat.icon;
                const isActive = currentView === 'category' && selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat.id)}
                    className={`nav-item ${isActive ? 'active' : ''} ${
                      isCollapsed ? 'justify-center p-2.5' : ''
                    }`}
                    title={isCollapsed ? `${cat.label} (${cat.count})` : undefined}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cat.dotColor}`} />
                    <Icon className="w-4 h-4 shrink-0 text-gray-400" />
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 text-left text-xs truncate">{cat.label}</span>
                        {cat.count > 0 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{cat.count}</span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folders Section */}
          {!isCollapsed && (
            <div>
              <div className="flex items-center justify-between px-2.5 mb-1.5">
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Folders</p>
                <button
                  onClick={onNewFolderClick}
                  title="New folder"
                  className="p-1 rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                {(() => {
                  const activeFolders = (folders || []).filter(f => !f.is_trash);
                  if (activeFolders.length === 0) {
                    return (
                      <p className="px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500 italic">No folders yet</p>
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
                          style={{ color: isSelected ? '#e11d48' : (folder.color || '#9ca3af') }}
                        />
                        <span className="flex-1 text-left truncate text-xs">{folder.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                          isSelected ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}>
                          {folder.file_count || 0}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom: Storage, User & Admin Actions ── */}
        <div className={`px-3 py-3 border-t border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-gray-900/50 space-y-2.5 shrink-0 ${isCollapsed ? 'px-1.5 py-2 flex flex-col items-center' : ''}`}>
          {/* Storage Usage Bar */}
          {!isCollapsed ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Storage Used</span>
                <span className="text-rose-600 dark:text-rose-400 font-bold font-mono">{formatBytes(totalSize)}</span>
              </div>
              <div className="storage-bar">
                <div style={{ width: `${pct(stats?.categories?.images?.size || 0)}%` }}    className="h-full bg-rose-500" title="Images" />
                <div style={{ width: `${pct(stats?.categories?.videos?.size || 0)}%` }}    className="h-full bg-violet-500" title="Videos" />
                <div style={{ width: `${pct(stats?.categories?.audio?.size || 0)}%` }}     className="h-full bg-emerald-500" title="Audio" />
                <div style={{ width: `${pct(stats?.categories?.documents?.size || 0)}%` }} className="h-full bg-blue-500" title="Documents" />
                <div style={{ width: `${pct(stats?.categories?.archives?.size || 0)}%` }}  className="h-full bg-amber-400" title="Archives" />
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500">
                <span>{stats?.totalFiles || 0} files</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">● Unlimited Storage</span>
              </div>
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-mono text-rose-500 font-bold" title={`Storage: ${formatBytes(totalSize)} / ${stats?.totalFiles || 0} files`}>
              <HardDrive className="w-4 h-4" />
            </div>
          )}

          {/* User Card → opens Admin Center */}
          {currentUser && !isCollapsed && (
            <button
              onClick={() => { onOpenAdminPanel?.(); if (onCloseMobile) onCloseMobile(); }}
              className="w-full flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80 hover:border-rose-300 dark:hover:border-rose-500/50 hover:bg-rose-50/40 dark:hover:bg-rose-950/20 transition-all cursor-pointer group text-left"
              title="Open Admin Center"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="Avatar" className="w-full h-full rounded-lg object-cover" />
                ) : (
                  (currentUser.displayName || currentUser.email || 'A')[0].toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors truncate">
                  {currentUser.displayName || currentUser.email?.split('@')[0]}
                </p>
                <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">● Admin Online</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          )}

          {/* Quick Action Footer Buttons (like Restart / Shutdown in Screenshot 1) */}
          {!isCollapsed ? (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onClick={onRefreshData}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700/80 hover:bg-gray-100 dark:hover:bg-gray-800 text-[11px] font-semibold text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="Refresh All Data"
              >
                <RotateCcw className="w-3 h-3 text-amber-500" />
                <span>Sync / Refresh</span>
              </button>
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-[11px] font-semibold text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
                title="Settings & Config"
              >
                <Sliders className="w-3 h-3 text-rose-500" />
                <span>Settings</span>
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              title="Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
