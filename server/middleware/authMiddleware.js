// Security Middleware: fail-closed Firebase ID token verification.
//
// The installed `firebase` package is the client SDK and does not export a
// server-side ID-token verifier. `firebase-admin` is not installed either, so
// this module uses Google's securetoken JWKS endpoint and Node's RSA verifier
// directly. A token is never trusted based on its decoded claims alone.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const serverEnvPath = path.join(__dirname, '../.env');
const rootEnvPath = path.join(__dirname, '../../.env');
if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const DEFAULT_ADMIN_EMAIL = 'palranjan144@gmail.com';
const DEFAULT_PROJECT_ID = 'melodic-keyword-374810';
const GOOGLE_SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const MAX_CACHE_ENTRIES = 500;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 32 * 1024;
const MAX_SESSION_LENGTH = 16 * 1024;
const CLOCK_SKEW_SECONDS = 0;

// In-memory bounded LRU-style cache for cryptographically verified tokens.
const tokenCache = new Map();

// Google rotates signing keys. Cache only keys obtained from the JWKS endpoint.
let jwksCache = {
  keys: new Map(),
  fetchedAt: 0,
};
let jwksRefreshPromise = null;

function getProjectId() {
  return String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
}

function getAuthorizedAdminEmails() {
  // An explicitly configured whitelist replaces the built-in fallback. This
  // prevents a deployment that intentionally changes ADMIN_EMAIL from silently
  // retaining the development address as an administrator.
  const configured = String(process.env.ADMIN_EMAIL || '').trim();
  const source = configured || DEFAULT_ADMIN_EMAIL;
  return [...new Set(
    source
      .split(',')
      .map((email) => email.trim().replace(/['"]/g, '').toLowerCase())
      .filter(Boolean)
  )];
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isEmailAuthorized(email) {
  const normalized = normalizeEmail(email);
  return !!normalized && getAuthorizedAdminEmails().includes(normalized);
}

function getExpectedIssuer(projectId) {
  return `https://securetoken.google.com/${projectId}`;
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, 'base64url');
    // Buffer.from() is permissive. Re-encoding rejects alternate/padded forms
    // and makes the JWT parsing rules explicit.
    if (decoded.length === 0 || decoded.toString('base64url') !== value) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

function parseJwt(idToken) {
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const headerBytes = decodeBase64Url(parts[0]);
  const payloadBytes = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (!headerBytes || !payloadBytes || !signature) return null;

  try {
    const header = JSON.parse(headerBytes.toString('utf8'));
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return { parts, header, payload, signature };
  } catch (_) {
    return null;
  }
}

function validateClaims(payload, projectId, now = Date.now()) {
  const nowSeconds = now / 1000;
  const expectedIssuer = getExpectedIssuer(projectId);

  // These checks are intentionally strict. In particular, an absent issuer,
  // audience, expiry, or email_verified claim is not treated as valid.
  if (payload.iss !== expectedIssuer) return null;
  if (payload.aud !== projectId) return null;

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= nowSeconds - CLOCK_SKEW_SECONDS) return null;

  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) return null;
    if (payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  }

  if (payload.iat !== undefined) {
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return null;
    // Reject obviously future-issued claims while allowing normal clock skew.
    if (payload.iat > nowSeconds + 60 + CLOCK_SKEW_SECONDS) return null;
  }

  // Firebase ID tokens always carry a non-empty `sub`. Do not fall back to
  // phone-oriented identity claims for administrator authentication.
  const uid = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!uid) return null;

  const email = normalizeEmail(payload.email);
  if (!email || payload.email_verified !== true) return null;
  if (!isEmailAuthorized(email)) return null;

  return { uid, email };
}

function jwkToPublicKey(jwk) {
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'RSA') return null;
  if (typeof jwk.kid !== 'string' || !jwk.kid) return null;
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
  if (!/^[A-Za-z0-9_-]+$/.test(jwk.n) || !/^[A-Za-z0-9_-]+$/.test(jwk.e)) return null;
  if (jwk.alg && jwk.alg !== 'RS256') return null;
  if (jwk.use && jwk.use !== 'sig') return null;
  if (jwk.key_ops !== undefined) {
    if (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')) return null;
  }

  try {
    const key = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });
    return key.asymmetricKeyType === 'rsa' ? key : null;
  } catch (_) {
    return null;
  }
}

