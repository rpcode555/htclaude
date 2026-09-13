const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudDbService = require('./services/cloudDbService');
const firestoreService = require('./services/firestoreService');
const { updateEnvFile } = require('./config/envHelper');

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
    auth_type: process.env.TELEGRAM_AUTH_TYPE || 'saved_messages',
    api_id: process.env.TELEGRAM_API_ID || '',
    api_hash: process.env.TELEGRAM_API_HASH || '',
    session_string: process.env.TELEGRAM_SESSION_STRING || '',
    phone_number: '',
    phone_code_hash: '',
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
    this.lastCloudSync = 0;
    if (!this.data.api_keys) {
      this.data.api_keys = [];
      this.saveData();
    }
    // Background cloud sync on startup
    this.syncFromCloud().catch(() => {});
  }

  async syncFromCloud() {
    try {
      const cloudData = await cloudDbService.fetchAll();
      if (cloudData) {
        if (Array.isArray(cloudData.files)) {
          const localMap = new Map((this.data.files || []).map((f) => [f.id, f]));
          for (const cloudFile of cloudData.files) {
            const existing = localMap.get(cloudFile.id);
            if (
              !existing ||
              new Date(cloudFile.updated_at || cloudFile.created_at || 0) >=
                new Date(existing.updated_at || existing.created_at || 0)
            ) {
              localMap.set(cloudFile.id, { ...existing, ...cloudFile });
            }
          }
          this.data.files = Array.from(localMap.values());
        }
        if (Array.isArray(cloudData.folders) && cloudData.folders.length > 0) {
          const folderMap = new Map((this.data.folders || []).map((f) => [f.id, f]));
          for (const cloudFolder of cloudData.folders) {
            const existing = folderMap.get(cloudFolder.id);
            if (
              !existing ||
              new Date(cloudFolder.updated_at || cloudFolder.created_at || 0) >=
                new Date(existing.updated_at || existing.created_at || 0)
            ) {
              folderMap.set(cloudFolder.id, { ...existing, ...cloudFolder });
            }
          }
          this.data.folders = Array.from(folderMap.values());
        }
        if (cloudData.settings && Object.keys(cloudData.settings).length > 0) {
          const isManualDisconnected = this.data.settings?.manual_disconnect === true;
          if (isManualDisconnected) {
            const { session_string, ...safeSettings } = cloudData.settings;
            this.data.settings = { ...this.data.settings, ...safeSettings, session_string: '', manual_disconnect: true };
          } else {
            this.data.settings = { ...this.data.settings, ...cloudData.settings };
          }
        }
        if (Array.isArray(cloudData.api_keys)) {
          const keyMap = new Map((this.data.api_keys || []).map((k) => [k.id, k]));
          for (const cloudKey of cloudData.api_keys) {
            const existing = keyMap.get(cloudKey.id);
            if (
              !existing ||
              new Date(cloudKey.updated_at || cloudKey.created_at || 0) >=
                new Date(existing.updated_at || existing.created_at || 0)
            ) {
              keyMap.set(cloudKey.id, { ...existing, ...cloudKey });
            }
          }
          this.data.api_keys = Array.from(keyMap.values());
        }
        this.lastCloudSync = Date.now();
        this.saveData(this.data, true);
      }
    } catch (err) {
      console.warn('[CloudDB] Sync notice:', err.message);
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

  saveData(data = this.data, immediate = true) {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const performSave = () => {
      try {
        // Persist all settings (including session_string and OTP verification tokens) so the user never has to re-login.
        // telecloud_db.json is stored safely in DATA_DIR and ignored by Git.
        const sanitized = JSON.parse(JSON.stringify(data));

        const jsonContent = JSON.stringify(sanitized, null, 2);
        const tempPath = `${DB_FILE}.tmp`;
        fs.writeFileSync(tempPath, jsonContent, 'utf-8');
        fs.renameSync(tempPath, DB_FILE);
      } catch (err) {
        console.error('[DB] Error saving JSON DB:', err.message);
      }
    };

    if (immediate) {
      performSave();
    } else {
      this.saveTimer = setTimeout(performSave, 20);
    }
  }

  // --- Settings ---
  async getSetting(key) {
    const isManualDisconnected = this.data.settings?.manual_disconnect === true;

    if (key === 'manual_disconnect') {
      return isManualDisconnected;
    }

    if (key === 'session_string') {
      if (isManualDisconnected) return '';
      return this.data.settings?.session_string || process.env.TELEGRAM_SESSION_STRING || null;
    }

    if (key === 'auth_type') {
      if (isManualDisconnected) return 'demo';
      return this.data.settings?.auth_type || process.env.TELEGRAM_AUTH_TYPE || 'saved_messages';
    }

    if (key === 'api_id') {
      return this.data.settings?.api_id || process.env.TELEGRAM_API_ID || null;
    }

    if (key === 'api_hash') {
      return this.data.settings?.api_hash || process.env.TELEGRAM_API_HASH || null;
    }

    if (key === 'bot_token') {
      if (isManualDisconnected) return '';
      return this.data.settings?.bot_token || process.env.TELEGRAM_BOT_TOKEN || null;
    }

    return this.data.settings?.[key] || null;
  }

  async setSetting(key, value) {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings[key] = value;

    if (key === 'session_string') {
      if (value) {
        this.data.settings.manual_disconnect = false;
        this.data.settings.auth_type = 'saved_messages';
        updateEnvFile({
          TELEGRAM_SESSION_STRING: value,
          TELEGRAM_AUTH_TYPE: 'saved_messages',
        });
      }
    } else if (key === 'manual_disconnect') {
      if (value === true) {
        this.data.settings.session_string = '';
        this.data.settings.auth_type = 'demo';
        updateEnvFile({
          TELEGRAM_SESSION_STRING: '',
          TELEGRAM_AUTH_TYPE: 'demo',
        });
      }
    } else if (key === 'api_id' && value) {
      updateEnvFile({ TELEGRAM_API_ID: value });
    } else if (key === 'api_hash' && value) {
      updateEnvFile({ TELEGRAM_API_HASH: value });
    }

    this.saveData(this.data, true);
    cloudDbService.saveSettings(this.data.settings).catch(() => {});
    return value;
  }

  async getAllSettings() {
    if (!this.data.settings || Date.now() - this.lastCloudSync > 60000) {
      await this.syncFromCloud();
    }
    const isManualDisconnected = this.data.settings?.manual_disconnect === true;
    return {
      ...this.data.settings,
      manual_disconnect: isManualDisconnected,
      auth_type: isManualDisconnected ? 'demo' : (this.data.settings?.auth_type || process.env.TELEGRAM_AUTH_TYPE || 'saved_messages'),
      api_id: this.data.settings?.api_id || process.env.TELEGRAM_API_ID || '',
      api_hash: this.data.settings?.api_hash || process.env.TELEGRAM_API_HASH || '',
      session_string: isManualDisconnected ? '' : (this.data.settings?.session_string || process.env.TELEGRAM_SESSION_STRING || ''),
      bot_token: isManualDisconnected ? '' : (this.data.settings?.bot_token || process.env.TELEGRAM_BOT_TOKEN || ''),
    };
  }

  // --- Folders ---
  async getFolders(includeTrash = true) {
    if (!this.data.folders || this.data.folders.length === 0 || Date.now() - this.lastCloudSync > 5000) {
      await this.syncFromCloud();
    }
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
    return (this.data.folders || []).find((f) => f.id === id) || null;
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
    await cloudDbService.saveFolder(newFolder);
    return newFolder;
  }

  async updateFolder(id, updates) {
    const folder = (this.data.folders || []).find((f) => f.id === id);
    if (!folder) return null;
    Object.assign(folder, updates, { updated_at: new Date().toISOString() });
    this.saveData();
    await cloudDbService.saveFolder(folder);
    return folder;
  }

  async deleteFolder(id, permanent = false) {
    if (permanent) {
      this.data.folders = (this.data.folders || []).filter((f) => f.id !== id);
      await cloudDbService.deleteFolder(id, true);
    } else {
      const folder = (this.data.folders || []).find((f) => f.id === id);
      if (folder) {
        folder.is_trash = 1;
        folder.updated_at = new Date().toISOString();
        await cloudDbService.deleteFolder(id, false);
      }
      // Also move all files in this folder to Recycle Bin
      for (const file of (this.data.files || [])) {
        if (file.folder_id === id) {
          file.is_trash = 1;
          file.updated_at = new Date().toISOString();
          cloudDbService.saveFile(file).catch(() => {});
        }
      }
    }
    this.saveData();
    return true;
  }

  async restoreFolder(id) {
    const folder = (this.data.folders || []).find((f) => f.id === id);
    if (folder) {
      folder.is_trash = 0;
      folder.updated_at = new Date().toISOString();
      await cloudDbService.saveFolder(folder);
    }
    // Also restore all files in this folder
    for (const file of (this.data.files || [])) {
      if (file.folder_id === id) {
        file.is_trash = 0;
        file.updated_at = new Date().toISOString();
        cloudDbService.saveFile(file).catch(() => {});
      }
    }
    this.saveData();
    return folder;
  }

  // --- Files ---
  async getFiles({ folder_id, category, filter = 'all', search = '', sortBy = 'created_at', sortOrder = 'desc' } = {}) {
    if (!this.data.files || this.data.files.length === 0 || Date.now() - this.lastCloudSync > 3000) {
      await this.syncFromCloud();
    }
    let result = [...(this.data.files || [])];

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

    const activeFolderIds = new Set(
      (this.data.folders || []).filter((f) => !f.is_trash).map((f) => f.id)
    );

    // Folder filter
    if (folder_id !== undefined && filter !== 'trash' && filter !== 'starred' && filter !== 'recent') {
      if (folder_id === null || folder_id === 'root') {
        result = result.filter((f) => !f.folder_id || !activeFolderIds.has(f.folder_id));
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
    let found = (this.data.files || []).find((f) => f.id === id);
    if (!found) {
      this.data = this.loadData();
      found = (this.data.files || []).find((f) => f.id === id);
    }
    if (!found) {
      await this.syncFromCloud();
      found = (this.data.files || []).find((f) => f.id === id);
    }
    return found || null;
  }

  async getFileByTelegramMsgId(msgId) {
    return (this.data.files || []).find((f) => f.telegram_msg_id === msgId) || null;
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
      telegram_chunk_ids: file.telegram_chunk_ids || null,
      is_chunked: file.is_chunked || false,
      total_parts: file.total_parts || 1,
      telegram_chat_id: file.telegram_chat_id || null,
      file_hash: file.file_hash || null,
      storage_type: file.storage_type || 'telegram', // 'telegram' | 'local'
      local_path: file.local_path || null,
      thumbnail_path: file.thumbnail_path || null,
      api_key_id: file.api_key_id || null,
      tags: file.tags || [],
      is_starred: file.is_starred || 0,
      is_trash: 0,
      is_shared: file.is_shared ? 1 : 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.files = [newFile, ...(this.data.files || []).filter((f) => f.id !== newFile.id)];
    this.saveData();
    await cloudDbService.saveFile(newFile);
    return newFile;
  }

  async updateFile(id, updates) {
    const file = (this.data.files || []).find((f) => f.id === id);
    if (!file) return null;
    Object.assign(file, updates, { updated_at: new Date().toISOString() });
    this.saveData();
    await cloudDbService.saveFile(file);
    return file;
  }

  async deleteFile(id, trashOnly = true) {
    if (trashOnly) {
      const file = (this.data.files || []).find((f) => f.id === id);
      if (file) {
        file.is_trash = 1;
        file.updated_at = new Date().toISOString();
        await cloudDbService.deleteFile(id, false);
      }
    } else {
      this.data.files = (this.data.files || []).filter((f) => f.id !== id);
      await cloudDbService.deleteFile(id, true);
    }
    this.saveData();
    return true;
  }

  async restoreFile(id) {
    const file = (this.data.files || []).find((f) => f.id === id);
    if (file) {
      file.is_trash = 0;
      file.updated_at = new Date().toISOString();
      await cloudDbService.saveFile(file);
    }
    this.saveData();
    return file;
  }

  async emptyTrash() {
    const trashedFiles = (this.data.files || []).filter((f) => f.is_trash === 1);
    for (const f of trashedFiles) {
      cloudDbService.deleteFile(f.id, true).catch(() => {});
    }
    this.data.files = (this.data.files || []).filter((f) => !f.is_trash);
    this.data.folders = (this.data.folders || []).filter((f) => !f.is_trash);
    this.saveData();
    return { count: trashedFiles.length, trashedFiles };
  }

  // --- API Keys Management ---
  async getApiKeys() {
    if (!this.data.api_keys || this.data.api_keys.length === 0 || Date.now() - this.lastCloudSync > 60000) {
      await this.syncFromCloud();
    }
    // Return keys safely with masked prefix (never expose plaintext key or raw hash)
    return (this.data.api_keys || []).map((k) => ({
      id: k.id,
      name: k.name,
      purpose: k.purpose,
      validity: k.validity,
      expires_at: k.expires_at,
      folder_id: k.folder_id,
      key: k.key_prefix || (k.key ? `${k.key.slice(0, 14)}••••••••` : '••••••••'),
      key_prefix: k.key_prefix,
      status: k.status,
      total_uploads: k.total_uploads || 0,
      last_used_at: k.last_used_at,
      created_at: k.created_at,
      updated_at: k.updated_at,
    }));
  }

  async getApiKeyById(id) {
    let found = (this.data.api_keys || []).find((k) => k.id === id);
    if (!found) {
      await this.syncFromCloud();
      found = (this.data.api_keys || []).find((k) => k.id === id);
    }
    return found || null;
  }

  async getApiKeyByKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    const cleanKey = rawKey.trim();
    const providedHash = crypto.createHash('sha256').update(cleanKey).digest('hex');
    const providedBuffer = Buffer.from(providedHash, 'utf-8');

    const findMatch = () => {
      return (this.data.api_keys || []).find((k) => {
        if (k.key_hash) {
          const storedBuffer = Buffer.from(k.key_hash, 'utf-8');
          if (storedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(storedBuffer, providedBuffer)) {
            return true;
          }
        }
        if (k.key) {
          // Backward compatibility for existing plaintext keys with constant-time check
          const legacyHash = crypto.createHash('sha256').update(k.key).digest('hex');
          const legacyBuffer = Buffer.from(legacyHash, 'utf-8');
          if (legacyBuffer.length === providedBuffer.length && crypto.timingSafeEqual(legacyBuffer, providedBuffer)) {
            return true;
          }
        }
        return false;
      });
    };

    let found = findMatch();
    if (!found) {
      this.data = this.loadData();
      found = findMatch();
    }
    if (!found) {
      await this.syncFromCloud();
      found = findMatch();
    }
    return found || null;
  }

  async createApiKey({ name = 'My Website API Key', purpose = 'web', validity = 'never' } = {}) {
    if (!this.data.api_keys) this.data.api_keys = [];
    const rawRandom = crypto.randomBytes(24).toString('hex');
    const secretKey = `htc_live_${rawRandom}`;
    const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');
    const keyPrefix = `htc_live_${rawRandom.substring(0, 6)}...${rawRandom.slice(-4)}`;

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
      key_hash: keyHash,
      key_prefix: keyPrefix,
      status: 'active', // 'active' | 'revoked'
      total_uploads: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.api_keys.push(newApiKey);
    this.saveData();
    await cloudDbService.saveApiKey(newApiKey);
    // Return full key string ONLY on creation response so user can copy it once
    return {
      ...newApiKey,
      key: secretKey,
      secret_key: secretKey,
    };
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
    this.data = this.loadData();
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
