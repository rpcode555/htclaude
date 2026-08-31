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
    { id: 'all', label: 'All Files', icon: HardDrive, count: stats?.totalFiles || 0 },
    { id: 'recent', label: 'Recent', icon: Clock },
    { id: 'starred', label: 'Starred', icon: Star, count: stats?.starredCount || 0 },
    { id: 'trash', label: 'Recycle Bin', icon: Trash2, count: stats?.trashCount || 0 },
  ];

  const categoryItems = [
    { id: 'images', label: 'Images', icon: ImageIcon, color: 'text-pink-400', count: stats?.categories?.images?.count || 0 },
    { id: 'videos', label: 'Videos', icon: Film, color: 'text-purple-400', count: stats?.categories?.videos?.count || 0 },
    { id: 'audio', label: 'Music & Audio', icon: Music, color: 'text-emerald-400', count: stats?.categories?.audio?.count || 0 },
    { id: 'documents', label: 'Documents', icon: FileText, color: 'text-blue-400', count: stats?.categories?.documents?.count || 0 },
    { id: 'archives', label: 'Archives', icon: Archive, color: 'text-amber-400', count: stats?.categories?.archives?.count || 0 },
  ];

  // Handle Logo Click -> Go to Home / All Files (SPA state navigation without page reload)
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

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex flex-col justify-between shrink-0 h-screen select-none transition-transform duration-300 ease-in-out ${
          isMobileOpen ? 'translate-x-0 shadow-2xl shadow-cyan-500/10' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Fixed Top Brand Header & Action (Never scrolls) */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] shrink-0 space-y-3">
          {/* Brand Logo Header */}
          <div className="flex items-center justify-between">
            <div
              onClick={handleLogoClick}
              className="flex items-center gap-3 px-2 py-1.5 rounded-2xl hover:bg-slate-800/50 cursor-pointer transition-all group flex-1"
              title="Go to All Files"
            >
              <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 p-0.5 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0 group-hover:scale-105 transition-transform">
                <img
                  src="/logo.png"
                  alt="HT Claude Logo"
                  className="w-full h-full rounded-xl object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-black text-base text-white tracking-wide truncate group-hover:text-cyan-300 transition-colors" style={{ fontFamily: 'Poppins, sans-serif' }}>
                    HT CLAUDE
                  </h1>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shrink-0">
                    PRO
                  </span>
                </div>
                <p className="text-[10px] text-cyan-400/90 font-semibold tracking-wider uppercase truncate">
                  Upload &bull; Store &bull; Share
                </p>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white lg:hidden cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Primary Upload Button */}
          <button
            onClick={() => {
              if (onUploadClick) onUploadClick();
              if (onCloseMobile) onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-sky-500/20 hover:shadow-sky-500/35 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Files</span>
          </button>
        </div>

        {/* Scrollable Navigation & Folders */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Main Navigation */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
              Storage
            </div>
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id && !selectedCategory && (item.id !== 'all' || !currentFolderId);
              return (
                <button
                  key={item.id}
                  onClick={() => handleMainNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.count !== undefined && item.count > 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Developer API Nav Item */}
            <button
              onClick={onOpenDeveloperSection}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                currentView === 'developer'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Code2 className={`w-4 h-4 ${currentView === 'developer' ? 'text-cyan-400' : 'text-emerald-400'}`} />
                <span>Developer API</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                API
              </span>
            </button>
          </div>

          {/* Categories */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
              Categories
            </div>
            {categoryItems.map((cat) => {
              const Icon = cat.icon;
              const isActive = currentView === 'category' && selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-slate-800/90 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${cat.color}`} />
                    <span>{cat.label}</span>
                  </div>
                  {cat.count > 0 && (
                    <span className="text-xs text-slate-400 font-mono">
                      {cat.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Folders Navigation */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Folders
              </span>
              <button
                onClick={onNewFolderClick}
                className="p-1 rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
                title="Create new folder"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-0.5">
              {(() => {
                const activeFolders = (folders || []).filter((f) => !f.is_trash);
                if (activeFolders.length === 0) {
                  return <div className="px-3 py-2 text-xs text-slate-500 italic">No custom folders yet</div>;
                }
                return activeFolders.map((folder) => {
                  const isSelected = currentFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => handleFolderClick(folder.id)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-semibold shadow-sm shadow-cyan-500/10'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                        <Folder
                          className="w-4 h-4 shrink-0"
                          style={{ color: folder.color || '#38bdf8' }}
                        />
                        <span className="truncate text-xs">{folder.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800/90 text-slate-400 font-mono font-semibold border border-slate-700/60">
                          {folder.file_count || 0}
                        </span>
                        <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isSelected ? 'rotate-90 text-cyan-400' : ''}`} />
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* Bottom Profile & Storage Card */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 space-y-3">
          {/* Storage Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Storage Used</span>
              <span className="text-cyan-400 font-bold font-mono">
                {formatBytes(stats?.totalSize || 0)}
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-800/90 overflow-hidden flex">
              <div
                style={{
                  width: `${Math.min(
                    100,
                    stats?.totalSize ? Math.max(5, (stats?.categories?.images?.size || 0) / stats.totalSize * 100) : 0
                  )}%`,
                }}
                className="h-full bg-pink-500"
                title="Images"
              />
              <div
                style={{
                  width: `${Math.min(
                    100,
                    stats?.totalSize ? Math.max(0, (stats?.categories?.videos?.size || 0) / stats.totalSize * 100) : 0
                  )}%`,
                }}
                className="h-full bg-purple-500"
                title="Videos"
              />
              <div
                style={{
                  width: `${Math.min(
                    100,
                    stats?.totalSize ? Math.max(0, (stats?.categories?.audio?.size || 0) / stats.totalSize * 100) : 0
                  )}%`,
                }}
                className="h-full bg-emerald-500"
                title="Audio"
              />
              <div
                style={{
                  width: `${Math.min(
                    100,
                    stats?.totalSize ? Math.max(0, (stats?.categories?.documents?.size || 0) / stats.totalSize * 100) : 0
                  )}%`,
                }}
                className="h-full bg-blue-500"
                title="Documents"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>{stats?.totalFiles || 0} items</span>
              <span className="text-cyan-400/80 font-medium">Cloud Storage</span>
            </div>
          </div>

          {/* User Card - Click opens Admin Control Panel */}
          {currentUser && (
            <div
              onClick={onOpenAdminPanel}
              className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 flex items-center justify-between cursor-pointer group transition-all"
              title="Open Admin Control Panel & Profile"
            >
              <div className="flex items-center gap-2.5 truncate">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-700 flex items-center justify-center text-white shrink-0 text-xs font-bold">
                  {(currentUser.displayName || currentUser.email || 'A')[0].toUpperCase()}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                    {currentUser.displayName || currentUser.email?.split('@')[0]}
                  </p>
                  <p className="text-[10px] text-emerald-400 font-medium truncate">
                    Admin Profile & Settings
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