async function fetchJwks() {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Firebase JWKS fetching is unavailable in this runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    response = await globalThis.fetch(GOOGLE_SECURETOKEN_JWKS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response || response.ok === false || (typeof response.status === 'number' && (response.status < 200 || response.status >= 300))) {
    throw new Error('Firebase JWKS endpoint returned an unsuccessful response');
  }

  const body = await response.json();
  if (!body || !Array.isArray(body.keys)) {
    throw new Error('Firebase JWKS response did not contain a keys array');
  }

  const nextKeys = new Map();
  const duplicateKids = new Set();
  for (const jwk of body.keys) {
    const publicKey = jwkToPublicKey(jwk);
    if (!publicKey) continue;

    const kid = jwk.kid;
    if (duplicateKids.has(kid)) {
      nextKeys.delete(kid);
      continue;
    }
    if (nextKeys.has(kid)) {
      nextKeys.delete(kid);
      duplicateKids.add(kid);
      continue;
    }
    nextKeys.set(kid, publicKey);
  }

  if (nextKeys.size === 0) {
    throw new Error('Firebase JWKS response contained no usable RS256 keys');
  }

  jwksCache = { keys: nextKeys, fetchedAt: Date.now() };
}

async function refreshJwks() {
  if (!jwksRefreshPromise) {
    jwksRefreshPromise = fetchJwks().finally(() => {
      jwksRefreshPromise = null;
    });
  }
  return jwksRefreshPromise;
}

async function getSigningKey(kid) {
  const now = Date.now();
  let key = jwksCache.keys.get(kid);
  const cacheIsFresh = now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS;

  if (key && cacheIsFresh) return key;

  // Refresh for an unknown kid as well as an expired cache. This handles
  // Google key rotation without ever falling back to an unverified key.
  try {
    await refreshJwks();
  } catch (error) {
    // Never use a stale key after the cache has expired or when the requested
    // kid is unknown. Verification must fail closed if JWKS is unavailable.
    if (key && cacheIsFresh) return key;
    throw error;
  }

  key = jwksCache.keys.get(kid);
  return key || null;
}

