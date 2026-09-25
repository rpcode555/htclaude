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
    api_id: process.env.TELEGRAM_API_ID || '39504238',
    api_hash: process.env.TELEGRAM_API_HASH || '39268a286a89e430e14728116cfe0680',
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

// ---------------------------------------------------------------------------
// Shared normalization / validation helpers (also exported for controllers)
// ---------------------------------------------------------------------------

// Storage is Telegram-only: there is no local storage fallback for uploads.
const TELEGRAM_STORAGE_TYPE = 'telegram';

// Tokens that explicitly mean "the root folder" (as opposed to "no folder filter").
const ROOT_FOLDER_TOKENS = new Set(['', 'root', 'all', 'null', 'undefined', 'none']);

const ALLOWED_FILE_FILTERS = new Set(['all', 'trash', 'starred', 'recent']);
const ALLOWED_SORT_FIELDS = new Set([
  'name',
  'original_name',
  'size',
  'created_at',
  'updated_at',
  'category',
  'mime_type',
  'is_starred',
  'is_trash',
  'telegram_msg_id',
  'folder_id',
]);

const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;
const MAX_SEARCH_LENGTH = 256;

// Deletion tombstones: local (and snapshot-synced) markers that stop deleted
// records from being resurrected by a stale cloud / Telegram-backup copy.
const TOMBSTONE_KINDS = ['files', 'folders', 'api_keys'];
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TOMBSTONES_PER_KIND = 5000;

