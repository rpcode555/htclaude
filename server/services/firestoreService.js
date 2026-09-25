/**
 * Firebase Firestore Cloud Database Service
 * Provides persistent cloud synchronization for Files, Folders, Settings, and API Keys
 * with local fallback support.
 *
 * Authentication model (important):
 *  Firestore's REST API does NOT authorize document access with a Web API key -
 *  it requires an OAuth2 access token (or rules that explicitly allow public
 *  access). A Web API key alone therefore silently produced 401/403 responses
 *  that were swallowed as "no data". This service now:
 *    1. loads the project credentials lazily (so a dotenv load that happens
 *       after this module is required is still honoured);
 *    2. uses FIREBASE_OAUTH_ACCESS_TOKEN / FIRESTORE_ACCESS_TOKEN when provided;
 *    3. otherwise exchanges FIREBASE_REFRESH_TOKEN (or an anonymous Identity
 *       Toolkit sign-in performed with the existing project API key) for a short
 *       lived OAuth2 access token, cached until shortly before it expires;
 *    4. inspects EVERY response and logs the real status/body on failure.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_PROJECT_ID = 'melodic-keyword-374810';
const DEFAULT_FIREBASE_API_KEY = 'AIzaSyBB_iq8REPny3J2f98oRtQe-og4rUIzm9Q';

const IDENTITY_TOOLKIT_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const MAX_COLLECTION_PAGES = 5;
const MAX_COLLECTION_PAGE_SIZE = 1000;
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;
const AUTH_BACKOFF_MS = 5 * 60 * 1000;

let serviceAccountCache;

/**
 * Load the Firebase service account from FIREBASE_SERVICE_ACCOUNT (raw JSON) or
 * from the GOOGLE_APPLICATION_CREDENTIALS file. Returns null when neither is
 * configured.
 */
function getServiceAccount() {
  if (serviceAccountCache !== undefined) return serviceAccountCache;

  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    try {
      serviceAccountCache = JSON.parse(raw);
    } catch (e) {
      console.warn('[Firestore] FIREBASE_SERVICE_ACCOUNT is not valid JSON:', e.message);
      serviceAccountCache = null;
    }
    return serviceAccountCache;
  }

  const filePath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        serviceAccountCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } else {
        console.warn(`[Firestore] GOOGLE_APPLICATION_CREDENTIALS file not found: ${filePath}`);
        serviceAccountCache = null;
      }
    } catch (e) {
      console.warn('[Firestore] Could not read the service account file:', e.message);
      serviceAccountCache = null;
    }
  }

  if (serviceAccountCache === undefined) serviceAccountCache = null;
  return serviceAccountCache;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let dotenvLoaded = false;

/**
 * Best-effort dotenv load. Other modules (authMiddleware) do the same; loading
 * twice is harmless because dotenv does not override existing values.
 */
function ensureDotenvLoaded() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    const dotenv = require('dotenv');
    const candidates = [
      path.join(__dirname, '../.env'),
      path.join(__dirname, '../../.env'),
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        return;
      }
    }
    dotenv.config();
  } catch (e) {
    // dotenv is optional - environment variables may already be provided.
  }
}

/**
 * Resolve the Firebase configuration on every call instead of freezing it at
 * require() time (the app loads .env lazily, so a frozen snapshot was often
 * empty and silently disabled the whole cloud layer).
 */
function getConfig() {
  ensureDotenvLoaded();
  return {
    projectId: (process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    apiKey: (process.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY).trim(),
    oauthAccessToken: (process.env.FIREBASE_OAUTH_ACCESS_TOKEN || process.env.FIRESTORE_ACCESS_TOKEN || '').trim(),
    refreshToken: (process.env.FIREBASE_REFRESH_TOKEN || '').trim(),
  };
}

function getBaseUrl(config = getConfig()) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
}

/**
 * Convert JavaScript Object to Firestore REST Format
 */