function verifySignature(parsedToken, publicKey) {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parsedToken.parts[0]}.${parsedToken.parts[1]}`);
    verifier.end();
    return verifier.verify(publicKey, parsedToken.signature);
  } catch (_) {
    return false;
  }
}

function pruneTokenCache() {
  const now = Date.now();
  for (const [token, data] of tokenCache.entries()) {
    if (!data || data.expiry <= now) tokenCache.delete(token);
  }

  while (tokenCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value;
    if (!oldestKey) break;
    tokenCache.delete(oldestKey);
  }
}

function getCachedUser(idToken, projectId) {
  const cached = tokenCache.get(idToken);
  if (!cached) return null;

  if (
    cached.expiry <= Date.now() ||
    cached.projectId !== projectId ||
    cached.issuer !== getExpectedIssuer(projectId) ||
    cached.audience !== projectId ||
    cached.emailVerified !== true ||
    !isEmailAuthorized(cached.email)
  ) {
    tokenCache.delete(idToken);
    return null;
  }

  return cached;
}

async function verifyAdminToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) return null;

  const cached = getCachedUser(idToken, projectId);
  if (cached) return cached;

  const parsed = parseJwt(idToken);
  if (!parsed) return null;

  // Firebase ID tokens are RS256 JWTs. Reject every other algorithm,
  // including `none`, before doing any key lookup.
  if (parsed.header.alg !== 'RS256' || typeof parsed.header.kid !== 'string' || !parsed.header.kid) {
    return null;
  }

  const identity = validateClaims(parsed.payload, projectId);
  if (!identity) return null;

  try {
    const publicKey = await getSigningKey(parsed.header.kid);
    if (!publicKey || !verifySignature(parsed, publicKey)) return null;
  } catch (error) {
    // A JWKS/network failure is an authentication failure, never a reason to
    // accept a token based on its decoded contents.
    console.warn('[Security] Firebase signature verification unavailable:', error.message);
    return null;
  }

  const user = {
    uid: identity.uid,
    email: identity.email,
    emailVerified: true,
    projectId,
    issuer: getExpectedIssuer(projectId),
    audience: projectId,
    expiry: parsed.payload.exp * 1000,
    authMethod: 'firebase',
  };

  pruneTokenCache();
  tokenCache.set(idToken, user);
  return user;
}

function getHeaderString(req, name) {
  const value = req?.headers?.[name.toLowerCase()];
  if (value === undefined) return { present: false, value: null, valid: true };
  if (typeof value !== 'string') return { present: true, value: null, valid: false };
  return { present: true, value, valid: true };
}

function getQueryString(req, name) {
  const query = req?.query;
  if (!query || !Object.prototype.hasOwnProperty.call(query, name)) {
    return { present: false, value: null, valid: true };
  }
  const value = query[name];
  if (typeof value !== 'string') return { present: true, value: null, valid: false };
  return { present: true, value, valid: true };
}

function getBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization;
  if (header === undefined) return null;
  if (typeof header !== 'string') return null;

  const match = header.match(/^Bearer[ \t]+([^\s]+)$/i);
  return match ? match[1] : null;
}

function getSessionInputs(req) {
  const header = getHeaderString(req, 'x-telegram-session');
  const query = getQueryString(req, 'session');
  const values = [];

  if (header.present) {
    if (!header.valid || header.value.length > MAX_SESSION_LENGTH) return { valid: false, values };
    values.push(header.value);
  }
  if (query.present) {
    if (!query.valid || query.value.length > MAX_SESSION_LENGTH) return { valid: false, values };
    values.push(query.value);
  }

  return { valid: true, values };
}

function clearRequestCredentials(req) {
  // A Firebase token in a query string is not accepted by this middleware. It
  // is also removed before a controller can accidentally consume it.
  if (req?.query && Object.prototype.hasOwnProperty.call(req.query, 'token')) {
    delete req.query.token;
  }

  try {
    if (req?.headers) delete req.headers['x-telegram-session'];
  } catch (_) {
    // Some test/integration request objects expose immutable headers. The
    // untrusted value is still ignored by this middleware in that case.
  }
  try {
    if (req?.query && Object.prototype.hasOwnProperty.call(req.query, 'session')) {
      delete req.query.session;
    }
  } catch (_) {
    // See the header note above.
  }
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;

  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  // Hashing first gives timingSafeEqual equal-sized inputs even when the
  // candidate length differs, without making the stored session a length-
  // based credential.
  const leftDigest = crypto.createHash('sha256').update(leftBuffer).digest();
  const rightDigest = crypto.createHash('sha256').update(rightBuffer).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && leftBuffer.length === rightBuffer.length;
}

async function getServerActiveSession() {
  const { getSetting } = require('../db');
  const stored = await getSetting('session_string');
  if (typeof stored !== 'string') return '';
  const session = stored.trim();
  if (!session || session.length > MAX_SESSION_LENGTH) return '';
  return session;
}

async function bindAuthorizedSessionInputs(req, activeSession) {
  const inputs = getSessionInputs(req);

  if (!activeSession || !inputs.valid || inputs.values.length === 0 || inputs.values.some((value) => !constantTimeEqual(value.trim(), activeSession))) {
    clearRequestCredentials(req);
    return false;
  }

  // Only the server-stored value is propagated to downstream Telegram code.
  // This prevents an authenticated request from selecting an arbitrary
  // session for a controller call.
  req.telegramSession = activeSession;
  try {
    req.headers['x-telegram-session'] = activeSession;
  } catch (_) {
    // Ignore immutable request headers; downstream code can use the server
    // setting and the route is still authorized.
  }
  try {
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'session')) {
      req.query.session = activeSession;
    }
  } catch (_) {
    // Ignore immutable query objects.
  }
  delete req.query?.token;
  return true;
}

function isLegacyMediaPath(req) {
  const requestPath = typeof req?.path === 'string' ? req.path : '';
  return (
    /^\/files\/upload-progress\/[^/]+$/.test(requestPath) ||
    isSharedMediaPath(req)
  );
}

function isSharedMediaPath(req) {
  const requestPath = typeof req?.path === 'string' ? req.path : '';
  return /^\/files\/[^/]+\/(?:download|stream)$/.test(requestPath);
}

async function isPubliclySharedFile(req) {
  const fileId = typeof req?.params?.id === 'string' ? req.params.id : '';
  if (!fileId || !isSharedMediaPath(req)) return false;

  const { db } = require('../db');
  const file = await db.getFileById(fileId);
  return !!file && !file.is_trash && (file.is_shared === 1 || file.is_shared === true);
}

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Firebase authentication is required.',
  });
}

function forbidden(res) {
  return res.status(403).json({
    success: false,
    error: 'Forbidden: Access Denied. Invalid token or account not authorized.',
  });
}

async function requireAdminAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const authorizationHeader = req?.headers?.authorization ?? req?.headers?.Authorization;
  const hasAuthorizationHeader = authorizationHeader !== undefined;
  const bearerToken = getBearerToken(req);
  let verifiedUser = null;

  if (bearerToken) {
    try {
      verifiedUser = await verifyAdminToken(bearerToken);
    } catch (error) {
      // verifyAdminToken is fail-closed, but keep the middleware boundary
      // defensive if its implementation or a test double throws.
      console.error('[Security Middleware] Token verification error:', error.message);
      return res.status(503).json({
        success: false,
        error: 'Authentication service temporarily unavailable.',
      });
    }

    if (!verifiedUser) return forbidden(res);

    // A valid Firebase token is sufficient. Any Telegram session supplied by
    // the client is still bound to the server-stored session before it can be
    // consumed by a controller.
    try {
      const activeSession = getSessionInputs(req).values.length ? await getServerActiveSession() : '';
      await bindAuthorizedSessionInputs(req, activeSession);
    } catch (error) {
      console.warn('[Security] Could not bind Telegram session:', error.message);
      clearRequestCredentials(req);
    }

    req.user = verifiedUser;
    return next();
  }

  // Explicitly shared files remain readable by their public share links. This
  // is a narrow data check, not a general bypass: private files still require
  // Firebase (or the exact active Telegram session below).
  if (!hasAuthorizationHeader && isSharedMediaPath(req)) {
    try {
      if (await isPubliclySharedFile(req)) {
        // Do not let a legacy query token/session reach the streaming
        // controller; the public-share decision above is sufficient.
        clearRequestCredentials(req);
        req.user = {
          uid: 'public-share',
          email: null,
          emailVerified: false,
          isAdmin: false,
          authMethod: 'public-share',
        };
        return next();
      }
    } catch (error) {
      console.warn('[Security] Shared-file authorization lookup failed:', error.message);
    }
  }

  // A legacy media-only compatibility path may use the already active
  // Telegram session. It is deliberately unavailable for administrative
  // routes, and it is accepted only after a constant-time comparison with the
  // server-stored value. If an Authorization header was supplied but is
  // malformed, fail closed instead of silently switching credentials.
  if (!hasAuthorizationHeader && isLegacyMediaPath(req)) {
    try {
      const inputs = getSessionInputs(req);
      if (inputs.valid && inputs.values.length > 0) {
        const activeSession = await getServerActiveSession();
        if (activeSession && inputs.values.every((value) => constantTimeEqual(value.trim(), activeSession))) {
          await bindAuthorizedSessionInputs(req, activeSession);
          req.user = {
            uid: 'active-telegram-session',
            email: null,
            emailVerified: false,
            isAdmin: true,
            authMethod: 'active-telegram-session',
          };
          return next();
        }
      }
    } catch (error) {
      console.warn('[Security] Legacy session verification error:', error.message);
    }
  }

  return unauthorized(res);
}

function clearAuthCaches() {
  tokenCache.clear();
  jwksCache = { keys: new Map(), fetchedAt: 0 };
  jwksRefreshPromise = null;
}

module.exports = {
  requireAdminAuth,
  verifyAdminToken,
  // Exported for deterministic operational tests and key-rotation diagnostics.
  clearAuthCaches,
  getAuthorizedAdminEmails,
  getTargetAdminEmail: () => getAuthorizedAdminEmails()[0] || DEFAULT_ADMIN_EMAIL,
};