function toTimestamp(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDeletedRecord(record) {
  if (!record || typeof record !== 'object') return false;
  return record.is_deleted === 1 || record.is_deleted === true || !!record.deleted_at;
}

/** Coerce a Telegram message id into a positive integer, or null. */
function normalizeMessageId(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/** Coerce any input into a de-duplicated list of valid Telegram message ids. */
function normalizeMessageIds(value) {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const id = normalizeMessageId(entry);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Normalize a user supplied tag list.
 * Returns an array for valid input (including null) and `null` for invalid input
 * so callers can answer with 400 instead of silently persisting garbage.
 */
function normalizeTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const tag = String(raw)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Distinguish an EXPLICIT root folder selection from an omitted folder filter.
 *  - `undefined`            -> no folder filter at all
 *  - `null` / '' / 'root'   -> explicit root folder selection
 *  - anything else          -> that concrete folder id
 */
function normalizeFolderFilter(value) {
  if (value === undefined) {
    return { provided: false, isRoot: false, id: null };
  }
  if (value === null) {
    return { provided: true, isRoot: true, id: null };
  }
  if (typeof value === 'string') {
    const token = value.trim();
    if (ROOT_FOLDER_TOKENS.has(token.toLowerCase())) {
      return { provided: true, isRoot: true, id: null };
    }
    return { provided: true, isRoot: false, id: value };
  }
  return { provided: true, isRoot: false, id: String(value) };
}

function normalizeSearchTerm(value) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, MAX_SEARCH_LENGTH);
}

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

  // --- Tombstones (deletion-safe sync) -------------------------------------

  _ensureMeta(data = this.data) {
    if (!data || typeof data !== 'object') return data;
    if (!data.meta || typeof data.meta !== 'object' || Array.isArray(data.meta)) {
      data.meta = {};
    }
    if (!data.meta.tombstones || typeof data.meta.tombstones !== 'object' || Array.isArray(data.meta.tombstones)) {
      data.meta.tombstones = {};
    }
    for (const kind of TOMBSTONE_KINDS) {
      const bucket = data.meta.tombstones[kind];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        data.meta.tombstones[kind] = {};
      }
    }
    const version = Number(data.meta.schema_version) || 0;
    data.meta.schema_version = Math.max(version, 2);
    return data;
  }

  _pruneTombstones(data = this.data, now = Date.now()) {
    const tombstones = data && data.meta && data.meta.tombstones;
    if (!tombstones) return;
    for (const kind of TOMBSTONE_KINDS) {
      const bucket = tombstones[kind];
      if (!bucket) continue;
      const kept = Object.entries(bucket)
        .filter(([, at]) => now - toTimestamp(at) <= TOMBSTONE_RETENTION_MS)
        .sort((a, b) => toTimestamp(b[1]) - toTimestamp(a[1]))
        .slice(0, MAX_TOMBSTONES_PER_KIND);
      tombstones[kind] = Object.fromEntries(kept);
    }
  }

  /** Remember that `id` was permanently deleted, so stale copies cannot resurrect it. */
  addTombstone(kind, id, at = new Date().toISOString()) {
    if (!id) return;
    this._ensureMeta();
    this.data.meta.tombstones[kind][String(id)] = at;
  }

  getTombstone(kind, id) {
    if (!id) return null;
    return (this.data.meta && this.data.meta.tombstones && this.data.meta.tombstones[kind] && this.data.meta.tombstones[kind][String(id)]) || null;
  }

  /** True when a local tombstone is at least as new as the record (record is dead). */
  isSupersededByTombstone(kind, record) {
    if (!record || !record.id) return false;
    const at = this.getTombstone(kind, record.id);
    if (!at) return false;
    return toTimestamp(at) >= Math.max(toTimestamp(record.updated_at), toTimestamp(record.created_at));
  }

  _mergeCloudTombstones(incoming) {
    if (!incoming || typeof incoming !== 'object') return;
    this._ensureMeta();
    for (const kind of TOMBSTONE_KINDS) {
      const bucket = incoming[kind];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      for (const [id, at] of Object.entries(bucket)) {
        const existingAt = this.data.meta.tombstones[kind][id];
        if (!existingAt || toTimestamp(at) > toTimestamp(existingAt)) {
          this.data.meta.tombstones[kind][id] = typeof at === 'string' ? at : new Date().toISOString();
        }
      }
    }
  }

  _normalizeRecord(kind, record) {
    if (kind === 'files') return this.normalizeFileRecord(record);
    if (kind === 'folders') return this.normalizeFolderRecord(record);
    if (kind === 'api_keys') return this.normalizeApiKeyRecord(record);
    return { ...record };
  }

  /**
   * Last-write-wins merge that honours deletion tombstones.
   * Used for both the cloud DB and Telegram backup snapshots.
   */
  _mergeCollection(kind, localList, incomingList) {
    const merged = new Map();
    const candidates = [...(Array.isArray(localList) ? localList : []), ...(Array.isArray(incomingList) ? incomingList : [])];

    for (const raw of candidates) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;

      // 1) Deletion markers win over live copies of the same record.
      if (isDeletedRecord(raw)) {
        const deletedAt = raw.deleted_at || raw.updated_at || new Date().toISOString();
        const existing = merged.get(raw.id);
        if (!existing || toTimestamp(deletedAt) >= toTimestamp(existing.updated_at)) {
          this.addTombstone(kind, raw.id, deletedAt);
        }
        if (!this.isSupersededByTombstone(kind, existing || raw)) {
          // A newer local copy exists -> keep it
          if (existing) merged.set(raw.id, existing);
        } else {
          merged.delete(raw.id);
        }
        continue;
      }

      // 2) A local tombstone newer than this copy means the record is deleted.
      if (this.isSupersededByTombstone(kind, raw)) continue;

      const record = this._normalizeRecord(kind, raw);
      const existing = merged.get(record.id);
      if (!existing) {
        merged.set(record.id, record);
        continue;
      }
      if (toTimestamp(record.updated_at) >= toTimestamp(existing.updated_at)) {
        merged.set(record.id, { ...existing, ...record });
      }
    }

    return Array.from(merged.values());
  }

  // --- Cloud sync ----------------------------------------------------------

  async syncFromCloud() {
    try {
      const cloudData = await cloudDbService.fetchAll();
      if (!cloudData) {
        this.lastCloudSync = Date.now();
        return false;
      }

      this._ensureMeta();
      this._mergeCloudTombstones((cloudData.meta && cloudData.meta.tombstones) || cloudData.tombstones || null);

      if (Array.isArray(cloudData.files)) {
        this.data.files = this._mergeCollection('files', this.data.files, cloudData.files);
      }
      if (Array.isArray(cloudData.folders) && cloudData.folders.length > 0) {
        this.data.folders = this._mergeCollection('folders', this.data.folders, cloudData.folders);
      }
      if (Array.isArray(cloudData.api_keys)) {
        this.data.api_keys = this._mergeCollection('api_keys', this.data.api_keys, cloudData.api_keys);
      }
      if (cloudData.settings && Object.keys(cloudData.settings).length > 0) {
        const isManualDisconnected =
          this.data.settings?.manual_disconnect === true || cloudData.settings?.manual_disconnect === true;
        if (isManualDisconnected) {
          const { session_string, ...safeSettings } = cloudData.settings;
          this.data.settings = {
            ...this.data.settings,
            ...safeSettings,
            session_string: '',
            manual_disconnect: true,
            auth_type: 'demo',
          };
        } else {
          // Keep valid session_string if cloudData has non-empty session_string or local has one
          const localSession = this.data.settings?.session_string || process.env.TELEGRAM_SESSION_STRING || '';
          const cloudSession = cloudData.settings?.session_string || '';
          const sessionToKeep = cloudSession || localSession;

          this.data.settings = {
            ...this.data.settings,
            ...cloudData.settings,
            session_string: sessionToKeep,
          };
        }
      }

      this.lastCloudSync = Date.now();
      this.saveData(this.data, true);
      return true;
    } catch (err) {
      console.warn('[CloudDB] Sync notice:', err.message);
      return false;
    }
  }

  // --- Load / save ---------------------------------------------------------

  loadData() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return this.normalizeData(JSON.parse(raw));
      }
      if (BUNDLED_DB_FILE !== DB_FILE && fs.existsSync(BUNDLED_DB_FILE)) {
        const raw = fs.readFileSync(BUNDLED_DB_FILE, 'utf-8');
        const merged = this.normalizeData(JSON.parse(raw));
        this.saveData(merged, true);
        return merged;
      }
    } catch (err) {
      console.error('[DB] Error loading JSON DB, resetting to defaults:', err.message);
    }
    const fresh = this.normalizeData(JSON.parse(JSON.stringify(defaultData)));
    this.saveData(fresh, true);
    return fresh;
  }

  /** Guarantee a well-formed document and enforce the Telegram-only metadata rules. */
  normalizeData(data) {
    const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const result = {
      ...source,
      settings: { ...defaultData.settings, ...(source.settings && typeof source.settings === 'object' ? source.settings : {}) },
      folders: [],
      files: [],
      api_keys: [],
    };

    this._ensureMeta(result);
    if (source.meta && source.meta.tombstones) {
      this._mergeCloudTombstonesInto(result, source.meta.tombstones);
    }

    result.folders = (Array.isArray(source.folders) ? source.folders : [])
      .filter((f) => f && typeof f === 'object' && f.id)
      .map((f) => this.normalizeFolderRecord(f))
      .filter((f) => !this.isSupersededByTombstoneInto(result, 'folders', f));

    result.files = (Array.isArray(source.files) ? source.files : [])
      .filter((f) => f && typeof f === 'object' && f.id)
      .map((f) => this.normalizeFileRecord(f))
      .filter((f) => !this.isSupersededByTombstoneInto(result, 'files', f));

    result.api_keys = (Array.isArray(source.api_keys) ? source.api_keys : [])
      .filter((k) => k && typeof k === 'object' && k.id)
      .filter((k) => !isDeletedRecord(k))
      .map((k) => this.normalizeApiKeyRecord(k))
      .filter((k) => !this.isSupersededByTombstoneInto(result, 'api_keys', k));

    return result;
  }

  isSupersededByTombstoneInto(data, kind, record) {
    const at = data.meta && data.meta.tombstones && data.meta.tombstones[kind] && data.meta.tombstones[kind][record.id];
    if (!at) return false;
    return toTimestamp(at) >= Math.max(toTimestamp(record.updated_at), toTimestamp(record.created_at));
  }

  _mergeCloudTombstonesInto(data, incoming) {
    if (!incoming || typeof incoming !== 'object') return;
    for (const kind of TOMBSTONE_KINDS) {
      const bucket = incoming[kind];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      for (const [id, at] of Object.entries(bucket)) {
        const existingAt = data.meta.tombstones[kind][id];
        if (!existingAt || toTimestamp(at) > toTimestamp(existingAt)) {
          data.meta.tombstones[kind][id] = typeof at === 'string' ? at : new Date().toISOString();
        }
      }
    }
  }

  normalizeFileRecord(record) {
    const out = { ...(record && typeof record === 'object' ? record : {}) };
    out.name = String(out.name || out.original_name || 'unnamed_file').slice(0, 512);
    out.original_name = String(out.original_name || out.name).slice(0, 512);
    out.mime_type = out.mime_type || 'application/octet-stream';

    const size = Number(out.size);
    out.size = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
    out.category = out.category || detectCategory(out.mime_type, out.name);

    out.telegram_chunk_ids = normalizeMessageIds(out.telegram_chunk_ids);
    out.telegram_msg_id = normalizeMessageId(out.telegram_msg_id);
    if (out.telegram_msg_id && !out.telegram_chunk_ids.includes(out.telegram_msg_id)) {
      out.telegram_chunk_ids.unshift(out.telegram_msg_id);
    }
    if (!out.telegram_msg_id && out.telegram_chunk_ids.length > 0) {
      out.telegram_msg_id = out.telegram_chunk_ids[0];
    }
    out.is_chunked = !!out.is_chunked || out.telegram_chunk_ids.length > 1;
    out.total_parts = Math.max(1, Number(out.total_parts) || out.telegram_chunk_ids.length || 1);
    out.telegram_chat_id = out.telegram_chat_id || 'me';
    out.file_hash = out.file_hash || null;

    // Telegram-only storage metadata: local paths are never persisted.
    out.storage_type = TELEGRAM_STORAGE_TYPE;
    out.local_path = null;
    out.thumbnail_path = null;

    out.api_key_id = out.api_key_id || null;
    const tags = normalizeTags(out.tags);
    out.tags = tags || [];
    out.is_starred = out.is_starred ? 1 : 0;
    out.is_trash = out.is_trash ? 1 : 0;
    out.is_shared = out.is_shared ? 1 : 0;
    out.created_at = out.created_at || new Date().toISOString();
    out.updated_at = out.updated_at || out.created_at;
    return out;
  }

  normalizeFolderRecord(record) {
    const out = { ...(record && typeof record === 'object' ? record : {}) };
    out.name = String(out.name || 'New Folder').slice(0, 255);
    out.parent_id = out.parent_id || null;
    out.color = out.color || '#3b82f6';
    out.icon = out.icon || 'folder';
    out.is_trash = out.is_trash ? 1 : 0;
    out.trashed_at = out.is_trash ? (out.trashed_at || out.updated_at || new Date().toISOString()) : null;
    out.created_at = out.created_at || new Date().toISOString();
    out.updated_at = out.updated_at || out.created_at;
    return out;
  }

  normalizeApiKeyRecord(record) {
    const out = { ...(record && typeof record === 'object' ? record : {}) };
    out.name = String(out.name || 'API Key').slice(0, 255);
    out.purpose = out.purpose || 'web';
    out.validity = out.validity || 'never';
    out.status = out.status || 'active';
    out.total_uploads = Number(out.total_uploads) > 0 ? Math.floor(Number(out.total_uploads)) : 0;
    out.created_at = out.created_at || new Date().toISOString();
    out.updated_at = out.updated_at || out.created_at;
    return out;
  }

  saveData(data = this.data, immediate = true) {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const performSave = () => {
      try {
        // Persist all settings (including session_string and OTP verification tokens) so the user never has to re-login.
        // The runtime DB lives in DATA_DIR and is git-ignored; the tracked
        // server/data/telecloud_db.json is only a sanitized seed template.
        this._ensureMeta(data);
        this._pruneTombstones(data);
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

  /** Force an immediate write to disk (used before anything reads the DB file). */
  flushData() {
    this.saveData(this.data, true);
    return true;
  }

  // --- Settings ---
  async getSetting(key) {
    const isManualDisconnected = this.data.settings?.manual_disconnect === true;

    if (key === 'manual_disconnect') {
      return isManualDisconnected;
    }

    if (key === 'session_string') {
      if (isManualDisconnected) return '';
      return this.data.settings?.session_string || process.env.TELEGRAM_SESSION_STRING || '';
    }

    if (key === 'auth_type') {
      if (isManualDisconnected) return 'demo';
      return this.data.settings?.auth_type || process.env.TELEGRAM_AUTH_TYPE || 'saved_messages';
    }

    if (key === 'api_id') {
      return this.data.settings?.api_id || process.env.TELEGRAM_API_ID || '39504238';
    }

    if (key === 'api_hash') {
      return this.data.settings?.api_hash || process.env.TELEGRAM_API_HASH || '39268a286a89e430e14728116cfe0680';
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
    if (!id || id === 'root') return null;
    return (this.data.folders || []).find((f) => f.id === id) || null;
  }

  /**
   * Depth-first, cycle-safe list of every descendant folder (excluding the root id).
   * Broken parent chains and cycles simply terminate instead of hanging.
   */
  getDescendantFolderIds(rootId) {
    const folders = this.data.folders || [];
    const byParent = new Map();
    for (const folder of folders) {
      if (!folder || !folder.id) continue;
      const parentId = folder.parent_id || null;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(folder);
    }

    const ordered = [];
    const visited = new Set([rootId]);
    const queue = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      for (const child of byParent.get(currentId) || []) {
        if (!child || !child.id || visited.has(child.id)) continue; // cycle-safe
        visited.add(child.id);
        ordered.push(child);
        queue.push(child.id);
      }
    }

    return ordered;
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

    const newFolder = this.normalizeFolderRecord({
      id: 'folder_' + crypto.randomUUID(),
      name: (name || 'New Folder').trim(),
      parent_id: pid || null,
      color: clr || '#3b82f6',
      icon: icn || 'folder',
      is_trash: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Never keep a dangling parent link: an unknown parent falls back to root.
    if (newFolder.parent_id && !(this.data.folders || []).some((f) => f.id === newFolder.parent_id)) {
      newFolder.parent_id = null;
    }

    this.data.folders = [...(this.data.folders || []), newFolder];
    this.saveData();
    await cloudDbService.saveFolder(newFolder);
    return newFolder;
  }

  async updateFolder(id, updates) {
    const folder = (this.data.folders || []).find((f) => f.id === id);
    if (!folder) return null;

    if (updates && updates.parent_id !== undefined) {
      const nextParent = updates.parent_id || null;
      if (nextParent === id || this.getDescendantFolderIds(id).some((f) => f.id === nextParent)) {
        throw new Error('A folder cannot be moved inside itself or one of its own subfolders.');
      }
    }

    const updated = this.normalizeFolderRecord({ ...folder, ...updates, id, updated_at: new Date().toISOString() });
    const index = (this.data.folders || []).findIndex((f) => f.id === id);
    this.data.folders[index] = updated;
    this.saveData();
    await cloudDbService.saveFolder(updated);
    return updated;
  }

  /**
   * Trash or permanently delete a folder.
   * Trashing cascades to every descendant folder and to the files they contain,
   * all stamped with the same `trashed_at` marker so a later restore can tell
   * them apart from children that were already in the trash beforehand.
   */
  async deleteFolder(id, permanent = false) {
    const folder = (this.data.folders || []).find((f) => f.id === id);
    if (!folder) return { deleted: false, reason: 'not_found' };

    const descendants = this.getDescendantFolderIds(id);
    const affectedFolderIds = [id, ...descendants.map((f) => f.id)];
    const affectedIdSet = new Set(affectedFolderIds);
    const stamp = new Date().toISOString();

    if (permanent) {
      this.data.folders = (this.data.folders || []).filter((f) => !affectedIdSet.has(f.id));
      for (const folderId of affectedFolderIds) {
        this.addTombstone('folders', folderId);
        cloudDbService.deleteFolder(folderId, true).catch(() => {});
      }

      // Contained files are moved to the Recycle Bin (recoverable) instead of destroyed.
      const affectedFiles = (this.data.files || []).filter((f) => affectedIdSet.has(f.folder_id));
      for (const file of affectedFiles) {
        file.is_trash = 1;
        file.trashed_at = stamp;
        file.updated_at = stamp;
        cloudDbService.saveFile(file).catch(() => {});
      }

      this.saveData();
      return { deleted: true, permanent: true, folderIds: affectedFolderIds, filesAffected: affectedFiles.length };
    }

    folder.is_trash = 1;
    folder.trashed_at = stamp;
    folder.updated_at = stamp;
    await cloudDbService.deleteFolder(id, false);

    for (const child of descendants) {
      child.is_trash = 1;
      child.trashed_at = stamp;
      child.updated_at = stamp;
      await cloudDbService.deleteFolder(child.id, false);
    }

    const affectedFiles = (this.data.files || []).filter((f) => affectedIdSet.has(f.folder_id));
    for (const file of affectedFiles) {
      file.is_trash = 1;
      file.trashed_at = stamp;
      file.updated_at = stamp;
      cloudDbService.saveFile(file).catch(() => {});
    }

    this.saveData();
    return { deleted: true, permanent: false, folderIds: affectedFolderIds, filesAffected: affectedFiles.length };
  }

  /**
   * Restore a folder (and the descendants that were trashed together with it).
   * Children that were already in the trash before this operation keep their
   * own `trashed_at` stamp and are therefore left untouched.
   */
  async restoreFolder(id) {
    const folder = (this.data.folders || []).find((f) => f.id === id);
    if (!folder) return null;

    const stamp = folder.trashed_at || folder.updated_at || null;

    folder.is_trash = 0;
    folder.trashed_at = null;
    folder.updated_at = new Date().toISOString();
    const restoredFolder = this.normalizeFolderRecord(folder);
    const folderIndex = (this.data.folders || []).findIndex((f) => f.id === id);
    this.data.folders[folderIndex] = restoredFolder;
    await cloudDbService.saveFolder(restoredFolder);

    const affectedFolderIds = new Set([id]);
    for (const child of this.getDescendantFolderIds(id)) {
      if (child.is_trash !== 1) continue;
      if (stamp && child.trashed_at && child.trashed_at !== stamp) continue; // trashed separately
      child.is_trash = 0;
      child.trashed_at = null;
      child.updated_at = new Date().toISOString();
      affectedFolderIds.add(child.id);
      await cloudDbService.saveFolder(child);
    }

    for (const file of this.data.files || []) {
      if (!affectedFolderIds.has(file.folder_id)) continue;
      if (file.is_trash !== 1) continue;
      if (stamp && file.trashed_at && file.trashed_at !== stamp) continue; // trashed separately
      file.is_trash = 0;
      file.trashed_at = null;
      file.updated_at = new Date().toISOString();
      await cloudDbService.saveFile(file);
    }

    this.saveData();
    return restoredFolder;
  }

  // --- Files ---
  async getFiles({ folder_id, category, filter = 'all', search = '', sortBy = 'created_at', sortOrder = 'desc' } = {}) {
    if (!this.data.files || this.data.files.length === 0 || Date.now() - this.lastCloudSync > 3000) {
      await this.syncFromCloud();
    }
    // Telegram-only metadata: no local sandbox / dummy files are ever listed.
    let result = (this.data.files || []).filter((f) => f.storage_type === TELEGRAM_STORAGE_TYPE && f.telegram_msg_id);

    const activeFilter = ALLOWED_FILE_FILTERS.has(filter) ? filter : 'all';

    // Trash filter
    if (activeFilter === 'trash') {
      result = result.filter((f) => f.is_trash === 1);
    } else {
      result = result.filter((f) => !f.is_trash);
    }

    // Starred filter
    if (activeFilter === 'starred') {
      result = result.filter((f) => f.is_starred === 1);
    }

    // Recent filter (last 7 days)
    if (activeFilter === 'recent') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      result = result.filter((f) => f.created_at >= sevenDaysAgo);
    }

    const activeFolderIds = new Set(
      (this.data.folders || []).filter((f) => !f.is_trash).map((f) => f.id)
    );

    // Folder filter - only applied when the caller explicitly asked for one.
    const folderFilter = normalizeFolderFilter(folder_id);
    if (folderFilter.provided && activeFilter === 'all') {
      if (folderFilter.isRoot) {
        result = result.filter((f) => !f.folder_id || !activeFolderIds.has(f.folder_id));
      } else {
        result = result.filter((f) => f.folder_id === folderFilter.id);
      }
    }

    // Category filter
    if (category) {
      const wanted = String(category);
      result = result.filter((f) => f.category === wanted);
    }

    // Search filter
    const searchTerm = normalizeSearchTerm(search).toLowerCase();
    if (searchTerm) {
      result = result.filter(
        (f) =>
          String(f.name || '').toLowerCase().includes(searchTerm) ||
          (Array.isArray(f.tags) && f.tags.some((t) => String(t).toLowerCase().includes(searchTerm)))
      );
    }

    // Sorting
    const sortField = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'created_at';
    const direction = sortOrder === 'asc' ? 'asc' : 'desc';
    result.sort((a, b) => {
      let valA = a[sortField] ?? '';
      let valB = b[sortField] ?? '';

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
      }

      if (direction === 'asc') {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      }
      return valA < valB ? 1 : valA > valB ? -1 : 0;
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

  /** Telegram message ids are the source of truth for uniqueness (chunk ids included). */
  async getFileByTelegramMsgId(msgId) {
    const id = normalizeMessageId(msgId);
    if (id === null) return null;
    return (
      (this.data.files || []).find(
        (f) =>
          f.telegram_msg_id === id ||
          (Array.isArray(f.telegram_chunk_ids) && f.telegram_chunk_ids.includes(id))
      ) || null
    );
  }

  async insertFile(file) {
    const nowIso = new Date().toISOString();
    const draft = this.normalizeFileRecord({
      ...file,
      id: file.id || 'file_' + crypto.randomUUID(),
      created_at: file.created_at || nowIso,
      updated_at: nowIso,
    });

    // Uniqueness: one record per Telegram message (id or chunk id).
    const duplicate = (this.data.files || []).find(
      (f) =>
        f.id !== draft.id &&
        (f.telegram_msg_id === draft.telegram_msg_id ||
          (Array.isArray(f.telegram_chunk_ids) && f.telegram_chunk_ids.some((cid) => draft.telegram_chunk_ids.includes(cid))))
    );

    if (duplicate) {
      const merged = this.normalizeFileRecord({
        ...duplicate,
        ...draft,
        id: duplicate.id,
        created_at: duplicate.created_at || draft.created_at,
      });
      const index = (this.data.files || []).findIndex((f) => f.id === duplicate.id);
      this.data.files[index] = merged;
      this.saveData();
      await cloudDbService.saveFile(merged);
      return merged;
    }

    this.data.files = [draft, ...(this.data.files || []).filter((f) => f.id !== draft.id)];
    this.saveData();
    await cloudDbService.saveFile(draft);
    return draft;
  }

  async updateFile(id, updates) {
    const index = (this.data.files || []).findIndex((f) => f.id === id);
    if (index === -1) return null;
    const updated = this.normalizeFileRecord({
      ...this.data.files[index],
      ...updates,
      id,
      updated_at: new Date().toISOString(),
    });
    this.data.files[index] = updated;
    this.saveData();
    await cloudDbService.saveFile(updated);
    return updated;
  }

  /**
   * Trash (trashOnly = true) or permanently delete a file.
   * Returns the affected record, or null when the id is unknown.
   */
  async deleteFile(id, trashOnly = true) {
    const index = (this.data.files || []).findIndex((f) => f.id === id);
    const file = index === -1 ? null : this.data.files[index];

    if (trashOnly) {
      if (file) {
        file.is_trash = 1;
        file.trashed_at = new Date().toISOString();
        file.updated_at = file.trashed_at;
        await cloudDbService.deleteFile(id, false);
      }
    } else {
      if (file) {
        this.data.files.splice(index, 1);
        this.addTombstone('files', id);
      }
      await cloudDbService.deleteFile(id, true);
    }

    this.saveData();
    return file || null;
  }

  async restoreFile(id) {
    const file = (this.data.files || []).find((f) => f.id === id);
    if (file) {
      file.is_trash = 0;
      file.trashed_at = null;
      file.updated_at = new Date().toISOString();
      await cloudDbService.saveFile(file);
    }
    this.saveData();
    return file || null;
  }

  async emptyTrash() {
    const trashedFiles = (this.data.files || []).filter((f) => f.is_trash === 1);
    const trashedFolders = (this.data.folders || []).filter((f) => f.is_trash === 1);

    for (const f of trashedFiles) {
      this.addTombstone('files', f.id);
      cloudDbService.deleteFile(f.id, true).catch(() => {});
    }
    for (const folder of trashedFolders) {
      this.addTombstone('folders', folder.id);
      cloudDbService.deleteFolder(folder.id, true).catch(() => {});
    }

    this.data.files = (this.data.files || []).filter((f) => !f.is_trash);
    this.data.folders = (this.data.folders || []).filter((f) => !f.is_trash);
    this.saveData(this.data, true);
    return {
      count: trashedFiles.length,
      trashedFiles,
      trashedFolders,
      folderCount: trashedFolders.length,
    };
  }

  // --- Snapshot merge (Telegram backup restore) ---------------------------

  /**
   * Merge a database snapshot (Telegram backup) into the local state.
   * Uses the same tombstone-aware last-write-wins rules as the cloud sync so a
   * stale snapshot can never resurrect permanently deleted metadata.
   */
  mergeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { restored: false, files: 0, folders: 0, api_keys: 0 };
    }

    this._ensureMeta();
    this._mergeCloudTombstones((snapshot.meta && snapshot.meta.tombstones) || snapshot.tombstones || null);

    let restored = false;
    if (Array.isArray(snapshot.folders) && snapshot.folders.length > 0) {
      this.data.folders = this._mergeCollection('folders', this.data.folders, snapshot.folders);
      restored = true;
    }
    if (Array.isArray(snapshot.files) && snapshot.files.length > 0) {
      this.data.files = this._mergeCollection('files', this.data.files, snapshot.files);
      restored = true;
    }
    if (Array.isArray(snapshot.api_keys) && snapshot.api_keys.length > 0) {
      this.data.api_keys = this._mergeCollection('api_keys', this.data.api_keys, snapshot.api_keys);
      restored = true;
    }

    this.saveData();
    return {
      restored,
      files: (this.data.files || []).length,
      folders: (this.data.folders || []).length,
      api_keys: (this.data.api_keys || []).length,
    };
  }

  /**
   * Drop file metadata whose Telegram messages were authoritatively confirmed
   * as gone, recording tombstones so a stale cloud copy cannot bring them back.
   * Returns the removed file ids.
   */
  purgeMissingTelegramFiles(fileIds) {
    const targets = new Set((fileIds || []).filter(Boolean));
    if (targets.size === 0) return [];

    const removed = (this.data.files || []).filter(
      (f) =>
        f.telegram_msg_id != null &&
        (targets.has(f.telegram_msg_id) || (Array.isArray(f.telegram_chunk_ids) && f.telegram_chunk_ids.some((cid) => targets.has(cid))))
    );
    if (removed.length === 0) return [];

    const removedIds = new Set(removed.map((f) => f.id));
    this.data.files = (this.data.files || []).filter((f) => !removedIds.has(f.id));
    for (const f of removed) {
      this.addTombstone('files', f.id);
    }
    this.saveData();
    return removed.map((f) => f.id);
  }

  // --- API Keys Management ---
  async getApiKeys() {
    if (!this.data.api_keys || this.data.api_keys.length === 0 || Date.now() - this.lastCloudSync > 60000) {
      await this.syncFromCloud();
    }
    // Return full API keys without truncating with dots
    return (this.data.api_keys || [])
      .filter((k) => !isDeletedRecord(k) && !this.isSupersededByTombstone('api_keys', k))
      .map((k) => {
        const fullKey = k.key || k.secret_key || k.key_prefix || '';
        return {
          id: k.id,
          name: k.name,
          purpose: k.purpose,
          validity: k.validity,
          expires_at: k.expires_at,
          folder_id: k.folder_id,
          key: fullKey,
          key_prefix: fullKey,
          status: k.status,
          total_uploads: k.total_uploads || 0,
          last_used_at: k.last_used_at,
          created_at: k.created_at,
          updated_at: k.updated_at,
        };
      });
  }

  async getApiKeyById(id) {
    let found = (this.data.api_keys || []).find((k) => k.id === id);
    if (!found) {
      await this.syncFromCloud();
      found = (this.data.api_keys || []).find((k) => k.id === id);
    }
    if (!found || isDeletedRecord(found) || this.isSupersededByTombstone('api_keys', found)) return null;
    const fullKey = found.key || found.secret_key || found.key_prefix || '';
    return {
      ...found,
      key: fullKey,
      key_prefix: fullKey,
    };
  }

  async getApiKeyByKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    const cleanKey = rawKey.trim();
    const providedHash = crypto.createHash('sha256').update(cleanKey).digest('hex');
    const providedBuffer = Buffer.from(providedHash, 'utf-8');

    const findMatch = () => {
      return (this.data.api_keys || []).find((k) => {
        if (isDeletedRecord(k) || this.isSupersededByTombstone('api_keys', k)) return false;
        if (k.status === 'revoked' || k.status === 'deleted') return false;
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

    const newApiKey = this.normalizeApiKeyRecord({
      id: 'key_' + crypto.randomUUID(),
      name: keyName,
      purpose: purpose || 'web',
      validity: validity || 'never',
      expires_at,
      folder_id: targetFolder ? targetFolder.id : null,
      key: secretKey,
      key_hash: keyHash,
      key_prefix: secretKey,
      status: 'active', // 'active' | 'revoked'
      total_uploads: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.data.api_keys.push(newApiKey);
    this.saveData();
    await cloudDbService.saveApiKey(newApiKey);
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
      apiKey.updated_at = new Date().toISOString();
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
    apiKey.updated_at = new Date().toISOString();
    this.saveData();
    return newFolder;
  }

  async getFilesByApiKeyId(apiKeyId) {
    this.data = this.loadData();
    return (this.data.files || []).filter(
      (f) => !f.is_trash && (f.api_key_id === apiKeyId || (Array.isArray(f.tags) && f.tags.includes(apiKeyId)))
    );
  }

  /** Persist an API key mutation locally and in the cloud DB. */
  async updateApiKey(id, updates) {
    const index = (this.data.api_keys || []).findIndex((k) => k.id === id);
    if (index === -1) return null;

    const allowed = [
      'name',
      'purpose',
      'validity',
      'expires_at',
      'folder_id',
      'key',
      'key_hash',
      'key_prefix',
      'status',
      'total_uploads',
      'last_used_at',
    ];
    const cleanUpdates = {};
    for (const field of allowed) {
      if (updates && updates[field] !== undefined) cleanUpdates[field] = updates[field];
    }
    if (typeof cleanUpdates.name === 'string') {
      cleanUpdates.name = cleanUpdates.name.trim() || this.data.api_keys[index].name;
    }
    if (cleanUpdates.status && !['active', 'revoked'].includes(cleanUpdates.status)) {
      delete cleanUpdates.status;
    }

    const updated = this.normalizeApiKeyRecord({
      ...this.data.api_keys[index],
      ...cleanUpdates,
      id,
      updated_at: new Date().toISOString(),
    });
    this.data.api_keys[index] = updated;
    this.saveData();
    await cloudDbService.saveApiKey(updated);
    return updated;
  }

  /**
   * Delete an API key. The cloud DB adapter has no delete primitive for keys,
   * so a tombstone row is published instead and honoured by every sync.
   */
  async deleteApiKey(id) {
    const key = (this.data.api_keys || []).find((k) => k.id === id);
    this.data.api_keys = (this.data.api_keys || []).filter((k) => k.id !== id);
    this.addTombstone('api_keys', id);
    this.saveData();

    if (key) {
      try {
        await cloudDbService.saveApiKey({
          ...key,
          status: 'deleted',
          is_deleted: 1,
          deleted_at: new Date().toISOString(),
        });
      } catch (e) {}
    }
    return true;
  }

  async incrementApiKeyUsage(id) {
    const apiKey = (this.data.api_keys || []).find((k) => k.id === id);
    if (apiKey) {
      apiKey.total_uploads = (apiKey.total_uploads || 0) + 1;
      apiKey.last_used_at = new Date().toISOString();
      apiKey.updated_at = apiKey.last_used_at;
      this.saveData();
      cloudDbService.saveApiKey(apiKey).catch(() => {});
    }
  }

  // --- Stats ---
  async getStats() {
    this.data = this.loadData();
    const isTelegramFile = (f) => !!(f && f.storage_type === TELEGRAM_STORAGE_TYPE && f.telegram_msg_id);
    const activeFiles = (this.data.files || []).filter((f) => !f.is_trash && isTelegramFile(f));
    const trashFiles = (this.data.files || []).filter((f) => f.is_trash === 1 && isTelegramFile(f));
    const starredFiles = (this.data.files || []).filter((f) => !f.is_trash && f.is_starred === 1 && isTelegramFile(f));

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
      totalFolders: (this.data.folders || []).filter((f) => !f.is_trash).length,
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
  const mime = String(mimeType || '').toLowerCase();

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
    mime.includes('android') ||
    mime.includes('package-archive') ||
    ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso', '.apk', '.xapk', '.apks'].includes(ext)
  ) {
    return 'archives';
  }
  return 'others';
}

const db = new Database();

module.exports = {
  db,
  detectCategory,
  normalizeTags,
  normalizeMessageId,
  normalizeMessageIds,
  normalizeFolderFilter,
  getSetting: (k) => db.getSetting(k),
  setSetting: (k, v) => db.setSetting(k, v),
  getAllSettings: () => db.getAllSettings(),
};
