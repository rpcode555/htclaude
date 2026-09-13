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

  async sendPhoneCode(phoneNumber, apiId = null, apiHash = null) {
    const headers = await getAuthHeader();
    let body = {};
    if (typeof phoneNumber === 'object' && phoneNumber !== null) {
      body = phoneNumber;
    } else if (apiHash && !phoneNumber.startsWith('+') && isNaN(Number(phoneNumber)) && !isNaN(Number(phoneNumber))) {
      // backward compatibility if (apiId, apiHash, phoneNumber)
      body = { apiId: phoneNumber, apiHash, phoneNumber: apiId };
    } else {
      body = { phoneNumber, apiId, apiHash };
    }
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  },

  async verifyPhoneCode(code, password, phoneCodeHash = null, phoneNumber = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, phoneCodeHash, phoneNumber }),
    });
    return await res.json();
  },

  async connectSessionString(sessionString, apiId = null, apiHash = null) {
    const headers = await getAuthHeader();
    let body = {};
    if (typeof sessionString === 'object') {
      body = sessionString;
    } else if (sessionString && apiId && apiHash) {
      // handle both (sessionString, apiId, apiHash) and legacy (apiId, apiHash, sessionString)
      if (sessionString.length > 50) {
        body = { sessionString, apiId, apiHash };
      } else {
        body = { apiId: sessionString, apiHash: apiId, sessionString: apiHash };
      }
    } else {
      body = { sessionString, apiId, apiHash };
    }
    const res = await fetch(`${API_BASE}/auth/session-connect`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  },

  async backupDatabase() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/backup-db`, {
      method: 'POST',
      headers,
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

  async createNoteFile({ name, content, folder_id }) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/create`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, folder_id }),
    });
    return await res.json();
  },

  async updateFileContent(id, content) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/content`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return await res.json();
  },

  async getSharedFileInfo(id) {
    const res = await fetch(`${API_BASE}/v1/share/${id}`);
    return await res.json();
  },

  async uploadSingleFile(file, folder_id, onProgress) {
    let token = '';
    try {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
      } else {
        token = localStorage.getItem('admin_token') || '';
      }
    } catch (e) {
      token = localStorage.getItem('admin_token') || '';
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('files', file);
      if (folder_id) {
        formData.append('folder_id', folder_id);
      }

      xhr.timeout = 0; // 0 = No timeout for unlimited multi-GB file uploads

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
            resolve({ success: true, files: [] });
          }
        } else {
          try {
            const errJson = JSON.parse(xhr.responseText);
            reject(new Error(errJson.error || `Upload failed with status ${xhr.status}`));
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.statusText || 'Server error'}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Connection interrupted or network error during upload. Please check your connection and server status.'));
      });
      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timed out. The file might be too large or the connection is too slow.'));
      });
      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was aborted.'));
      });

      xhr.open('POST', `${API_BASE}/files/upload`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  },

  async uploadFilesWithProgress(files, folder_id, onProgress, onFileComplete) {
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;
    const allUploadedRecords = [];

    for (let i = 0; i < totalFiles; i++) {
      const currentFile = fileArray[i];
      const res = await this.uploadSingleFile(currentFile, folder_id, (fileProgress) => {
        if (onProgress) {
          const overallPercent = Math.round(((i + (fileProgress.percent / 100)) / totalFiles) * 100);
          onProgress({
            fileIndex: i,
            totalFiles,
            currentFileName: currentFile.name,
            filePercent: fileProgress.percent,
            percent: overallPercent,
          });
        }
      });

      if (res && res.files && res.files.length > 0) {
        allUploadedRecords.push(...res.files);
        if (onFileComplete) {
          onFileComplete(res.files, i);
        }
      }
    }

    return {
      success: true,
      files: allUploadedRecords,
    };
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
