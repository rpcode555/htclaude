/**
 * Cloud Database Service - Unified Multi-Cloud Storage Adapter
 * Integrates Firebase Firestore and Supabase Cloud PostgreSQL
 * with local caching for 100% resilient real-time persistence.
 *
 * Guarantees implemented here:
 *  - every REST call is inspected: non-2xx responses and empty result sets are
 *    logged instead of being swallowed by a bare `catch`;
 *  - the Supabase row keeps the COMPLETE file schema (including the multi-part
 *    chunk columns and the share flag), so a round-trip through the cloud cannot
 *    silently truncate a file record;
 *  - API keys are never written to the cloud in plaintext - only the SHA-256
 *    hash plus a masked display prefix are persisted.
 *
 * API key compatibility notes:
 *  - `db.getApiKeyByKey()` authenticates against `key_hash` first and only
 *    falls back to a legacy plaintext `key` column, so hashed-only cloud rows
 *    keep working.
 *  - Keys that were synced to the cloud *before* this change may still have a
 *    plaintext `key` value in the Supabase/Firestore row. New writes no longer
 *    send it, and the Firestore path explicitly overwrites it with `null` so
 *    existing Firestore secrets are erased on the next write. The Supabase path
 *    omits the column (PostgREST merges only the provided columns) because the
 *    column may be declared NOT NULL; delete the row (DELETE /developer/keys/:id)
 *    to purge a legacy plaintext value.
 *  - Because a fresh install restored from the cloud only has the hash, the
 *    Dashboard shows the masked prefix instead of the full secret. That is
 *    intended: the plaintext is only ever shown once, at creation time.
 */

const firestoreService = require('./firestoreService');

/**
 * Resolve the Supabase configuration lazily: db.js pulls this module in before
 * dotenv has been loaded, so a snapshot taken at require() time was frequently
 * empty and silently disabled cloud persistence.
 */
function getSupabaseConfig() {
  firestoreService.ensureDotenvLoaded();
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  // Prefer the service role key: this adapter is server side only and RLS would
  // otherwise silently reject writes.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return { url, key, enabled: !!(url && key) };
}

const TABLES = {
  files: 'htc_files',
  folders: 'htc_folders',
  apiKeys: 'htc_api_keys',
  settings: 'htc_settings',
};

const FIREBASE_COLLECTIONS = {
  files: 'htc_files',
  folders: 'htc_folders',
  apiKeys: 'htc_api_keys',
  settings: 'htc_meta',
};

/**
 * Build a non-reversible, human recognisable display value for an API key.
 * Never returns the full secret.
 */
function maskApiKey(record) {
  const plaintext =
    (typeof record === 'string' ? record : record && (record.key || record.secret_key)) || '';
  if (plaintext.length > 16) {
    const hiddenLength = Math.min(16, Math.max(4, plaintext.length - 16));
    return `${plaintext.slice(0, 12)}${'*'.repeat(hiddenLength)}${plaintext.slice(-4)}`;
  }
  const hash = (record && record.key_hash) || '';
  if (hash) return `htc_live_...${hash.slice(0, 8)}`;
  return 'htc_live_...';
}

/**
 * Normalise the complete file schema for cloud persistence.
 * Every field written by db.insertFile()/db.updateFile() is represented so the
 * Supabase/Firestore row stays a lossless mirror of the local record.
 */
function buildFilePayload(file) {
  const now = new Date().toISOString();
  return {
    id: file.id,
    folder_id: file.folder_id ?? null,
    name: file.name ?? null,
    original_name: file.original_name ?? file.name ?? null,
    mime_type: file.mime_type ?? 'application/octet-stream',
    size: file.size ?? 0,
    category: file.category ?? 'others',
    // --- Telegram multi-part chunk fields (must survive cloud round-trips) ---
    telegram_msg_id: file.telegram_msg_id ?? null,
    telegram_chunk_ids: Array.isArray(file.telegram_chunk_ids)
      ? file.telegram_chunk_ids
      : file.telegram_chunk_ids ?? null,
    is_chunked: file.is_chunked ? 1 : 0,
    total_parts: file.total_parts ?? 1,
    telegram_chat_id: file.telegram_chat_id ?? null,
    // --- Share / trash flags ---
    is_shared: file.is_shared ? 1 : 0,
    is_trash: file.is_trash ? 1 : 0,
    is_starred: file.is_starred ? 1 : 0,
    // --- Misc ---
    file_hash: file.file_hash ?? null,
    storage_type: file.storage_type ?? 'telegram',
    local_path: file.local_path ?? null,
    thumbnail_path: file.thumbnail_path ?? null,
    api_key_id: file.api_key_id ?? null,
    tags: Array.isArray(file.tags) ? file.tags : [],
    created_at: file.created_at ?? now,
    updated_at: now,
  };
}