function toFirestore(obj) {
  const fields = {};
  if (!obj || typeof obj !== 'object') return { fields };

  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue; // untouched fields must not enter the update mask

    if (v === null) {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      fields[k] = Number.isFinite(v)
        ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: String(v) })
        : { nullValue: null };
    } else if (typeof v === 'bigint') {
      fields[k] = { integerValue: v.toString() };
    } else if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (v instanceof Date) {
      fields[k] = { timestampValue: v.toISOString() };
    } else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) => toFirestoreValue(item)),
        },
      };
    } else if (typeof v === 'object') {
      fields[k] = { mapValue: toFirestore(v) };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  return { fields };
}

/**
 * Convert a single JavaScript value to a Firestore REST `Value`
 */
function toFirestoreValue(item) {
  if (item === undefined) return { nullValue: null };
  if (item === null) return { nullValue: null };
  if (typeof item === 'boolean') return { booleanValue: item };
  if (typeof item === 'number') {
    return Number.isFinite(item)
      ? (Number.isInteger(item) ? { integerValue: String(item) } : { doubleValue: String(item) })
      : { nullValue: null };
  }
  if (typeof item === 'bigint') return { integerValue: item.toString() };
  if (typeof item === 'string') return { stringValue: item };
  if (item instanceof Date) return { timestampValue: item.toISOString() };
  if (Array.isArray(item)) return { arrayValue: { values: item.map((i) => toFirestoreValue(i)) } };
  if (typeof item === 'object') return { mapValue: toFirestore(item) };
  return { stringValue: String(item) };
}

/**
 * Convert a single Firestore REST `Value` to a plain JavaScript value
 */
function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const parsed = parseInt(value.integerValue, 10);
    return Number.isNaN(parsed) ? value.integerValue : parsed;
  }
  if ('doubleValue' in value) {
    const parsed = parseFloat(value.doubleValue);
    return Number.isNaN(parsed) ? value.doubleValue : parsed;
  }
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map((val) => fromFirestoreValue(val));
  }
  if ('mapValue' in value) {
    return fromFirestore({ fields: value.mapValue?.fields || {} });
  }
  return null;
}

/**
 * Convert Firestore REST Document to Plain JavaScript Object
 */
function fromFirestore(doc) {
  if (!doc || !doc.fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

class FirestoreRequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'FirestoreRequestError';
    this.status = status;
    this.body = body;
  }
}

async function readErrorBody(res) {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      return (parsed?.error?.message || JSON.stringify(parsed)).slice(0, 300);
    } catch (e) {
      return text.slice(0, 300);
    }
  } catch (e) {
    return '';
  }
}

/**
 * Parse a JSON body without relying on `res.json()` (not every fetch polyfill in
 * a serverless runtime implements it).
 */
