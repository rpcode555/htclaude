// Middleware to validate Developer API Keys (htc_live_...) for universal external integrations
//
// Supported (and ONLY supported) credential channels - secrets are never read
// from the query string or the request body, because URLs end up in access logs,
// browser history, proxy logs and Referer headers:
//   1. X-API-Key: htc_live_...            (primary, documented flow)
//   2. X-API-Token: htc_live_...          (alias kept for existing integrations)
//   3. Authorization: Bearer htc_live_... (only when the token has the key prefix)
//
// A key posted as a form field (e.g. by an HTML <form>) or as ?api_key= is
// rejected with an explicit error instead of being silently accepted.

const crypto = require('crypto');
const { db } = require('../db');

const KEY_PREFIX = 'htc_live_';
const MAX_KEY_LENGTH = 512;
const REVOKED_STATUSES = ['revoked', 'inactive', 'disabled', 'deleted', 'suspended'];

/**
 * Never log the secret itself - only a short, non-reversible fingerprint.
 */
function keyFingerprint(rawKey) {
  const digest = crypto.createHash('sha256').update(String(rawKey)).digest('hex').slice(0, 10);
  return `${String(rawKey).slice(0, 12)}…${String(rawKey).slice(-4)} (sha256:${digest})`;
}

/**
 * Extract the raw key from request headers only.
 */
function extractRawKey(req) {
  const headerKey = req.headers['x-api-key'] || req.headers['x-api-token'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return { key: headerKey.trim(), source: 'header' };
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) return { key: token, source: 'bearer' };
  }

  return { key: null, source: null };
}

/**
 * Detect a secret that was sent through an unsafe channel so the developer gets
 * an actionable error instead of a generic "missing key".
 */
function detectUnsafeCredentialLocation(req) {
  const query = req.query || {};
  if (query.api_key || query.apiKey || query.key || query.token) {
    return 'query parameter (?api_key= / ?token=)';
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const body = req.body;
    if (body && typeof body === 'object' && (body.api_key || body.apiKey || body.api_token)) {
      return 'request body (form field "api_key")';
    }
  }

  return null;
}

function unauthorized(res, message, extra = {}) {
  return res.status(401).json({
    success: false,
    error: message,
    documentation: 'https://github.com/hightech-claude/api-docs',
    ...extra,
  });
}

// Short-lived negative cache: a rejected key must not trigger a disk reload plus
// a cloud sync on every single attempt (cheap unauthenticated DoS amplifier).
const REJECTED_KEY_TTL_MS = 30 * 1000;
const REJECTED_KEY_MAX = 500;
const rejectedKeys = new Map();

function fingerprintOf(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey)).digest('hex');
}

function isRecentlyRejected(rawKey) {
  const now = Date.now();
  if (rejectedKeys.size >= REJECTED_KEY_MAX) {
    for (const [key, expiry] of rejectedKeys) {
      if (expiry <= now) rejectedKeys.delete(key);
    }
    while (rejectedKeys.size >= REJECTED_KEY_MAX) {
      const oldest = rejectedKeys.keys().next().value;
      if (oldest === undefined) break;
      rejectedKeys.delete(oldest);
    }
  }
  const expiry = rejectedKeys.get(fingerprintOf(rawKey));
  return typeof expiry === 'number' && expiry > now;
}

function rememberRejected(rawKey) {
  rejectedKeys.set(fingerprintOf(rawKey), Date.now() + REJECTED_KEY_TTL_MS);
}

async function requireApiKey(req, res, next) {
  try {
    // CORS preflight must never require credentials.
    if (req.method === 'OPTIONS') return next();

    const { key: rawKey, source } = extractRawKey(req);

    if (!rawKey) {
      const unsafeLocation = detectUnsafeCredentialLocation(req);
      if (unsafeLocation) {
        return unauthorized(
          res,
          `Unauthorized: API keys must not be sent via ${unsafeLocation}. Send it in the "X-API-Key" header instead.`
        );
      }
      return unauthorized(res, 'Unauthorized: Missing API Key. Provide "X-API-Key: htc_live_..." header.');
    }

    if (rawKey.length > MAX_KEY_LENGTH) {
      return unauthorized(res, 'Unauthorized: Invalid API Key.');
    }

    if (isRecentlyRejected(rawKey)) {
      return unauthorized(res, 'Unauthorized: Invalid API Key.');
    }

    const apiKeyRecord = await db.getApiKeyByKey(rawKey);

    if (!apiKeyRecord) {
      rememberRejected(rawKey);
      console.warn(`[API Key] Rejected unknown key from ${source}: ${keyFingerprint(rawKey)}`);
      return unauthorized(res, 'Unauthorized: Invalid API Key.');
    }

    // Records created before status tracking existed have no status field and
    // are treated as active; anything explicitly non-active is rejected.
    const status = String(apiKeyRecord.status || 'active').toLowerCase();
    if (status !== 'active') {
      if (!REVOKED_STATUSES.includes(status)) {
        console.warn(`[API Key] Unknown status "${status}" for key ${apiKeyRecord.id} - treating as revoked.`);
      }
      return res.status(403).json({
        success: false,
        error: 'Forbidden: This API Key has been revoked or deactivated.',
      });
    }

    // Check expiration date (an unparsable value is logged, never silently
    // treated as "not expired" without a trace).
    if (apiKeyRecord.expires_at) {
      const expiry = new Date(apiKeyRecord.expires_at).getTime();
      if (Number.isFinite(expiry)) {
        if (expiry < Date.now()) {
          return res.status(403).json({
            success: false,
            error: `Forbidden: This API Key expired on ${new Date(expiry).toISOString().slice(0, 10)}. Please generate a new key.`,
          });
        }
      } else {
        console.warn(`[API Key] Key ${apiKeyRecord.id} has an unparsable expires_at value; expiry check skipped.`);
      }
    }

    // Attach API key record to request
    req.apiKey = apiKeyRecord;
    req.apiKeyId = apiKeyRecord.id;
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch (err) {
    console.error('[API Key Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Internal API Key verification failure.' });
  }
}

module.exports = { requireApiKey, extractRawKey, keyFingerprint, KEY_PREFIX };
