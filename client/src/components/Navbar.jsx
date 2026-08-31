import React from 'react';
import {
  Search,
  Upload,
  FolderPlus,
  LayoutGrid,
  List,
  ArrowUpDown,
  Settings,
  X,
  Lock,
  Sun,
  Moon,
  Menu,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function Navbar({
  searchTerm,
  setSearchTerm,
  viewMode,
  setViewMode,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  onUploadClick,
  onNewFolderClick,
  onOpenSettings,
  onOpenAdminPanel,
  onOpenAuthModal,
  onToggleMobileSidebar,
}) {
  const { currentUser } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <header className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-header)] backdrop-blur-xl sticky top-0 z-30 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 select-none transition-colors">
      {/* Left: Mobile Hamburger & Search Input Bar */}
      <div className="flex items-center gap-2 flex-1 max-w-xl">
        {/* Mobile Hamburger Drawer Button */}
        <button
          onClick={onToggleMobileSidebar}
          className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white lg:hidden transition-colors cursor-pointer shrink-0"
          title="Open Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search Input Bar */}
        <div className="flex-1 relative">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search files, folders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900/90 border border-slate-700/60 focus:border-cyan-500/80 focus:ring-2 focus:ring-cyan-500/20 text-xs sm:text-sm text-slate-200 placeholder-slate-500 transition-all outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right Controls & Action Buttons */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Sort & Order (Hidden on extra small screens or compact) */}
        <div className="hidden md:flex items-center bg-slate-900/80 border border-slate-800 rounded-xl p-1 text-xs">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-transparent text-slate-300 font-medium px-2 py-1 outline-none cursor-pointer"
          >
            <option value="created_at" className="bg-slate-900 text-slate-200">Date Added</option>
            <option value="name" className="bg-slate-900 text-slate-200">File Name</option>
            <option value="size" className="bg-slate-900 text-slate-200">File Size</option>
            <option value="category" className="bg-slate-900 text-slate-200">File Type</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="p-1 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-slate-800 transition-colors"
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="hidden sm:flex items-center bg-slate-900/80 border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid'
                ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Grid View"
          >
            <LayoutGrid className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'list'
                ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="List View"
          >
            <List className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* New Folder Button */}
        <button
          onClick={onNewFolderClick}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 text-slate-200 hover:text-white text-xs font-semibold transition-all cursor-pointer"
          title="Create New Folder"
        >
          <FolderPlus className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="hidden sm:inline">New Folder</span>
        </button>

        {/* Upload Button */}
        <button
          onClick={onUploadClick}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/35 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>Upload</span>
        </button>

        {/* Light / Dark Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-400 transition-all cursor-pointer"
          title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
        </button>

        {/* Firebase User Profile / Admin Avatar */}
        {currentUser ? (
          <div className="flex items-center pl-0.5 sm:pl-1">
            <button
              onClick={onOpenAdminPanel}
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold border border-cyan-400/40 shadow-sm cursor-pointer hover:ring-2 hover:ring-cyan-400/50 transition-all"
              title={`Admin Control Center (${currentUser.email})`}
            >
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()
              )}
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuthModal}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-400 text-xs font-semibold transition-all cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}

        {/* Settings Gear Button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
          title="Storage & Telegram Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
