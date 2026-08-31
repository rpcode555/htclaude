import React, { useState, useEffect, useRef } from 'react';
import { api } from './api';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import FileExplorer from './components/FileExplorer';
import FilePreviewModal from './components/FilePreviewModal';
import SettingsModal from './components/SettingsModal';
import UploadModal from './components/UploadModal';
import FolderModal from './components/FolderModal';
import MoveModal from './components/MoveModal';
import RenameModal from './components/RenameModal';
import AdminPanel from './components/AdminPanel';
import DeveloperSection from './components/DeveloperSection';
import AuthGate from './components/AuthGate';
import { useConfirm } from './context/ConfirmContext';

function MainApp() {
  const { isAuthorized, loading: authLoading } = useAuth();
  const confirm = useConfirm();

  // Navigation & Filter States
  const [currentView, setCurrentView] = useState('all'); // 'all' | 'recent' | 'starred' | 'trash' | 'category' | 'admin' | 'developer'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Data States
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [stats, setStats] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Modal States
  const [previewFile, setPreviewFile] = useState(null);
  const [renameFile, setRenameFile] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);

  // Upload States
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  // Debounced search term for high-speed responsiveness
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load initial app data (only when authorized)
  const loadData = async () => {
    if (!isAuthorized) return;
    try {
      const [statusRes, foldersRes, statsRes] = await Promise.all([
        api.getStatus(),
        api.getFolders(),
        api.getStats(),
      ]);

      if (statusRes.success) setAuthStatus(statusRes);
      if (foldersRes.success) setFolders(foldersRes.folders);
      if (statsRes.success) setStats(statsRes.stats);
    } catch (err) {
      console.error('[App] Load error:', err);
    }
  };

  // Load files matching current view filters
  const loadFiles = async () => {
    if (!isAuthorized || currentView === 'admin' || currentView === 'developer') return;
    setLoadingFiles(true);
    try {
      const filter =
        currentView === 'trash'
          ? 'trash'
          : currentView === 'starred'
          ? 'starred'
          : currentView === 'recent'
          ? 'recent'
          : 'all';
      const folder_id = currentView === 'all' && !selectedCategory ? currentFolderId : undefined;
      const category = selectedCategory || undefined;

      const res = await api.getFiles({
        folder_id,
        category,
        filter,
        search: debouncedSearch,
        sortBy,
        sortOrder,
      });

      if (res.success) {
        setFiles(res.files);
      }
    } catch (err) {
      console.error('[App] Load files error:', err);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (isAuthorized) {
      loadData();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (isAuthorized) {
      loadFiles();
    }
  }, [isAuthorized, currentView, selectedCategory, currentFolderId, debouncedSearch, sortBy, sortOrder]);

  // Real-time background sync interval (checks every 5s for live updates across devices/tabs)
  useEffect(() => {
    if (!isAuthorized) return;
    const interval = setInterval(() => {
      loadFiles();
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthorized, currentView, selectedCategory, currentFolderId]);

  // Upload Handler
  const handleUploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;

    const items = Array.from(fileList).map((f) => ({
      name: f.name,
      size: f.size,
      status: 'uploading',
    }));

    setUploadQueue(items);
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const uploadRes = await api.uploadFilesWithProgress(
        fileList,
        currentFolderId,
        (progress) => {
          setUploadProgress(progress.percent);
        }
      );

      setUploadProgress(100);
      setUploadQueue((prev) => prev.map((item) => ({ ...item, status: 'done' })));

      // Real-time instantaneous optimistic UI insertion (0ms delay)
      if (uploadRes && uploadRes.files && Array.isArray(uploadRes.files) && uploadRes.files.length > 0) {
        setFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id));
          const newItems = uploadRes.files.filter((f) => !existingIds.has(f.id));
          return [...newItems, ...prev];
        });
      }

      await Promise.all([loadFiles(), loadData()]);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadQueue((prev) => prev.map((item) => ({ ...item, status: 'error' })));
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Drag & Drop Listeners
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Folder Actions
  const handleCreateFolder = async (name, color) => {
    try {
      const res = await api.createFolder(name, currentFolderId, color);
      if (res.success) {
        await loadData();
      }
    } catch (err) {
      alert(`Could not create folder: ${err.message}`);
    }
  };

  const handleDeleteFolder = async (folderId) => {
    const ok = await confirm({
      title: 'Move Folder to Recycle Bin',
      message: 'Are you sure you want to move this folder and all items inside it to the Recycle Bin?',
      confirmText: 'Move to Recycle Bin',
      variant: 'danger',
    });
    if (ok) {
      setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, is_trash: 1 } : f)));
      if (currentFolderId === folderId) {
        setCurrentFolderId(null);
      }
      try {
        await api.deleteFolder(folderId, false);
        await Promise.all([loadData(), loadFiles()]);
      } catch (err) {
        await Promise.all([loadData(), loadFiles()]);
        alert(err.message);
      }
    }
  };

  const handleRestoreFolder = async (folderId) => {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, is_trash: 0 } : f)));
    try {
      await api.restoreFolder(folderId);
      await Promise.all([loadData(), loadFiles()]);
    } catch (err) {
      await Promise.all([loadData(), loadFiles()]);
      alert(err.message);
    }
  };

  const handleDeleteFolderPermanent = async (folderId) => {
    const ok = await confirm({
      title: 'Delete Folder Permanently',
      message: 'Are you sure you want to permanently delete this folder and all its contents? This cannot be undone.',
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (ok) {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (currentFolderId === folderId) {
        setCurrentFolderId(null);
      }
      try {
        await api.deleteFolder(folderId, true);
        await Promise.all([loadData(), loadFiles()]);
      } catch (err) {
        await Promise.all([loadData(), loadFiles()]);
        alert(err.message);
      }
    }
  };

  // File Actions
  const handleDownloadFile = async (file) => {
    try {
      const token = api.getDownloadUrl(file.id);
      const link = document.createElement('a');
      link.href = token;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert(`Download error: ${err.message}`);
    }
  };

  const handleToggleStar = async (fileId, isStarred) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, is_starred: isStarred ? 1 : 0 } : f)));
    try {
      await api.updateFile(fileId, { is_starred: isStarred });
      await loadData();
    } catch (err) {
      await loadFiles();
      console.error(err);
    }
  };

  const handleTrashFiles = async (fileIds) => {
    setFiles((prev) => prev.filter((f) => !fileIds.includes(f.id)));
    setSelectedFiles([]);
    try {
      await api.batchAction('trash', fileIds);
      await Promise.all([loadFiles(), loadData()]);
    } catch (err) {
      await loadFiles();
      alert(err.message);
    }
  };

  const handleRestoreFiles = async (fileIds) => {
    if (currentView === 'trash') {
      setFiles((prev) => prev.filter((f) => !fileIds.includes(f.id)));
    }
    setSelectedFiles([]);
    try {
      await api.batchAction('restore', fileIds);
      await Promise.all([loadFiles(), loadData()]);
    } catch (err) {
      await loadFiles();
      alert(err.message);
    }
  };

  const handleDeletePermanent = async (fileIds) => {
    const ok = await confirm({
      title: 'Delete Permanently',
      message: `Are you sure you want to delete ${fileIds.length} item(s) permanently? This action cannot be undone.`,
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (ok) {
      setFiles((prev) => prev.filter((f) => !fileIds.includes(f.id)));
      setSelectedFiles([]);
      try {
        await api.batchAction('delete', fileIds);
        await Promise.all([loadFiles(), loadData()]);
      } catch (err) {
        await loadFiles();
        alert(err.message);
      }
    }
  };

  const handleEmptyTrash = async () => {
    const ok = await confirm({
      title: 'Empty Recycle Bin',
      message: 'Are you sure you want to permanently erase all files in the Recycle Bin?',
      confirmText: 'Empty Recycle Bin',
      variant: 'danger',
    });
    if (ok) {
      if (currentView === 'trash') {
        setFiles([]);
      }
      setSelectedFiles([]);
      try {
        await api.emptyTrash();
        await Promise.all([loadFiles(), loadData()]);
      } catch (err) {
        await loadFiles();
        alert(err.message);
      }
    }
  };

  const handleRenameFile = async (fileId, newName) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, name: newName } : f)));
    try {
      await api.updateFile(fileId, { name: newName });
      await Promise.all([loadFiles(), loadData()]);
    } catch (err) {
      await loadFiles();
      alert(err.message);
    }
  };

  const handleMoveFiles = async (targetFolderId) => {
    const movedIds = [...selectedFiles];
    setSelectedFiles([]);
    try {
      await api.batchAction('move', movedIds, targetFolderId);
      await Promise.all([loadFiles(), loadData()]);
    } catch (err) {
      alert(err.message);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-[#060911] flex flex-col items-center justify-center space-y-4 select-none">
        <div className="w-14 h-14 rounded-3xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-2xl shadow-cyan-500/20">
          <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-xs text-slate-400 font-mono tracking-widest uppercase animate-pulse">
          Authenticating &bull; HT Claude
        </p>
      </div>
    );
  }

  if (!isAuthorized) {
    return <AuthGate />;
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] antialiased font-sans select-none relative"
    >
      {/* Hidden Multi-File Upload Input */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={(e) => handleUploadFiles(e.target.files)}
        className="hidden"
      />

      {/* Sidebar Navigation (Responsive Desktop & Mobile Drawer) */}
      <Sidebar
        currentView={currentView}
        setCurrentView={(view) => {
          setCurrentView(view);
          setIsMobileSidebarOpen(false);
        }}
        selectedCategory={selectedCategory}
        setSelectedCategory={(cat) => {
          setSelectedCategory(cat);
          setIsMobileSidebarOpen(false);
        }}
        currentFolderId={currentFolderId}
        setCurrentFolderId={(fid) => {
          setCurrentFolderId(fid);
          setIsMobileSidebarOpen(false);
        }}
        folders={folders}
        stats={stats}
        authStatus={authStatus}
        onUploadClick={() => fileInputRef.current?.click()}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
          setIsMobileSidebarOpen(false);
        }}
        onNewFolderClick={() => {
          setIsFolderModalOpen(true);
          setIsMobileSidebarOpen(false);
        }}
        onOpenAdminPanel={() => {
          setCurrentView('admin');
          setIsMobileSidebarOpen(false);
        }}
        onOpenDeveloperSection={() => {
          setCurrentView('developer');
          setIsMobileSidebarOpen(false);
        }}
        onRefreshData={loadData}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Navbar */}
        <Navbar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          viewMode={viewMode}
          setViewMode={setViewMode}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          onUploadClick={() => fileInputRef.current?.click()}
          onNewFolderClick={() => setIsFolderModalOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenAdminPanel={() => setCurrentView('admin')}
          isAdminActive={currentView === 'admin'}
          authStatus={authStatus}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
        />

        {/* View Switcher: Developer Section vs Admin Panel vs File Explorer */}
        {currentView === 'developer' ? (
          <DeveloperSection
            onRefreshStorage={loadData}
            onFileClick={(file) => setPreviewFile(file)}
          />
        ) : currentView === 'admin' ? (
          <AdminPanel
            stats={stats}
            authStatus={authStatus}
            onRefreshData={loadData}
            onEmptyTrash={handleEmptyTrash}
            onClose={() => setCurrentView('all')}
          />
        ) : (
          <FileExplorer
            files={files}
            folders={folders}
            loadingFiles={loadingFiles}
            currentFolderId={currentFolderId}
            setCurrentFolderId={setCurrentFolderId}
            currentView={currentView}
            selectedCategory={selectedCategory}
            viewMode={viewMode}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            onFileClick={(file) => setPreviewFile(file)}
            onDownloadFile={handleDownloadFile}
            onToggleStar={handleToggleStar}
            onTrashFile={handleTrashFiles}
            onRestoreFile={handleRestoreFiles}
            onDeletePermanent={handleDeletePermanent}
            onRenameFile={(file) => setRenameFile(file)}
            onMoveFiles={() => setIsMoveModalOpen(true)}
            onOpenFolderModal={() => setIsFolderModalOpen(true)}
            onDeleteFolder={handleDeleteFolder}
            onRestoreFolder={handleRestoreFolder}
            onDeleteFolderPermanent={handleDeleteFolderPermanent}
            onEmptyTrash={handleEmptyTrash}
            onUploadTrigger={() => fileInputRef.current?.click()}
            isDragOver={isDragOver}
          />
        )}
      </div>

      {/* Modals & Overlays */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownloadFile}
          onTrash={async (file) => {
            const ok = await confirm({
              title: 'Move to Recycle Bin',
              message: `Are you sure you want to move "${file.name}" to the Recycle Bin?`,
              confirmText: 'Move to Recycle Bin',
              variant: 'danger',
            });
            if (ok) {
              await handleTrashFiles([file.id]);
              setPreviewFile(null);
            }
          }}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          authStatus={authStatus}
          onClose={() => setIsSettingsOpen(false)}
          onRefreshStatus={loadData}
        />
      )}

      {isFolderModalOpen && (
        <FolderModal
          isOpen={isFolderModalOpen}
          onClose={() => setIsFolderModalOpen(false)}
          onCreateFolder={handleCreateFolder}
          parentFolderId={currentFolderId}
        />
      )}

      {isMoveModalOpen && (
        <MoveModal
          isOpen={isMoveModalOpen}
          onClose={() => setIsMoveModalOpen(false)}
          folders={folders}
          onMove={handleMoveFiles}
          selectedCount={selectedFiles.length}
        />
      )}

      {renameFile && (
        <RenameModal
          isOpen={!!renameFile}
          file={renameFile}
          onClose={() => setRenameFile(null)}
          onRename={handleRenameFile}
        />
      )}

      {/* Floating Upload Queue Notification */}
      <UploadModal
        uploadQueue={uploadQueue}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        onDismiss={() => setUploadQueue([])}
      />
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React Error Boundary Caught]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen bg-[#060911] text-slate-100 flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4 shadow-xl shadow-red-500/10">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Interface Render Warning</h2>
          <div className="w-full max-w-xl text-left bg-slate-900/90 border border-red-500/30 rounded-2xl p-4 my-3 font-mono text-xs text-red-300 overflow-x-auto space-y-2 shadow-2xl">
            <p className="font-bold text-red-400 text-sm">
              {this.state.error?.name || 'Error'}: {this.state.error?.message || String(this.state.error)}
            </p>
            {this.state.error?.stack && (
              <pre className="text-[11px] text-slate-400 opacity-80 whitespace-pre-wrap font-mono max-h-36 overflow-y-auto">
                {this.state.error.stack.split('\n').slice(0, 6).join('\n')}
              </pre>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all cursor-pointer"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-xs shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-blue-500 transition-all cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
