// API Service for Hightech Claude Storage with Automatic Bearer Token Authorization

import { auth } from './firebase';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

async function getAuthHeader() {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export const api = {
  // --- Developer API Keys Management ---
  async getApiKeys() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys`, { headers });
    return await res.json();
  },

  async getApiKeyFiles(keyId) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${keyId}/files`, { headers });
    return await res.json();
  },

  async createApiKey(payload) {
    const headers = await getAuthHeader();
    const bodyData = typeof payload === 'string' ? { name: payload } : payload;
    const res = await fetch(`${API_BASE}/developer/keys`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
    });
    return await res.json();
  },

  async updateApiKey(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await res.json();
  },

  async deleteApiKey(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${id}`, {
      method: 'DELETE',
      headers,
    });
    return await res.json();
  },

  // --- Auth & Telegram Connection ---
  async getStatus() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/status`, { headers });
    return await res.json();
  },

  async sendPhoneCode(apiId, apiHash, phoneNumber) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId, apiHash, phoneNumber }),
    });
    return await res.json();
  },

  async verifyPhoneCode(code, password) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password }),
    });
    return await res.json();
  },

  async connectBot(botToken, chatId) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/bot-connect`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId }),
    });
    return await res.json();
  },

  async disconnect() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/disconnect`, {
      method: 'POST',
      headers,
    });
    return await res.json();
  },

  async updateSettings(settings) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/settings`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return await res.json();
  },

  // --- Folders ---
  async getFolders() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders`, { headers });
    return await res.json();
  },

  async createFolder(name, parent_id = null, color = '#3b82f6', icon = 'folder') {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id, color, icon }),
    });
    return await res.json();
  },

  async updateFolder(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await res.json();
  },

  async deleteFolder(id, permanent = false) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}?permanent=${permanent}`, {
      method: 'DELETE',
      headers,
    });
    return await res.json();
  },

  async restoreFolder(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}/restore`, {
      method: 'POST',
      headers,
    });
    return await res.json();
  },

  // --- Files ---
  async getFiles({ folder_id, category, filter, search, sortBy, sortOrder } = {}) {
    const headers = await getAuthHeader();
    const params = new URLSearchParams();
    if (folder_id !== undefined && folder_id !== null) params.append('folder_id', folder_id);
    if (category) params.append('category', category);
    if (filter) params.append('filter', filter);
    if (search) params.append('search', search);
    if (sortBy) params.append('sortBy', sortBy);
    if (sortOrder) params.append('sortOrder', sortOrder);

    const res = await fetch(`${API_BASE}/files?${params.toString()}`, { headers });
    return await res.json();
  },

  async getFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, { headers });
    return await res.json();
  },

  async uploadFilesWithProgress(files, folder_id, onProgress) {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      if (folder_id) {
        formData.append('folder_id', folder_id);
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percent: Math.round(percentComplete),
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve({ success: true });
          }
        } else {
          try {
            const errJson = JSON.parse(xhr.responseText);
            reject(new Error(errJson.error || 'Upload failed'));
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during file upload')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.open('POST', `${API_BASE}/files/upload`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  },

  getDownloadUrl(fileId) {
    return `${API_BASE}/files/${fileId}/download`;
  },

  getStreamUrl(fileId) {
    return `${API_BASE}/files/${fileId}/stream`;
  },

  async updateFile(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await res.json();
  },

  async trashFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/trash`, {
      method: 'DELETE',
      headers,
    });
    return await res.json();
  },

  async restoreFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/restore`, {
      method: 'POST',
      headers,
    });
    return await res.json();
  },

  async deleteFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, {
      method: 'DELETE',
      headers,
    });
    return await res.json();
  },

  async emptyTrash() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/trash/empty`, {
      method: 'DELETE',
      headers,
    });
    return await res.json();
  },

  async batchAction(action, fileIds, targetFolderId = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/batch`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, fileIds, targetFolderId }),
    });
    return await res.json();
  },

  // --- Stats ---
  async getStats() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/stats`, { headers });
    return await res.json();
  },
};
