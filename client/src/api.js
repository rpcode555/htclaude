// API Service for Hightech Claude Storage with Automatic Bearer Token Authorization

import { auth } from './firebase';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

async function getAuthHeader() {
  const headers = {};
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }
  const tgSession = localStorage.getItem('htc_tg_session');
  if (tgSession) {
    headers['X-Telegram-Session'] = tgSession;
  }
  return headers;
}

async function safeJson(res) {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (!res.ok) {
        // Strip HTML tags if HTML error page was returned
        const cleanText = text.replace(/<[^>]*>?/gm, '').trim();
        return {
          success: false,
          error: `Server error (${res.status}): ${cleanText.slice(0, 150) || res.statusText || 'Internal server error'}`,
        };
      }
      return {
        success: false,
        error: text.slice(0, 150) || 'Unexpected non-JSON response from server',
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Network request failed',
    };
  }
}

export const api = {
  // --- Developer API Keys Management ---
  async getApiKeys() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys`, { headers });
    return await safeJson(res);
  },

  async getApiKeyFiles(keyId) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${keyId}/files`, { headers });
    return await safeJson(res);
  },

  async createApiKey(payload) {
    const headers = await getAuthHeader();
    const bodyData = typeof payload === 'string' ? { name: payload } : payload;
    const res = await fetch(`${API_BASE}/developer/keys`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
    });
    return await safeJson(res);
  },

  async updateApiKey(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await safeJson(res);
  },

  async deleteApiKey(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/developer/keys/${id}`, {
      method: 'DELETE',
      headers,
    });
    return await safeJson(res);
  },

  // --- Auth & Telegram Connection ---
  async getStatus() {
    const headers = await getAuthHeader();
    const tgSession = localStorage.getItem('htc_tg_session');
    const url = tgSession ? `${API_BASE}/auth/status?session=${encodeURIComponent(tgSession)}` : `${API_BASE}/auth/status`;
    const res = await fetch(url, { headers });
    const data = await safeJson(res);
    if (data?.connected && data?.sessionString) {
      localStorage.setItem('htc_tg_session', data.sessionString);
    } else if (data?.manualDisconnect) {
      localStorage.removeItem('htc_tg_session');
    }
    return data;
  },

  async sendPhoneCode(phoneNumber, apiId = null, apiHash = null) {
    const headers = await getAuthHeader();
    let body = {};
    if (typeof phoneNumber === 'object' && phoneNumber !== null) {
      body = phoneNumber;
    } else if (apiHash && !String(phoneNumber).startsWith('+') && isNaN(Number(apiId)) && !isNaN(Number(phoneNumber))) {
      // backward compatibility if (apiId, apiHash, phoneNumber)
      body = { apiId: phoneNumber, apiHash: apiId, phoneNumber: apiHash };
    } else {
      body = { phoneNumber, apiId, apiHash };
    }
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await safeJson(res);
  },

  async verifyPhoneCode(code, password, phoneCodeHash = null, phoneNumber = null, tempSession = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, phoneCodeHash, phoneNumber, tempSession }),
    });
    const data = await safeJson(res);
    if ((data.success || data.status === 'success') && data.sessionString) {
      localStorage.setItem('htc_tg_session', data.sessionString);
    }
    return data;
  },

  async getQrCode(apiId = null, apiHash = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/qr-code`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId, apiHash }),
    });
    return await safeJson(res);
  },

  async checkQrCode(tempSession, password = '', apiId = null, apiHash = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/check-qr`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempSession, password, apiId, apiHash }),
    });
    const data = await safeJson(res);
    if ((data.success || data.status === 'success') && data.sessionString) {
      localStorage.setItem('htc_tg_session', data.sessionString);
    }
    return data;
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
    const data = await safeJson(res);
    if (data.success) {
      const sess = data.sessionString || (typeof sessionString === 'string' ? sessionString : body.sessionString);
      if (sess) localStorage.setItem('htc_tg_session', sess);
    }
    return data;
  },

  async backupDatabase() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/backup-db`, {
      method: 'POST',
      headers,
    });
    return await safeJson(res);
  },

  async disconnect() {
    const headers = await getAuthHeader();
    localStorage.removeItem('htc_tg_session');
    const res = await fetch(`${API_BASE}/auth/disconnect`, {
      method: 'POST',
      headers,
    });
    return await safeJson(res);
  },

  async updateSettings(settings) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/auth/settings`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return await safeJson(res);
  },

  // --- Folders ---
  async getFolders() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders`, { headers });
    return await safeJson(res);
  },

  async createFolder(name, parent_id = null, color = '#3b82f6', icon = 'folder') {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id, color, icon }),
    });
    return await safeJson(res);
  },

  async updateFolder(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await safeJson(res);
  },

  async deleteFolder(id, permanent = false) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}?permanent=${permanent}`, {
      method: 'DELETE',
      headers,
    });
    return await safeJson(res);
  },

  async restoreFolder(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/folders/${id}/restore`, {
      method: 'POST',
      headers,
    });
    return await safeJson(res);
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
    return await safeJson(res);
  },

  async getFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, { headers });
    return await safeJson(res);
  },

  async createNoteFile({ name, content, folder_id }) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/create`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, folder_id }),
    });
    return await safeJson(res);
  },

  async updateFileContent(id, content) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/content`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return await safeJson(res);
  },

  async getSharedFileInfo(id) {
    const res = await fetch(`${API_BASE}/v1/share/${id}`);
    return await safeJson(res);
  },

  async uploadSingleFile(file, folder_id, onProgress) {
    let token = '';
    try {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
      }
    } catch (e) {
      // Token will remain empty if auth fails
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
      const tgSession = localStorage.getItem('htc_tg_session');
      if (tgSession) {
        xhr.setRequestHeader('X-Telegram-Session', tgSession);
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

  getDownloadUrl(fileId, token = null) {
    const params = new URLSearchParams();
    const tgSession = localStorage.getItem('htc_tg_session');
    if (tgSession) params.append('session', tgSession);
    if (token) params.append('token', token);
    const qs = params.toString();
    return `${API_BASE}/files/${fileId}/download${qs ? `?${qs}` : ''}`;
  },

  getStreamUrl(fileId, token = null) {
    const params = new URLSearchParams();
    const tgSession = localStorage.getItem('htc_tg_session');
    if (tgSession) params.append('session', tgSession);
    if (token) params.append('token', token);
    const qs = params.toString();
    return `${API_BASE}/files/${fileId}/stream${qs ? `?${qs}` : ''}`;
  },

  async updateFile(id, updates) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await safeJson(res);
  },

  async trashFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/trash`, {
      method: 'DELETE',
      headers,
    });
    return await safeJson(res);
  },

  async restoreFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}/restore`, {
      method: 'POST',
      headers,
    });
    return await safeJson(res);
  },

  async deleteFile(id) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/${id}`, {
      method: 'DELETE',
      headers,
    });
    return await safeJson(res);
  },

  async emptyTrash() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/trash/empty`, {
      method: 'DELETE',
      headers,
    });
    return await safeJson(res);
  },

  async batchAction(action, fileIds, targetFolderId = null) {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/files/batch`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, fileIds, targetFolderId }),
    });
    return await safeJson(res);
  },

  // --- Stats ---
  async getStats() {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE}/stats`, { headers });
    return await safeJson(res);
  },
};
