import React, { useEffect, useRef } from 'react';
import {
  Search,
  Upload,
  FolderPlus,
  LayoutGrid,
  List,
  ArrowUpDown,
  Settings,
  X,
  Menu,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  CloudCheck,
  CheckCircle2,
  Sliders,
  Shield,
  ChevronDown,
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
  isSidebarCollapsed,
  onToggleSidebarCollapse,
  currentViewTitle = 'All Files',
}) {
  const { currentUser } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const searchInputRef = useRef(null);

  // Global Ctrl+K / Cmd+K listener to focus search bar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="h-[60px] bg-white dark:bg-[#0d131f] border-b border-gray-200 dark:border-gray-800/80 sticky top-0 z-30 px-3 sm:px-5 flex items-center justify-between gap-3 select-none shrink-0 transition-colors duration-250">

      {/* ── Left: Sidebar Collapse Toggle + Search ── */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0 max-w-xl">
        {/* Mobile Hamburger Toggle */}
        <button
          onClick={onToggleMobileSidebar}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden transition-colors cursor-pointer shrink-0"
          title="Toggle Navigation Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop Sidebar Hide/Unhide Toggle Button */}
        <button
          onClick={onToggleSidebarCollapse}
          className="hidden lg:flex p-2 rounded-lg text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
          title={isSidebarCollapsed ? 'Show / Expand Left Menu' : 'Hide / Collapse Left Menu'}
        >
          {isSidebarCollapsed ? (
            <PanelLeftOpen className="w-5 h-5 text-rose-500" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </button>

        {/* Quick Nav Search Input */}
        <div className="flex-1 relative min-w-0">
          <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Quick search files & folders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 bg-gray-50 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-800 rounded-xl text-xs sm:text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:bg-white dark:focus:bg-gray-950 focus:border-rose-500 dark:focus:border-rose-500 focus:outline-none focus:ring-0 transition-colors"
            style={{ outline: 'none', boxShadow: 'none' }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Right: Controls, Theme Toggle & Actions ── */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

        {/* Sleek Sort Controls */}
        <div className="hidden md:flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-2.5 py-1.5 text-xs gap-1.5 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
          <div className="relative flex items-center">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-gray-700 dark:text-gray-200 font-semibold outline-none cursor-pointer pr-4 border-0 p-0 text-xs appearance-none focus:ring-0"
              style={{ border: 'none', background: 'transparent', outline: 'none', boxShadow: 'none' }}
            >
              <option value="created_at" className="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">Date Added</option>
              <option value="name" className="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">File Name</option>
              <option value="size" className="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">File Size</option>
              <option value="category" className="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">File Type</option>
            </select>
            <ChevronDown className="w-3 h-3 text-gray-400 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2" />
          </div>

          <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            className="p-0.5 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* View Mode Grid/List Toggle */}
        <div className="hidden sm:flex items-center bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1 gap-0.5">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid View"
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-gray-800 text-rose-600 dark:text-rose-400 shadow-sm border border-gray-200 dark:border-gray-700'
                : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="List View"
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white dark:bg-gray-800 text-rose-600 dark:text-rose-400 shadow-sm border border-gray-200 dark:border-gray-700'
                : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Dark / Light Mode Toggle Button (Moon / Sun) */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all cursor-pointer shrink-0"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-amber-400 animate-fade-in" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600 animate-fade-in" />
          )}
        </button>

        {/* New Folder Button */}
        <button
          onClick={onNewFolderClick}
          title="Create New Folder"
          className="btn-secondary hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs cursor-pointer dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <FolderPlus className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          <span>New Folder</span>
        </button>

        {/* Upload Button — Red / Rose Primary */}
        <button
          onClick={onUploadClick}
          className="btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold cursor-pointer"
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>Upload</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* User Avatar → Admin Panel */}
        {currentUser ? (
          <button
            onClick={onOpenAdminPanel}
            title={`Admin Panel (${currentUser.email})`}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:ring-2 hover:ring-rose-400/60 hover:ring-offset-2 dark:hover:ring-offset-gray-900 transition-all shadow-sm shrink-0"
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
        ) : (
          <button
            onClick={onOpenAuthModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-xs font-semibold border border-rose-200 dark:border-rose-800/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-all cursor-pointer"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
