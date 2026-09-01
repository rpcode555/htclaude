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
  Menu,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

  return (
    <header className="h-[60px] bg-white border-b border-gray-200 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-3 select-none shrink-0">

      {/* ── Left: Hamburger + Search ── */}
      <div className="flex items-center gap-3 flex-1 min-w-0 max-w-lg">
        {/* Mobile hamburger */}
        <button
          onClick={onToggleMobileSidebar}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 lg:hidden transition-colors cursor-pointer shrink-0"
          title="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="flex-1 relative min-w-0">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search files and folders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:bg-white transition-all outline-none"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Right: Controls ── */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Sort */}
        <div className="hidden md:flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-transparent text-gray-600 font-medium outline-none cursor-pointer pr-1 border-none focus:ring-0 focus:border-transparent"
            style={{ boxShadow: 'none' }}
          >
            <option value="created_at">Date Added</option>
            <option value="name">File Name</option>
            <option value="size">File Size</option>
            <option value="category">File Type</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            className="p-1 text-gray-400 hover:text-indigo-600 rounded transition-colors cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* View Toggle */}
        <div className="hidden sm:flex items-center bg-gray-100 border border-gray-200 rounded-lg p-1 gap-0.5">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid View"
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white text-indigo-600 shadow-sm border border-gray-200'
                : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="List View"
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white text-indigo-600 shadow-sm border border-gray-200'
                : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        {/* New Folder */}
        <button
          onClick={onNewFolderClick}
          title="Create New Folder"
          className="btn-secondary flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs cursor-pointer"
        >
          <FolderPlus className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="hidden sm:inline">New Folder</span>
        </button>

        {/* Upload */}
        <button
          onClick={onUploadClick}
          className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm cursor-pointer"
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>Upload</span>
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-all cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* User Avatar → Admin Panel */}
        {currentUser ? (
          <button
            onClick={onOpenAdminPanel}
            title={`Admin Panel (${currentUser.email})`}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:ring-2 hover:ring-indigo-400/60 hover:ring-offset-1 transition-all shadow-sm shrink-0"
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200 hover:bg-indigo-100 transition-all cursor-pointer"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
