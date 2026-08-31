/**
 * Firebase Firestore Cloud Database Service
 * Provides persistent cloud synchronization for Files, Folders, Settings, and API Keys
 * with local fallback support.
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'melodic-keyword-374810';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBB_iq8REPny3J2f98oRtQe-og4rUIzm9Q';

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/**
 * Convert JavaScript Object to Firestore REST Format
 */
function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      fields[k] = Number.isInteger(v) ? { integerValue: v.toString() } : { doubleValue: v };
    } else if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) => {
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number') return { integerValue: item.toString() };
            if (typeof item === 'boolean') return { booleanValue: item };
            return { stringValue: JSON.stringify(item) };
          }),
        },
      };
    } else if (typeof v === 'object') {
      fields[k] = { mapValue: toFirestore(v) };
    }
  }
  return { fields };
}

/**
 * Convert Firestore REST Document to Plain JavaScript Object
 */
function fromFirestore(doc) {
  if (!doc || !doc.fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    if ('stringValue' in v) {
      obj[k] = v.stringValue;
    } else if ('integerValue' in v) {
      obj[k] = parseInt(v.integerValue, 10);
    } else if ('doubleValue' in v) {
      obj[k] = parseFloat(v.doubleValue);
    } else if ('booleanValue' in v) {
      obj[k] = v.booleanValue;
    } else if ('nullValue' in v) {
      obj[k] = null;
    } else if ('arrayValue' in v) {
      obj[k] = (v.arrayValue?.values || []).map((val) => {
        if ('stringValue' in val) return val.stringValue;
        if ('integerValue' in val) return parseInt(val.integerValue, 10);
        if ('booleanValue' in val) return val.booleanValue;
        return val;
      });
    } else if ('mapValue' in v) {
      obj[k] = fromFirestore({ fields: v.mapValue?.fields || {} });
    }
  }
  return obj;
}

class FirestoreService {
  constructor() {
    this.projectId = PROJECT_ID;
    this.apiKey = API_KEY;
    this.enabled = !!(PROJECT_ID && API_KEY);
    this.lastSync = 0;
  }

  getHeaders(authToken) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      const token = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      headers['Authorization'] = token;
    }
    return headers;
  }

  /**
   * Fetch all documents from a Firestore collection
   */
  async getCollection(collectionName, authToken = '') {
    if (!this.enabled) return null;
    try {
      const url = `${BASE_URL}/${collectionName}?key=${this.apiKey}&pageSize=1000`;
      const res = await fetch(url, {
        headers: this.getHeaders(authToken),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      if (!data.documents || !Array.isArray(data.documents)) {
        return [];
      }

      return data.documents.map((doc) => fromFirestore(doc)).filter(Boolean);
    } catch (err) {
      console.warn(`[Firestore] Error fetching collection ${collectionName}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch a single document by ID
   */
  async getDocument(collectionName, docId, authToken = '') {
    if (!this.enabled || !docId) return null;
    try {
      const url = `${BASE_URL}/${collectionName}/${encodeURIComponent(docId)}?key=${this.apiKey}`;
      const res = await fetch(url, {
        headers: this.getHeaders(authToken),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return fromFirestore(data);
    } catch (err) {
      return null;
    }
  }

  /**
   * Set / Replace a document in Firestore
   */
  async setDocument(collectionName, docId, data, authToken = '') {
    if (!this.enabled || !docId) return false;
    try {
      const firestoreBody = toFirestore(data);
      const url = `${BASE_URL}/${collectionName}/${encodeURIComponent(docId)}?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: this.getHeaders(authToken),
        body: JSON.stringify(firestoreBody),
      });

      return res.ok;
    } catch (err) {
      console.warn(`[Firestore] Error setting document ${collectionName}/${docId}:`, err.message);
      return false;
    }
  }

  /**
   * Delete a document from Firestore
   */
  async deleteDocument(collectionName, docId, authToken = '') {
    if (!this.enabled || !docId) return false;
    try {
      const url = `${BASE_URL}/${collectionName}/${encodeURIComponent(docId)}?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(authToken),
      });

      return res.ok;
    } catch (err) {
      console.warn(`[Firestore] Error deleting document ${collectionName}/${docId}:`, err.message);
      return false;
    }
  }

  /**
   * Synchronize all collections into full memory state
   */
  async fetchAllData(authToken = '') {
    try {
      const [files, folders, settingsDoc, apiKeys] = await Promise.all([
        this.getCollection('htc_files', authToken),
        this.getCollection('htc_folders', authToken),
        this.getDocument('htc_meta', 'settings', authToken),
        this.getCollection('htc_api_keys', authToken),
      ]);

      if (files === null && folders === null) {
        return null;
      }

      return {
        files: files || [],
        folders: folders || [],
        settings: settingsDoc || {},
        api_keys: apiKeys || [],
      };
    } catch (err) {
      console.warn('[Firestore] fetchAllData failed:', err.message);
      return null;
    }
  }
}

module.exports = new FirestoreService();