class CloudDbService {
  get supabaseUrl() {
    return getSupabaseConfig().url;
  }

  get supabaseKey() {
    return getSupabaseConfig().key;
  }

  get hasSupabase() {
    return getSupabaseConfig().enabled;
  }

  get hasFirebase() {
    return firestoreService.isEnabled();
  }

  getSupabaseHeaders(prefer) {
    const { key } = getSupabaseConfig();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    return headers;
  }

  /**
   * Perform a Supabase REST call and verify the response.
   * Returns { ok, status, data } - never throws for HTTP errors.
   */
  async supabaseRequest(path, { method = 'GET', body, prefer, params = '' } = {}) {
    const { url, key, enabled } = getSupabaseConfig();
    if (!enabled) return { ok: false, status: 0, data: null, error: 'Supabase is not configured' };

    const requestUrl = `${url}/rest/v1/${path}${params ? `?${params}` : ''}`;
    try {
      const res = await fetch(requestUrl, {
        method,
        headers: this.getSupabaseHeaders(prefer),
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300);
        } catch (e) {
          detail = '';
        }
        console.warn(`[CloudDB] Supabase ${method} ${path} failed (${res.status})${detail ? `: ${detail}` : ''}`);
        return { ok: false, status: res.status, data: null, error: detail || `HTTP ${res.status}` };
      }

      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = null;
        }
      }
      return { ok: true, status: res.status, data };
    } catch (e) {
      console.warn(`[CloudDB] Supabase ${method} ${path} error:`, e.message);
      return { ok: false, status: 0, data: null, error: e.message };
    }
  }

  /**
   * Fire-and-forget Firestore mirror write. firestoreService verifies every
   * response internally; here we only surface a `false` result in the log.
   */
  syncFirestore(label, run) {
    if (!this.hasFirebase) return;
    Promise.resolve()
      .then(run)
      .then((result) => {
        if (result === false) {
          console.warn(`[CloudDB] Firestore ${label} reported a failure.`);
        }
      })
      .catch((e) => {
        console.warn(`[CloudDB] Firestore ${label} error:`, e.message);
      });
  }

  async upsertRow(table, payload, selectCols = 'id') {
    return this.supabaseRequest(table, {
      method: 'POST',
      params: `select=${selectCols}`,
      body: payload,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
  }

  async patchRow(table, id, patch) {
    const res = await this.supabaseRequest(table, {
      method: 'PATCH',
      params: `id=eq.${encodeURIComponent(id)}&select=id`,
      body: patch,
      prefer: 'return=representation',
    });
    if (res.ok && Array.isArray(res.data) && res.data.length === 0) {
      console.warn(`[CloudDB] Supabase PATCH ${table}/${id} matched no rows.`);
    }
    return res;
  }

  async deleteRow(table, id) {
    const res = await this.supabaseRequest(table, {
      method: 'DELETE',
      params: `id=eq.${encodeURIComponent(id)}&select=id`,
      prefer: 'return=representation',
    });
    if (res.ok && Array.isArray(res.data) && res.data.length === 0) {
      console.warn(`[CloudDB] Supabase DELETE ${table}/${id} matched no rows.`);
    }
    return res;
  }

  // --- Files Cloud Operations ---
  async saveFile(file) {
    if (!file || !file.id) return false;

    const payload = buildFilePayload(file);
    let ok = true;

    if (this.hasSupabase) {
      const res = await this.upsertRow(TABLES.files, payload);
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore(`saveFile ${payload.id}`, () =>
        firestoreService.setDocument(FIREBASE_COLLECTIONS.files, payload.id, payload)
      );
    }

    return ok;
  }

  async deleteFile(id, permanent = false) {
    if (!id) return false;
    let ok = true;

    if (this.hasSupabase) {
      const res = permanent
        ? await this.deleteRow(TABLES.files, id)
        : await this.patchRow(TABLES.files, id, { is_trash: 1, updated_at: new Date().toISOString() });
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore(`deleteFile ${id}`, () =>
        permanent
          ? firestoreService.deleteDocument(FIREBASE_COLLECTIONS.files, id)
          : firestoreService.setDocument(FIREBASE_COLLECTIONS.files, id, {
              is_trash: 1,
              updated_at: new Date().toISOString(),
            })
      );
    }

    return ok;
  }

  // --- Folders Cloud Operations ---
  async saveFolder(folder) {
    if (!folder || !folder.id) return false;

    const payload = {
      id: folder.id,
      name: folder.name,
      parent_id: folder.parent_id ?? null,
      color: folder.color || '#3b82f6',
      icon: folder.icon || 'folder',
      is_trash: folder.is_trash ? 1 : 0,
      created_at: folder.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let ok = true;
    if (this.hasSupabase) {
      const res = await this.upsertRow(TABLES.folders, payload);
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore(`saveFolder ${payload.id}`, () =>
        firestoreService.setDocument(FIREBASE_COLLECTIONS.folders, payload.id, payload)
      );
    }

    return ok;
  }

  async deleteFolder(id, permanent = false) {
    if (!id) return false;
    let ok = true;

    if (this.hasSupabase) {
      const res = permanent
        ? await this.deleteRow(TABLES.folders, id)
        : await this.patchRow(TABLES.folders, id, { is_trash: 1, updated_at: new Date().toISOString() });
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore(`deleteFolder ${id}`, () =>
        permanent
          ? firestoreService.deleteDocument(FIREBASE_COLLECTIONS.folders, id)
          : firestoreService.setDocument(FIREBASE_COLLECTIONS.folders, id, {
              is_trash: 1,
              updated_at: new Date().toISOString(),
            })
      );
    }

    return ok;
  }

  // --- API Keys Cloud Operations ---
  /**
   * Persist an API key WITHOUT the plaintext secret.
   *
   * Only `key_hash` (SHA-256, what db.getApiKeyByKey() compares against) and a
   * masked `key_prefix` are written. Firestore additionally receives an explicit
   * `key: null` so a secret stored by an older build is overwritten; Supabase
   * omits the column (a NOT NULL constraint would reject a null).
   */
  buildApiKeyPayload(key, { forFirestore = false } = {}) {
    const payload = {
      id: key.id,
      name: key.name,
      purpose: key.purpose || 'web',
      validity: key.validity || 'never',
      expires_at: key.expires_at ?? null,
      folder_id: key.folder_id ?? null,
      key_hash: key.key_hash ?? null,
      key_prefix: maskApiKey(key),
      status: key.status || 'active',
      total_uploads: key.total_uploads || 0,
      last_used_at: key.last_used_at ?? null,
      created_at: key.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (forFirestore) {
      // Firestore has no NOT NULL constraints: null out any legacy plaintext.
      payload.key = null;
      payload.secret_key = null;
    }

    return payload;
  }

  async saveApiKey(key) {
    if (!key || !key.id) return false;

    const payload = this.buildApiKeyPayload(key);
    let ok = true;

    if (this.hasSupabase) {
      const res = await this.upsertRow(TABLES.apiKeys, payload);
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      const firestorePayload = this.buildApiKeyPayload(key, { forFirestore: true });
      this.syncFirestore(`saveApiKey ${payload.id}`, () =>
        firestoreService.setDocument(FIREBASE_COLLECTIONS.apiKeys, payload.id, firestorePayload)
      );
    }

    return ok;
  }

  /**
   * Remove an API key from the cloud so a locally deleted/revoked key cannot be
   * resurrected by the next sync.
   */
  async deleteApiKey(id) {
    if (!id) return false;
    let ok = true;

    if (this.hasSupabase) {
      const res = await this.deleteRow(TABLES.apiKeys, id);
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore(`deleteApiKey ${id}`, () =>
        firestoreService.deleteDocument(FIREBASE_COLLECTIONS.apiKeys, id)
      );
    }

    return ok;
  }

  // --- Settings Cloud Operations ---
  async saveSettings(settings) {
    if (!settings) return false;
    let ok = true;

    if (this.hasSupabase) {
      const res = await this.upsertRow(
        TABLES.settings,
        { key: 'main_settings', value: settings, updated_at: new Date().toISOString() },
        'key'
      );
      ok = ok && res.ok;
    }

    if (this.hasFirebase) {
      this.syncFirestore('saveSettings', () =>
        firestoreService.setDocument(FIREBASE_COLLECTIONS.settings, 'settings', settings)
      );
    }

    return ok;
  }

  // --- Bulk Fetch from Cloud ---
  async fetchAll() {
    let cloudFiles = null;
    let cloudFolders = null;
    let cloudKeys = null;
    let cloudSettings = null;
    let partial = false;

    // 1. Try Supabase
    if (this.hasSupabase) {
      const supabaseUrl = this.supabaseUrl;
      const headers = this.getSupabaseHeaders();
      const fetchCollection = async (path) => {
        try {
          const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
          if (!res.ok) {
            let detail = '';
            try {
              detail = (await res.text()).slice(0, 300);
            } catch (e) {}
            console.warn(`[CloudDB] Supabase GET ${path} failed (${res.status})${detail ? `: ${detail}` : ''}`);
            return null;
          }
          return await res.json();
        } catch (e) {
          console.warn(`[CloudDB] Supabase GET ${path} error:`, e.message);
          return null;
        }
      };

      const [filesData, foldersData, keysData, settingsData] = await Promise.all([
        fetchCollection(`${TABLES.files}?select=*&order=created_at.desc`),
        fetchCollection(`${TABLES.folders}?select=*&order=created_at.asc`),
        fetchCollection(`${TABLES.apiKeys}?select=*`),
        fetchCollection(`${TABLES.settings}?key=eq.main_settings&select=*`),
      ]);

      if (Array.isArray(filesData)) {
        cloudFiles = filesData;
      } else {
        partial = true;
      }

      if (Array.isArray(foldersData)) {
        cloudFolders = foldersData;
      } else {
        partial = true;
      }

      if (Array.isArray(keysData)) {
        // Keep the row as stored so legacy plaintext keys (written by older
        // builds) still authenticate, but never re-introduce the redundant
        // `secret_key` duplicate into memory.
        cloudKeys = keysData.map((k) => {
          if (!k || typeof k !== 'object') return k;
          const sanitized = { ...k };
          delete sanitized.secret_key;
          return sanitized;
        });
      } else {
        partial = true;
      }

      if (Array.isArray(settingsData) && settingsData.length > 0) {
        cloudSettings = settingsData[0].value;
      }
    }

    // 2. Try Firestore fallback if needed
    if ((!cloudFiles || !cloudFolders) && this.hasFirebase) {
      try {
        const firestoreData = await firestoreService.fetchAllData();
        if (firestoreData) {
          if (!cloudFiles) cloudFiles = firestoreData.files;
          if (!cloudFolders) cloudFolders = firestoreData.folders;
          if (!cloudKeys) {
            cloudKeys = (firestoreData.api_keys || []).map((k) => {
              if (!k || typeof k !== 'object') return k;
              const sanitized = { ...k };
              delete sanitized.secret_key;
              delete sanitized.key;
              return sanitized;
            });
          }
          if (!cloudSettings && firestoreData.settings && Object.keys(firestoreData.settings).length > 0) {
            cloudSettings = firestoreData.settings;
          }
          if (firestoreData.partial) partial = true;
        }
      } catch (e) {
        console.warn('[CloudDB] Firestore fetchAll error:', e.message);
      }
    }

    if (!cloudFiles && !cloudFolders) {
      if (partial) console.warn('[CloudDB] No cloud data could be read; keeping the local database.');
      return null;
    }

    return {
      files: cloudFiles || [],
      folders: cloudFolders || [],
      api_keys: cloudKeys || [],
      settings: cloudSettings || null,
    };
  }
}

module.exports = new CloudDbService();
module.exports.CloudDbService = CloudDbService;
module.exports.maskApiKey = maskApiKey;
module.exports.buildFilePayload = buildFilePayload;
