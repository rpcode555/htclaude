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

  // Navigation & Filter States
  const [currentView, setCurrentView] = useState('all'); // 'all' | 'recent' | 'starred' | 'trash' | 'category' | 'admin' | 'developer'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

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

  // If user is not authenticated/authorized as palranjan144@gmail.com, show strict full-screen AuthGate
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center text-cyan-400">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-xs font-semibold text-slate-400 font-mono">Verifying Authentication Gate...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <AuthGate />;
  }

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
      await api.uploadFilesWithProgress(
        fileList,
        currentFolderId,
        (progress) => {
          setUploadProgress(progress.percent);
        }
      );

      setUploadProgress(100);
      setUploadQueue((prev) => prev.map((item) => ({ ...item, status: 'done' })));
      await loadFiles();
      await loadData();
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

  const confirm = useConfirm();

  const handleDeleteFolder = async (folderId) => {
    const ok = await confirm({
      title: 'Move Folder to Recycle Bin',
      message: 'Are you sure you want to move this folder and all items inside it to the Recycle Bin?',
      confirmText: 'Move to Recycle Bin',
      variant: 'danger',
    });
    if (ok) {
      try {
        await api.deleteFolder(folderId, false);
        if (currentFolderId === folderId) {
          setCurrentFolderId(null);
        }
        await loadData();
        await loadFiles();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleRestoreFolder = async (folderId) => {
    try {
      await api.restoreFolder(folderId);
      await loadData();
      await loadFiles();
    } catch (err) {
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
      try {
        await api.deleteFolder(folderId, true);
        await loadData();
        await loadFiles();
      } catch (err) {
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
    try {
      await api.updateFile(fileId, { is_starred: isStarred });
      await loadFiles();
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTrashFiles = async (fileIds) => {
    try {
      await api.batchAction('trash', fileIds);
      setSelectedFiles([]);
      await loadFiles();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRestoreFiles = async (fileIds) => {
    try {
      await api.batchAction('restore', fileIds);
      setSelectedFiles([]);
      await loadFiles();
      await loadData();
    } catch (err) {
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
      try {
        await api.batchAction('delete', fileIds);
        setSelectedFiles([]);
        await loadFiles();
        await loadData();
      } catch (err) {
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
      try {
        await api.emptyTrash();
        await loadFiles();
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleRenameFile = async (fileId, newName) => {
    try {
      await api.updateFile(fileId, { name: newName });
      await loadFiles();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleMoveFiles = async (targetFolderId) => {
    try {
      await api.batchAction('move', selectedFiles, targetFolderId);
      setSelectedFiles([]);
      await loadFiles();
      await loadData();
} catch (err) {
      alert(err.message);
    }
  };

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
