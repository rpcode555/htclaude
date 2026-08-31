const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR } = require('./config/paths');
const DB_FILE = path.join(DATA_DIR, 'telecloud_db.json');
const BUNDLED_DB_FILE = path.join(__dirname, 'data/telecloud_db.json');

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {}

const defaultData = {
  settings: {
    auth_type: 'demo', // 'demo' | 'saved_messages' | 'bot'
    api_id: '',
    api_hash: '',
    session_string: '',
    phone_number: '',
    phone_code_hash: '',
    bot_token: '',
    chat_id: 'me',
    auto_backup: '0',
    storage_quota_gb: '10000', // Unlimited virtual
  },
  folders: [
    {
      id: 'root_documents',
      name: 'Documents',
      parent_id: null,
      color: '#3b82f6',
      icon: 'file-text',
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'root_media',
      name: 'Media & Videos',
      parent_id: null,
      color: '#8b5cf6',
      icon: 'video',
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'root_photos',
      name: 'Photos & Images',
      parent_id: null,
      color: '#ec4899',
      icon: 'image',
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  files: [],
  api_keys: [],
};

class Database {
  constructor() {
    this.data = this.loadData();
    if (!this.data.api_keys) {
      this.data.api_keys = [];
      this.saveData();
    }
  }

  loadData() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return { ...defaultData, ...JSON.parse(raw) };
      }
      if (BUNDLED_DB_FILE !== DB_FILE && fs.existsSync(BUNDLED_DB_FILE)) {
        const raw = fs.readFileSync(BUNDLED_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.saveData({ ...defaultData, ...parsed }, true);
        return { ...defaultData, ...parsed };
      }
    } catch (err) {
      console.error('[DB] Error loading JSON DB, resetting to defaults:', err.message);
    }
    this.saveData(defaultData, true);
    return defaultData;
  }

  saveData(data = this.data, immediate = false) {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const performSave = () => {
      try {
        const jsonContent = JSON.stringify(data, null, 2);
        const tempPath = `${DB_FILE}.tmp`;
        fs.writeFile(tempPath, jsonContent, 'utf-8', (err) => {
          if (err) {
            console.error('[DB] Error saving JSON DB:', err.message);
            return;
          }
          fs.rename(tempPath, DB_FILE, (renameErr) => {
            if (renameErr) {
              console.error('[DB] Error atomic rename DB:', renameErr.message);
            }
          });
        });
      } catch (err) {
        console.error('[DB] Error saving JSON DB:', err.message);
      }
    };

    if (immediate) {
      performSave();
    } else {
      this.saveTimer = setTimeout(performSave, 80);
    }
  }

  // --- Settings ---
  async getSetting(key) {
    return this.data.settings[key] || null;
  }

  async setSetting(key, value) {
    this.data.settings[key] = value;
    this.saveData();
    return value;
  }

  async getAllSettings() {
    return { ...this.data.settings };
  }

  // --- Folders ---
  async getFolders(includeTrash = true) {
    const list = includeTrash
      ? (this.data.folders || [])
      : (this.data.folders || []).filter((f) => !f.is_trash);

    return list.map((folder) => {
      const folderFiles = (this.data.files || []).filter(
        (f) => !f.is_trash && f.folder_id === folder.id
      );
      return {
        ...folder,
        file_count: folderFiles.length,
        total_size: folderFiles.reduce((acc, f) => acc + (f.size || 0), 0),
      };
    });
  }

  async getFolderById(id) {
    return this.data.folders.find((f) => f.id === id) || null;
  }

  async createFolder(nameOrObj, parent_id = null, color = '#3b82f6', icon = 'folder') {
    let name = nameOrObj;
    let pid = parent_id;
    let clr = color;
    let icn = icon;

    if (typeof nameOrObj === 'object' && nameOrObj !== null) {
      name = nameOrObj.name;
      pid = nameOrObj.parent_id || null;
      clr = nameOrObj.color || '#3b82f6';
      icn = nameOrObj.icon || 'folder';
    }

    const newFolder = {
      id: 'folder_' + crypto.randomUUID(),
      name: (name || 'New Folder').trim(),
      parent_id: pid || null,
      color: clr || '#3b82f6',
      icon: icn || 'folder',
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.folders.push(newFolder);
    this.saveData();
    return newFolder;
  }

  async updateFolder(id, updates) {
    const folder = this.data.folders.find((f) => f.id === id);
    if (!folder) return null;
    Object.assign(folder, updates, { updated_at: new Date().toISOString() });
    this.saveData();
    return folder;
  }

  async deleteFolder(id, permanent = false) {
    if (permanent) {
      this.data.folders = this.data.folders.filter((f) => f.id !== id);
    } else {
      const folder = this.data.folders.find((f) => f.id === id);
      if (folder) {
        folder.is_trash = 1;
        folder.updated_at = new Date().toISOString();
      }
      // Also move all files in this folder to Recycle Bin
      for (const file of this.data.files) {
        if (file.folder_id === id) {
          file.is_trash = 1;
          file.updated_at = new Date().toISOString();
        }
      }
    }
    this.saveData();
    return true;
  }

  async restoreFolder(id) {
    const folder = this.data.folders.find((f) => f.id === id);
    if (folder) {
      folder.is_trash = 0;
      folder.updated_at = new Date().toISOString();
    }
    // Also restore all files in this folder
    for (const file of this.data.files) {
      if (file.folder_id === id) {
        file.is_trash = 0;
        file.updated_at = new Date().toISOString();
      }
    }
    this.saveData();
    return folder;
  }

  // --- Files ---
  async getFiles({ folder_id, category, filter = 'all', search = '', sortBy = 'created_at', sortOrder = 'desc' } = {}) {
    let result = [...this.data.files];

    // Trash filter
    if (filter === 'trash') {
      result = result.filter((f) => f.is_trash === 1);
    } else {
      result = result.filter((f) => !f.is_trash);
    }

    // Starred filter
    if (filter === 'starred') {
      result = result.filter((f) => f.is_starred === 1);
    }

    // Recent filter (last 7 days)
    if (filter === 'recent') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      result = result.filter((f) => f.created_at >= sevenDaysAgo);
    }

    // Folder filter
    if (folder_id !== undefined && filter !== 'trash' && filter !== 'starred' && filter !== 'recent') {
      if (folder_id === null || folder_id === 'root') {
        result = result.filter((f) => !f.folder_id);
      } else {
        result = result.filter((f) => f.folder_id === folder_id);
      }
    }

    // Category filter
    if (category) {
      result = result.filter((f) => f.category === category);
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(q) || (f.tags && f.tags.some((t) => t.toLowerCase().includes(q))));
    }

    // Sorting
    result.sort((a, b) => {
      let valA = a[sortBy] ?? '';
      let valB = b[sortBy] ?? '';

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
      }

      if (sortOrder === 'asc') {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      } else {
        return valA < valB ? 1 : valA > valB ? -1 : 0;
      }
    });

    return result;
  }

  async getFileById(id) {
    return this.data.files.find((f) => f.id === id) || null;
  }

  async getFileByTelegramMsgId(msgId) {
    return this.data.files.find((f) => f.telegram_msg_id === msgId) || null;
  }

  async insertFile(file) {
    const newFile = {
      id: file.id || 'file_' + crypto.randomUUID(),
      folder_id: file.folder_id || null,
      name: file.name,
      original_name: file.original_name || file.name,
      mime_type: file.mime_type || 'application/octet-stream',
      size: file.size || 0,
      category: file.category || detectCategory(file.mime_type, file.name),
      telegram_msg_id: file.telegram_msg_id || null,
      telegram_chat_id: file.telegram_chat_id || null,
      file_hash: file.file_hash || null,
      storage_type: file.storage_type || 'telegram', // 'telegram' | 'local'
      local_path: file.local_path || null,
      thumbnail_path: file.thumbnail_path || null,
      api_key_id: file.api_key_id || null,
      tags: file.tags || [],
      is_starred: file.is_starred || 0,
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.files.push(newFile);
    this.saveData();
    return newFile;
  }

  async updateFile(id, updates) {
    const file = this.data.files.find((f) => f.id === id);
    if (!file) return null;
    Object.assign(file, updates, { updated_at: new Date().toISOString() });
    this.saveData();
    return file;
  }

  async deleteFile(id, trashOnly = true) {
    if (trashOnly) {
      const file = this.data.files.find((f) => f.id === id);
      if (file) {
        file.is_trash = 1;
        file.updated_at = new Date().toISOString();
      }
    } else {
      this.data.files = this.data.files.filter((f) => f.id !== id);
    }
    this.saveData();
    return true;
  }

  async restoreFile(id) {
    const file = this.data.files.find((f) => f.id === id);
    if (file) {
      file.is_trash = 0;
      file.updated_at = new Date().toISOString();
    }
    this.saveData();
    return file;
  }

  async emptyTrash() {
    const trashedFiles = this.data.files.filter((f) => f.is_trash === 1);
    this.data.files = this.data.files.filter((f) => !f.is_trash);
    this.data.folders = this.data.folders.filter((f) => !f.is_trash);
    this.saveData();
    return { count: trashedFiles.length, trashedFiles };
  }

  // --- API Keys Management ---
  async getApiKeys() {
    this.data = this.loadData();
    return this.data.api_keys || [];
  }

  async getApiKeyById(id) {
    let found = (this.data.api_keys || []).find((k) => k.id === id);
    if (!found) {
      this.data = this.loadData();
      found = (this.data.api_keys || []).find((k) => k.id === id);
    }
    return found || null;
  }

  async getApiKeyByKey(key) {
    let found = (this.data.api_keys || []).find((k) => k.key === key);
    if (!found) {
      this.data = this.loadData();
      found = (this.data.api_keys || []).find((k) => k.key === key);
    }
    return found || null;
  }

  async createApiKey({ name = 'My Website API Key', purpose = 'web', validity = 'never' } = {}) {
    if (!this.data.api_keys) this.data.api_keys = [];
    const rawRandom = crypto.randomBytes(24).toString('hex');

    let expires_at = null;
    if (validity === '30d') {
      expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (validity === '90d') {
      expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    } else if (validity === '180d') {
      expires_at = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    } else if (validity === '365d') {
      expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const keyName = (name || 'My Website API Key').trim();

    // Automatically find or create a dedicated folder with the same name as the API
    let targetFolder = (this.data.folders || []).find(
      (f) => !f.is_trash && f.name.toLowerCase() === keyName.toLowerCase()
    );
    if (!targetFolder) {
      targetFolder = await this.createFolder({
        name: keyName,
        color: '#0ea5e9',
        icon: 'folder',
      });
    }

    const newApiKey = {
      id: 'key_' + crypto.randomUUID(),
      name: keyName,
      purpose: purpose || 'web',
      validity: validity || 'never',
      expires_at,
      folder_id: targetFolder ? targetFolder.id : null,
      key: `htc_live_${rawRandom}`,
      status: 'active', // 'active' | 'revoked'
      total_uploads: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.api_keys.push(newApiKey);
    this.saveData();
    return newApiKey;
  }

  async getOrCreateApiKeyFolder(apiKey) {
    if (!apiKey) return null;
    const keyName = (apiKey.name || 'API Uploads').trim();

    // 1. Check if linked folder_id exists and is active
    if (apiKey.folder_id) {
      const existing = (this.data.folders || []).find((f) => f.id === apiKey.folder_id && !f.is_trash);
      if (existing) return existing;
    }

    // 2. Check if a folder with the same name exists
    const nameMatch = (this.data.folders || []).find(
      (f) => !f.is_trash && f.name.toLowerCase() === keyName.toLowerCase()
    );
    if (nameMatch) {
      apiKey.folder_id = nameMatch.id;
      this.saveData();
      return nameMatch;
    }

    // 3. Automatically create a new folder with the exact same name as the API
    const newFolder = await this.createFolder({
      name: keyName,
      color: '#0ea5e9',
      icon: 'folder',
    });
    apiKey.folder_id = newFolder.id;
    this.saveData();
    return newFolder;
  }

  async getFilesByApiKeyId(apiKeyId) {
    this.data = this.loadData();
    return (this.data.files || []).filter(
      (f) => !f.is_trash && (f.api_key_id === apiKeyId || (f.tags && f.tags.includes(apiKeyId)))
    );
  }

  async updateApiKey(id, updates) {
    const apiKey = (this.data.api_keys || []).find((k) => k.id === id);
    if (!apiKey) return null;
    Object.assign(apiKey, updates, { updated_at: new Date().toISOString() });
    this.saveData();
    return apiKey;
  }

  async deleteApiKey(id) {
    this.data.api_keys = (this.data.api_keys || []).filter((k) => k.id !== id);
    this.saveData();
    return true;
  }

  async incrementApiKeyUsage(id) {
    const apiKey = (this.data.api_keys || []).find((k) => k.id === id);
    if (apiKey) {
      apiKey.total_uploads = (apiKey.total_uploads || 0) + 1;
      apiKey.last_used_at = new Date().toISOString();
      this.saveData();
    }
  }

  // --- Stats ---
  async getStats() {
    const activeFiles = this.data.files.filter((f) => !f.is_trash);
    const trashFiles = this.data.files.filter((f) => f.is_trash === 1);
    const starredFiles = this.data.files.filter((f) => !f.is_trash && f.is_starred === 1);

    const totalSize = activeFiles.reduce((acc, f) => acc + (f.size || 0), 0);

    const categories = {
      images: { count: 0, size: 0 },
      videos: { count: 0, size: 0 },
      audio: { count: 0, size: 0 },
      documents: { count: 0, size: 0 },
      archives: { count: 0, size: 0 },
      others: { count: 0, size: 0 },
    };

    for (const file of activeFiles) {
      const cat = file.category || 'others';
      if (categories[cat]) {
        categories[cat].count++;
        categories[cat].size += file.size || 0;
      }
    }

    const trashFolders = (this.data.folders || []).filter((f) => f.is_trash === 1);

    return {
      totalFiles: activeFiles.length,
      totalFolders: this.data.folders.filter((f) => !f.is_trash).length,
      totalSize,
      trashCount: trashFiles.length + trashFolders.length,
      starredCount: starredFiles.length,
      categories,
      totalApiKeys: (this.data.api_keys || []).length,
    };
  }
}

function detectCategory(mimeType = '', fileName = '') {
  const ext = path.extname(fileName).toLowerCase();
  const mime = mimeType.toLowerCase();

  if (
    mime.startsWith('image/') ||
    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic', '.avif'].includes(ext)
  ) {
    return 'images';
  }
  if (
    mime.startsWith('video/') ||
    ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.3gp', '.m4v'].includes(ext)
  ) {
    return 'videos';
  }
  if (
    mime.startsWith('audio/') ||
    ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('sheet') ||
    mime.includes('presentation') ||
    mime.includes('text/') ||
    [
      '.pdf',
      '.doc',
      '.docx',
      '.txt',
      '.md',
      '.csv',
      '.xlsx',
      '.xls',
      '.pptx',
      '.ppt',
      '.json',
      '.js',
      '.ts',
      '.py',
      '.html',
      '.css',
    ].includes(ext)
  ) {
    return 'documents';
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('tar') ||
    mime.includes('7z') ||
    mime.includes('compressed') ||
    ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso'].includes(ext)
  ) {
    return 'archives';
  }
  return 'others';
}

const db = new Database();

module.exports = {
  db,
  detectCategory,
  getSetting: (k) => db.getSetting(k),
  setSetting: (k, v) => db.setSetting(k, v),
  getAllSettings: () => db.getAllSettings(),
};