async function readJsonBody(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

class FirestoreService {
  constructor() {
    this.lastSync = 0;
    this._warnedMissingAuth = false;
    this._warnedAuthRejected = false;
    // Cooldown after Firestore answered 401/403 for the credentials in use.
    this._authBlockedUntil = 0;
    // Negative cache so a misconfigured project is not re-authenticated on
    // every single request (an anonymous sign-in creates a new user each time).
    this._authFailureAt = 0;
    this._cachedRefreshToken = process.env.FIREBASE_REFRESH_TOKEN || null;
    // Cached OAuth2 access token: { token, expiresAt }
    this._accessToken = null;
    // Cached Identity Toolkit refresh token (anonymous sign-in), survives restarts of a warm lambda.
    this._refreshToken = this._cachedRefreshToken;
    this._tokenPromise = null;
  }

  getConfig() {
    return getConfig();
  }

  isEnabled() {
    const { projectId, apiKey } = getConfig();
    return !!(projectId && apiKey);
  }

  /**
   * Build request headers. `authToken` (optional) always wins so callers can
   * pass a service-account / custom token.
   */
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
   * Obtain an OAuth2 access token usable by the Firestore REST API.
   * Returns null when the project cannot be authenticated (the caller then
   * reports a clear configuration error instead of pretending it succeeded).
   */
  async getAccessToken(authToken = '') {
    if (authToken) return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;

    const config = getConfig();
    if (config.oauthAccessToken) return config.oauthAccessToken;

    const now = Date.now();
    if (this._accessToken && this._accessToken.expiresAt - TOKEN_EXPIRY_SAFETY_MS > now) {
      return this._accessToken.token;
    }

    // Authentication is known to be broken: back off instead of hammering the
    // Identity Toolkit (and creating a new anonymous user) on every request.
    if (!config.refreshToken && !this._refreshToken && now < this._authFailureAt) {
      return null;
    }

    // Single-flight: concurrent requests must not trigger parallel sign-ins.
    if (this._tokenPromise) {
      try {
        return await this._tokenPromise;
      } catch (e) {
        /* fall through and retry below */
      }
    }

    this._tokenPromise = (async () => {
      // 1. A service account (private key) is the standard server side way to
      //    get an OAuth2 access token for Firestore.
      const serviceAccount = getServiceAccount();
      if (serviceAccount) {
        const token = await this.fetchServiceAccountToken(serviceAccount);
        if (token) return token;
      }

      const refreshToken = config.refreshToken || this._refreshToken;
      if (refreshToken) {
        const exchanged = await this.exchangeRefreshToken(refreshToken, config);
        if (exchanged) return exchanged;
      }

      // No refresh token: sign in anonymously through the Identity Toolkit
      // using the project's existing Web API key, then exchange the resulting
      // ID token credentials for a real OAuth2 access token.
      const anonymous = await this.signInAnonymously(config);
      if (anonymous && anonymous.refreshToken) {
        this._refreshToken = anonymous.refreshToken;
        const exchanged = await this.exchangeRefreshToken(anonymous.refreshToken, config);
        if (exchanged) return exchanged;
        // Fall back to the identity token when the exchange is unavailable.
        return anonymous.idToken;
      }
      return null;
    })();

    try {
      const token = await this._tokenPromise;
      if (!token) {
        this._authFailureAt = Date.now() + 5 * 60 * 1000;
        if (!this._warnedMissingAuth) {
          this._warnedMissingAuth = true;
          console.warn(
            '[Firestore] No usable credentials: cloud sync for Firestore is disabled. ' +
              'Configure FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS), FIREBASE_REFRESH_TOKEN ' +
              'or FIREBASE_OAUTH_ACCESS_TOKEN, or enable the Firebase Anonymous auth provider.'
          );
        }
      } else {
        this._warnedMissingAuth = false;
        this._authFailureAt = 0;
      }
      return token;
    } finally {
      this._tokenPromise = null;
    }
  }

  async exchangeRefreshToken(refreshToken, config) {
    try {
      const res = await fetch(`${SECURE_TOKEN_URL}?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!res.ok) {
        const body = await readErrorBody(res);
        console.warn(
          `[Firestore] Refresh token exchange rejected (${res.status}${body ? `: ${body}` : ''}). ` +
            'Set FIREBASE_REFRESH_TOKEN or FIREBASE_OAUTH_ACCESS_TOKEN for authenticated cloud sync.'
        );
        return null;
      }

      const data = await readJsonBody(res);
      if (!data?.access_token) {
        console.warn('[Firestore] Refresh token exchange returned no access_token.');
        return null;
      }

      const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
      this._accessToken = { token: data.access_token, expiresAt: Date.now() + expiresInMs };
      return data.access_token;
    } catch (err) {
      console.warn('[Firestore] Refresh token exchange failed:', err.message);
      return null;
    }
  }

  async signInAnonymously(config) {
    try {
      const res = await fetch(`${IDENTITY_TOOLKIT_URL}?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }),
      });

      if (!res.ok) {
        const body = await readErrorBody(res);
        console.warn(
          `[Firestore] Anonymous sign-in failed (${res.status}${body ? `: ${body}` : ''}). ` +
            'Enable the Anonymous provider in Firebase Authentication or provide FIREBASE_REFRESH_TOKEN.'
        );
        return null;
      }

      const data = await readJsonBody(res);
      if (!data?.idToken) {
        console.warn('[Firestore] Anonymous sign-in returned no idToken.');
        return null;
      }
      return { idToken: data.idToken, refreshToken: data.refreshToken || null };
    } catch (err) {
      console.warn('[Firestore] Anonymous sign-in error:', err.message);
      return null;
    }
  }

  /**
   * Sign a JWT with the service account private key and exchange it for an
   * OAuth2 access token (the credential type Firestore REST actually accepts).
   */
  async fetchServiceAccountToken(serviceAccount) {
    try {
      const clientEmail = serviceAccount.client_email;
      const privateKey = String(serviceAccount.private_key || '').replace(/\\n/g, '\n');
      if (!clientEmail || !privateKey) {
        console.warn('[Firestore] Service account is missing client_email/private_key.');
        return null;
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64url(
        JSON.stringify({
          iss: clientEmail,
          scope: FIRESTORE_SCOPE,
          aud: GOOGLE_TOKEN_URL,
          iat: issuedAt,
          exp: issuedAt + 3600,
        })
      );
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      const assertion = `${header}.${claims}.${base64url(signer.sign(privateKey))}`;

      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: GOOGLE_JWT_BEARER_GRANT,
          assertion,
        }).toString(),
      });

      if (!res.ok) {
        const body = await readErrorBody(res);
        console.warn(`[Firestore] Service account token exchange failed (${res.status}${body ? `: ${body}` : ''}).`);
        return null;
      }

      const data = await readJsonBody(res);
      if (!data?.access_token) {
        console.warn('[Firestore] Service account token exchange returned no access_token.');
        return null;
      }

      const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
      this._accessToken = { token: data.access_token, expiresAt: Date.now() + expiresInMs };
      return data.access_token;
    } catch (err) {
      console.warn('[Firestore] Service account authentication error:', err.message);
      return null;
    }
  }

  /**
   * Requests are pointless while the stored credentials are rejected. Cooldown
   * after an auth error instead of failing 4 requests on every sync.
   */
  isAuthBlocked() {
    return Date.now() < this._authBlockedUntil;
  }

  blockAuthTemporarily() {
    this._authBlockedUntil = Date.now() + AUTH_BACKOFF_MS;
  }

  noteAuthError(err) {
    if (err instanceof FirestoreRequestError && (err.status === 401 || err.status === 403)) {
      this.blockAuthTemporarily();
      if (!this._warnedAuthRejected) {
        this._warnedAuthRejected = true;
        console.warn(
          `[Firestore] Firestore rejected the stored credentials (${err.status}: ${err.body || 'no detail'}). ` +
            'Cloud sync is paused for 5 minutes - configure a service account (FIREBASE_SERVICE_ACCOUNT / ' +
            'GOOGLE_APPLICATION_CREDENTIALS) and grant the service account the "Cloud Datastore User" role.'
        );
      }
    }
  }

  buildUrl(pathSuffix, config) {
    return `${getBaseUrl(config)}/${pathSuffix}${config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : ''}`;
  }

  /**
   * Perform a request and throw a descriptive error for any non-2xx response.
   * Every response is inspected - failures are never silently swallowed.
   */
  async request(pathSuffix, { method = 'GET', body, authToken = '', config = getConfig(), allow404 = false } = {}) {
    const url = this.buildUrl(pathSuffix, config);
    const token = await this.getAccessToken(authToken);
    const headers = this.getHeaders(token);

    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

    if (!res.ok) {
      if (allow404 && res.status === 404) return null;
      const errorBody = await readErrorBody(res);
      throw new FirestoreRequestError(
        `Firestore ${method} ${pathSuffix} failed with ${res.status}${errorBody ? `: ${errorBody}` : ''}`,
        res.status,
        errorBody
      );
    }

    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new FirestoreRequestError(`Firestore ${method} ${pathSuffix} returned a non-JSON body`, res.status, text.slice(0, 300));
    }
  }

  /**
   * Fetch all documents from a Firestore collection (paginated, bounded).
   */
  async getCollection(collectionName, authToken = '') {
    if (!this.isEnabled()) return null;
    if (this.isAuthBlocked()) return null;
    const config = getConfig();
    const results = [];

    try {
      let pageToken = null;
      for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
        const query = `?pageSize=${MAX_COLLECTION_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const url = `${getBaseUrl(config)}/${collectionName}${query}${
          config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : ''
        }`;

        const res = await fetch(url, { headers: this.getHeaders(await this.getAccessToken(authToken)) });
        if (!res.ok) {
          const errorBody = await readErrorBody(res);
          throw new FirestoreRequestError(
            `Firestore GET ${collectionName} failed with ${res.status}${errorBody ? `: ${errorBody}` : ''}`,
            res.status,
            errorBody
          );
        }

        const data = await readJsonBody(res);
        if (!data || !data.documents || !Array.isArray(data.documents)) break;
        results.push(...data.documents.map((doc) => fromFirestore(doc)).filter(Boolean));

        pageToken = data.nextPageToken || null;
        if (!pageToken) break;
      }

      if (pageToken) {
        console.warn(
          `[Firestore] Collection ${collectionName} truncated at ${results.length} documents (${MAX_COLLECTION_PAGES} pages).`
        );
      }

      return results;
    } catch (err) {
      this.noteAuthError(err);
      console.warn(`[Firestore] Error fetching collection ${collectionName}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch a single document by ID
   */
  async getDocument(collectionName, docId, authToken = '') {
    if (!this.isEnabled() || !docId) return null;
    if (this.isAuthBlocked()) return null;
    try {
      const data = await this.request(`${collectionName}/${encodeURIComponent(docId)}`, { authToken, allow404: true });
      if (!data) return null;
      return fromFirestore(data);
    } catch (err) {
      this.noteAuthError(err);
      console.warn(`[Firestore] Error fetching document ${collectionName}/${docId}:`, err.message);
      return null;
    }
  }

  /**
   * Create or update a document in Firestore.
   *
   * Firestore REST semantics: PATCH only updates an existing document (a missing
   * one answers 404), and without an update mask the request is a full replace -
   * which would wipe every field that was not part of the payload. We therefore
   * PATCH with an explicit mask and fall back to POST (create) on 404.
   */
  async setDocument(collectionName, docId, data, authToken = '') {
    if (!this.isEnabled() || !docId) return false;
    if (this.isAuthBlocked()) return false;
    const config = getConfig();
    const documentPath = `${collectionName}/${encodeURIComponent(docId)}`;

    try {
      const firestoreBody = toFirestore(data || {});
      const fieldPaths = Object.keys(firestoreBody.fields || {});

      if (fieldPaths.length === 0) return true; // nothing to write

      // NOTE: no allow404 here - a 404 must surface as a typed error so the
      // create-on-missing path below can run.
      await this.request(`${documentPath}?updateMask.fieldPaths=${encodeURIComponent(fieldPaths.join(','))}`, {
        method: 'PATCH',
        body: firestoreBody,
        authToken,
        config,
      });
      return true;
    } catch (err) {
      if (err instanceof FirestoreRequestError && err.status === 404) {
        // Document does not exist yet -> create it.
        try {
          await this.request(documentPath, {
            method: 'POST',
            body: toFirestore(data || {}),
            authToken,
            config,
          });
          return true;
        } catch (createErr) {
          if (createErr instanceof FirestoreRequestError && createErr.status === 409) {
            // Created concurrently by another process - treat as success.
            return true;
          }
          console.warn(`[Firestore] Error creating document ${collectionName}/${docId}:`, createErr.message);
          return false;
        }
      }
      this.noteAuthError(err);
      console.warn(`[Firestore] Error setting document ${collectionName}/${docId}:`, err.message);
      return false;
    }
  }

  /**
   * Delete a document from Firestore
   */
  async deleteDocument(collectionName, docId, authToken = '') {
    if (!this.isEnabled() || !docId) return false;
    if (this.isAuthBlocked()) return false;
    try {
      await this.request(`${collectionName}/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
        authToken,
        allow404: true,
      });
      return true;
    } catch (err) {
      this.noteAuthError(err);
      console.warn(`[Firestore] Error deleting document ${collectionName}/${docId}:`, err.message);
      return false;
    }
  }

  /**
   * Synchronize all collections into full memory state.
   * Returns null only when *nothing* could be read; partial results are returned
   * together with a `partial` flag so callers can tell the difference.
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
        partial: files === null || folders === null,
      };
    } catch (err) {
      console.warn('[Firestore] fetchAllData failed:', err.message);
      return null;
    }
  }
}

const instance = new FirestoreService();
module.exports = instance;
module.exports.FirestoreService = FirestoreService;
module.exports.toFirestore = toFirestore;
module.exports.fromFirestore = fromFirestore;
module.exports.ensureDotenvLoaded = ensureDotenvLoaded;
