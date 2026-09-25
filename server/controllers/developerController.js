const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory, getSetting } = require('../db');
const telegramService = require('../services/telegramService');
const uploadTracker = require('../services/uploadTracker');
const cloudDbService = require('../services/cloudDbService');

const { isSafePath, isInsideRoot, TMP_ROOT, isServerless } = require('../config/paths');
const { verifyAdminToken } = require('../middleware/authMiddleware');
const { extractRawKey, KEY_PREFIX } = require('../middleware/apiKeyMiddleware');

const MAX_FILE_NAME_LENGTH = 200;
const MAX_SNIFF_BYTES = 512;
const XSS_CSP_HEADER =
  "sandbox allow-scripts allow-forms; default-src 'self' data:; style-src 'self' 'unsafe-inline'";
const EXECUTABLE_MIME_TYPES = ['text/html', 'application/xhtml+xml', 'image/svg+xml'];

// ---------------------------------------------------------------------------
// Naming / escaping helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(name) {
  if (!name) return 'unnamed_file_' + Date.now();
  const cleaned = String(name)
    // Control characters (header/JSON/log injection) and path separators
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\?<>\\:\*\|":]/g, '_')
    .replace(/\.\.+/g, '_')
    // Leading dots would create hidden files / "." and ".." style names
    .replace(/^\.+/, '')
    .trim();
  if (!cleaned) return 'unnamed_file_' + Date.now();
  return cleaned.length > MAX_FILE_NAME_LENGTH
    ? `${cleaned.slice(0, MAX_FILE_NAME_LENGTH - 20)}-${Date.now()}`
    : cleaned;
}

function escapeHtmlAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a header-safe Content-Disposition value (RFC 5987 + ASCII fallback).
 * Prevents response header injection through a stored file name.
 */
function contentDispositionFor(fileName) {
  const raw = String(fileName || 'download').replace(/[\u0000-\u001f\u007f"\\]/g, '_');
  const asciiFallback = raw.replace(/[^\x20-\x7e]/g, '_').slice(0, 120) || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

function getBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  if (process.env.CUSTOM_DOMAIN) {
    const domain = process.env.CUSTOM_DOMAIN.replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000');
  // Only trust a syntactically valid host so a spoofed Host header cannot be
  // reflected into the URLs handed back to the API consumer.
  const host = /^[\w.\-:[\]]+$/.test(rawHost.split(',')[0].trim()) ? rawHost.split(',')[0].trim() : 'localhost:5000';
  const safeProtocol = String(protocol).split(',')[0].trim() === 'https' ? 'https' : String(protocol).split(',')[0].trim();
  return `${safeProtocol}://${host}`;
}

// ---------------------------------------------------------------------------
// Content validation (magic bytes)
// ---------------------------------------------------------------------------

/** Signatures that must never be accepted, whatever the file name claims. */
function matchExecutableSignature(buf) {
  const latin = buf.toString('latin1');
  const be32 = buf.length >= 4 ? buf.readUInt32BE(0) : 0;

  if (buf[0] === 0x4d && buf[1] === 0x5a) return 'Windows/DOS executable (MZ)';
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'ELF executable';
  if (buf[0] === 0x23 && buf[1] === 0x21) return 'script with a #! shebang';
  if (latin.slice(0, 5).toLowerCase() === '<?php') return 'PHP script';
  if (be32 === 0xcafebabe) return 'Java class / Mach-O fat binary';
  if ([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(be32)) return 'Mach-O binary';
  if (latin.slice(0, 4) === 'dex\n') return 'Android DEX';
  if (latin.slice(0, 4) === '\u0000asm') return 'WebAssembly module';
  if (latin.slice(0, 4) === 'SCR\u0000' || latin.slice(0, 2) === 'MZ') return 'executable';
  return null;
}

function isProbablyText(buf) {
  let suspicious = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious++;
  }
  return suspicious / Math.max(1, buf.length) < 0.1;
}

/** Identify the real content type from the leading bytes. */
function sniffContentKind(buf) {
  if (!buf || buf.length === 0) return 'empty';

  const latin = buf.toString('latin1');
  const lower = latin.toLowerCase();

  if (buf[0] === 0x89 && lower.slice(1, 4) === 'png') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (lower.startsWith('gif87a') || lower.startsWith('gif89a')) return 'gif';
  if (latin.slice(0, 4) === 'RIFF' && latin.length >= 12) {
    const fourcc = latin.slice(8, 12);
    if (fourcc === 'WEBP') return 'webp';
    if (fourcc === 'WAVE') return 'wav';
    if (fourcc === 'AVI ') return 'avi';
    return 'riff';
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d && buf.length > 6) return 'bmp';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico';
  if (lower.startsWith('ii*\u0000') || lower.startsWith('mm\u0000*')) return 'tiff';
  if (latin.startsWith('%PDF-')) return 'pdf';
  if (latin.startsWith('PK\u0003\u0004') || latin.startsWith('PK\u0005\u0006') || latin.startsWith('PK\u0007\u0008')) return 'zip';
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  if (latin.startsWith('7z\u00bc\u00af\u0027\u001c')) return 'archive-7z';
  if (latin.startsWith('Rar!\u001a\u0007')) return 'rar';
  if (latin.startsWith('OggS')) return 'ogg';
  if (latin.startsWith('fLaC')) return 'flac';
  if (latin.startsWith('ID3')) return 'mp3';
  if (buf.length >= 12 && latin.slice(4, 8) === 'ftyp') return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'matroska';
  if (latin.startsWith('FLV')) return 'flv';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0xba) return 'mpeg-ps';
  if (latin.startsWith('SQLite format 3\u0000')) return 'sqlite';

  const text = buf.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (text.startsWith('<?xml')) return /<svg[\s>]/i.test(text) ? 'svg' : 'xml';
  if (text.startsWith('<svg') || text.startsWith('<!doctype svg')) return 'svg';
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<head') || text.startsWith('<body')) {
    return 'html';
  }
  if (isProbablyText(buf)) return 'text';
  return 'unknown';
}

const CONTENT_KIND_FAMILY = {
  png: 'image',
  jpg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  tiff: 'image',
  svg: 'image',
  mp4: 'video',
  avi: 'video',
  matroska: 'video',
  flv: 'video',
  'mpeg-ps': 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  pdf: 'document',
  zip: 'archive',
  gzip: 'archive',
  rar: 'archive',
  'archive-7z': 'archive',
  sqlite: 'archive',
  html: 'text',
  xml: 'text',
  text: 'text',
  json: 'text',
};

const CONTENT_KIND_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  matroska: 'video/x-matroska',
  flv: 'video/x-flv',
  'mpeg-ps': 'video/mpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gzip: 'application/gzip',
  rar: 'application/vnd.rar',
  'archive-7z': 'application/x-7z-compressed',
  sqlite: 'application/vnd.sqlite3',
  html: 'text/html',
  xml: 'application/xml',
  text: 'text/plain',
  json: 'application/json',
};

const EXTENSION_FAMILY = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image',
  '.bmp': 'image', '.ico': 'image', '.tif': 'image', '.tiff': 'image', '.avif': 'image',
  '.heic': 'image', '.svg': 'image',
  '.mp4': 'video', '.m4v': 'video', '.mov': 'video', '.webm': 'video', '.mkv': 'video',
  '.avi': 'video', '.flv': 'video', '.mpg': 'video', '.mpeg': 'video', '.3gp': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio',
  '.aac': 'audio', '.wma': 'audio', '.opus': 'audio',
  '.pdf': 'document',
  '.txt': 'text', '.json': 'text', '.csv': 'text', '.md': 'text', '.html': 'text', '.htm': 'text', '.xml': 'text',
  '.zip': 'archive', '.gz': 'archive', '.tar': 'archive', '.rar': 'archive', '.7z': 'archive',
};

const MIME_FAMILY_RULES = [
  [/^image\//, 'image'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/^text\/(html|plain|markdown|csv)/, 'text'],
  [/^text\//, 'text'],
  [/(^|\+)json$/, 'text'],
  [/(^|\+)xml$/, 'text'],
  [/^application\/(pdf|msword|rtf)$/, 'document'],
  [/^application\/vnd\.(ms-|openxmlformats|oasis|ms-word)/, 'document'],
  [/^application\/(zip|x-zip-compressed|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar)$/, 'archive'],
];

function familyFromMimeType(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!clean || clean === 'application/octet-stream' || clean === 'binary/octet-stream') return null;
  for (const [pattern, family] of MIME_FAMILY_RULES) {
    if (pattern.test(clean)) return family;
  }
  return null;
}

function hasActiveScriptPayload(buf) {
  const text = buf.toString('utf8');
  return /<\s*script/i.test(text) || /javascript:/i.test(text) || /\son(?:load|click|error|mouseover)\s*=/i.test(text);
}

/**
 * Validate the *bytes* of an uploaded file BEFORE anything is stored or sent to
 * Telegram. Returns { valid, reason?, kind? }.
 */
function validateUploadContent({ filePath, originalName, declaredMime, size }) {
  if (!filePath) {
    return { valid: false, reason: 'Uploaded file is missing its temporary location.' };
  }

  let fd = null;
  let head = null;
  let byteSize = 0;
  try {
    fd = fs.openSync(filePath, 'r');
    byteSize = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(MAX_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, MAX_SNIFF_BYTES, 0);
    head = buffer.subarray(0, bytesRead);
  } catch (e) {
    return { valid: false, reason: `Uploaded file could not be read for validation (${e.message}).` };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (e) {}
    }
  }

  if (!byteSize || head.length === 0) {
    return { valid: false, reason: 'The uploaded file is empty.' };
  }

  // 1. Executable payloads are rejected no matter how they are named.
  const executable = matchExecutableSignature(head);
  if (executable) {
    return { valid: false, reason: `Executable content detected (${executable}); it cannot be stored as "${originalName}".` };
  }

  const kind = sniffContentKind(head);
  const kindFamily = CONTENT_KIND_FAMILY[kind] || null;
  const extFamily = EXTENSION_FAMILY[path.extname(String(originalName || '')).toLowerCase()] || null;
  const mimeFamily = familyFromMimeType(declaredMime);

  // 2. Active content inside an SVG would execute on the public delivery origin.
  if (kind === 'svg' && hasActiveScriptPayload(head)) {
    return { valid: false, reason: 'SVG uploads containing scripts or event handlers are not allowed.' };
  }

  // 3. HTML masquerading as an image (classic stored-XSS polyglot).
  if (kind === 'html' && (extFamily === 'image' || mimeFamily === 'image')) {
    return { valid: false, reason: `HTML content cannot be uploaded as an image ("${originalName}").` };
  }

  // 4. A media file extension / declared type must not hide a different known
  //    content type (e.g. an archive or document named ".png").
  if (kindFamily && kindFamily !== 'unknown') {
    const extConflict = (extFamily === 'image' || extFamily === 'video' || extFamily === 'audio') && kindFamily !== extFamily;
    const mimeConflict = mimeFamily && (mimeFamily === 'image' || mimeFamily === 'video' || mimeFamily === 'audio') && kindFamily !== mimeFamily;
    if (extConflict || mimeConflict) {
      return {
        valid: false,
        reason: `Content mismatch: the bytes look like "${kind}" but the file is declared as "${
          originalName || declaredMime || 'unknown'
        }".`,
      };
    }
  }

  return { valid: true, kind, size: byteSize };
}

/**
 * Pick the stored mime type: trust the sniffed type over a missing/generic
 * client declaration, and keep a specific client declaration otherwise.
 */
function resolveMimeType(declaredMime, originalName, kind) {
  const clean = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  const isGeneric = !clean || clean === 'application/octet-stream' || clean === 'binary/octet-stream';
  if (isGeneric) {
    return CONTENT_KIND_MIME[kind] || mime.lookup(originalName) || 'application/octet-stream';
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Storage availability helpers
// ---------------------------------------------------------------------------

class StorageUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageUnavailableError';
    this.statusCode = 503;
  }
}

const STORAGE_UNAVAILABLE_PATTERNS = [
  /telegram client is not connected/i,
  /not connected/i,
  /connect your telegram/i,
  /AUTH_KEY_UNREGISTERED/i,
  /AUTH_KEY_INVALID/i,
  /SESSION_REVOKED/i,
  /USER_DEACTIVATED/i,
  /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|fetch failed|network ?error|fetching files failed/i,
  /no space left on device|read-only file system|EACCES|EPERM/i,
  /S3|NoSuchBucket|AccessDenied|storage|bucket/i,
  /429|Too Many Requests|rate ?limit/i,
];

/**
 * Delivery failures additionally include the storage layer's catch-all
 * "could not be downloaded" error: the record exists, so failing to read it is a
 * backend problem (retryable), not a missing file.
 */
const DELIVERY_UNAVAILABLE_PATTERNS = [
  ...STORAGE_UNAVAILABLE_PATTERNS,
  /could not be downloaded/i,
  /local cache/i,
  /no local copy/i,
];

/**
 * Translate a low level failure into an HTTP status. Storage/connectivity
 * problems must surface as 503 (retryable), never as a fake success.
 */
function classifyUploadError(err) {
  const message = String((err && err.message) || err || '');
  if (err && err.statusCode === 503) return 503;
  if (STORAGE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message))) return 503;
  if (err && typeof err.statusCode === 'number') return err.statusCode;
  return 500;
}

/**
 * A result is only "durable" when the bytes are retrievable later:
 * a Telegram message id, or a real local file inside a persistent storage root.
 * On serverless runtimes every writable directory is an ephemeral temp folder,
 * so a local-only copy is explicitly NOT durable there.
 */
function isDurableStorageResult(uploadResult) {
  if (!uploadResult) return false;
  if (uploadResult.telegramMsgId !== undefined && uploadResult.telegramMsgId !== null) return true;

  const storageType = uploadResult.storageType || uploadResult.storage_type;
  const localPath = uploadResult.localPath || uploadResult.local_path;
  if (!localPath) return false;
  if (storageType && storageType !== 'local') return false;
  try {
    if (!isSafePath(localPath) || !fs.existsSync(localPath)) return false;
    if (isServerless && isInsideRoot(TMP_ROOT, localPath)) {
      // The file only lives in the instance temp folder: it disappears when the
      // invocation ends, so reporting success would be a lie.
      return false;
    }
    return fs.statSync(localPath).size > 0;
  } catch (e) {
    return false;
  }
}

async function checkStorageAvailability() {
  if (telegramService.client) return { ok: true };

  const manualDisconnect = (await getSetting('manual_disconnect')) === true;
  const session = String((await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
  if (manualDisconnect || !session) {
    return {
      ok: false,
      reason: manualDisconnect
        ? 'Cloud storage is disconnected. Telegram was manually disconnected, so uploads cannot be stored right now.'
        : 'Cloud storage is not connected. Connect your Telegram account before uploading through the Developer API.',
    };
  }
  // A session exists: the client is created on demand by the upload itself.
  return { ok: true };
}

function cleanupTempFile(file) {
  try {
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (e) {
    console.warn(`[DeveloperController] Failed to remove temp file ${file && file.path}: ${e.message}`);
  }
}

function cleanupTempFiles(files) {
  for (const file of files || []) cleanupTempFile(file);
}

// ---------------------------------------------------------------------------
// Access control for the public delivery endpoints
// ---------------------------------------------------------------------------

/**
 * Resolve access for /api/v1/raw|download/:id.
 *
 * Header flow (never the query string):
 *   Authorization: Bearer <Firebase ID token>  -> admin
 *   X-Admin-Token: <Firebase ID token>         -> admin (explicit alternative)
 *   X-API-Key / Authorization: Bearer htc_live_... -> the uploading API key
 */
async function resolveFileAccess(req, file) {
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '');
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.substring(7).trim() : null;
  const explicitAdminToken = req.headers['x-admin-token'] ? String(req.headers['x-admin-token']).trim() : null;
  const queryToken = req.query && req.query.token ? String(req.query.token) : null;

  if (queryToken) {
    return {
      authorized: false,
      reason:
        'Query-string tokens are not accepted because they leak into logs and browser history. ' +
        'Send it as "Authorization: Bearer <token>" instead.',
    };
  }

  // A real admin (Firebase ID token) takes precedence over a developer key so a
  // request that carries both headers is not accidentally downgraded.
  const adminToken = (bearerToken && !bearerToken.startsWith(KEY_PREFIX) ? bearerToken : null) || explicitAdminToken;
  if (adminToken) {
    if (adminToken.startsWith(KEY_PREFIX)) {
      return { authorized: false, reason: 'Invalid authentication token.' };
    }
    const verified = await verifyAdminToken(adminToken);
    if (verified) return { authorized: true, via: 'admin' };
    return { authorized: false, reason: 'Invalid or expired authentication token.' };
  }

  const developerKey = extractRawKey(req);
  if (developerKey.key) {
    if (!developerKey.key.startsWith(KEY_PREFIX)) {
      return { authorized: false, reason: 'Invalid API Key format.' };
    }
    const apiKeyRecord = await db.getApiKeyByKey(developerKey.key);
    if (!apiKeyRecord) return { authorized: false, reason: 'Invalid API Key.' };
    if (String(apiKeyRecord.status || 'active').toLowerCase() !== 'active') {
      return { authorized: false, authenticated: true, reason: 'This API Key has been revoked.' };
    }
    if (apiKeyRecord.expires_at) {
      const expiry = new Date(apiKeyRecord.expires_at).getTime();
      if (Number.isFinite(expiry) && expiry < Date.now()) {
        return { authorized: false, authenticated: true, reason: 'This API Key has expired.' };
      }
    }
    if (file.api_key_id && String(file.api_key_id) === String(apiKeyRecord.id)) {
      return { authorized: true, via: 'api-key' };
    }
    return { authorized: false, authenticated: true, reason: 'This API Key is not allowed to access that file.' };
  }

  return { authorized: false, reason: 'Authentication required.' };
}

/**
 * Turn a failed access check into the right status code:
 * 401 when no valid credential was presented, 403 when a valid credential lacks
 * permission for this file.
 */
function respondAccessDenied(res, access) {
  if (access.reason && access.reason !== 'Authentication required.') {
    if (access.authenticated) {
      return res.status(403).json({ success: false, error: `Forbidden: ${access.reason}` });
    }
    return res.status(401).json({ success: false, error: `Unauthorized: ${access.reason}` });
  }
  return res.status(403).json({ success: false, error: 'Unauthorized: Private file is not shared.' });
}

/**
 * Parse a single-range `Range: bytes=a-b` header.
 * -> { start, end } | { unsatisfiable: true } | { invalid: true } | null (no range)
 */
function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return { invalid: true }; // multi-range or malformed -> ignore per RFC 7233

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { invalid: true };

  let start;
  let end;
  if (rawStart === '') {
    const suffixLength = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? fileSize - 1 : parseInt(rawEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { invalid: true };
    end = Math.min(end, fileSize - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || start > end) {
    return { unsatisfiable: true };
  }
  return { start, end };
}

function weakETag(file) {
  const updated = file.updated_at || file.created_at || 0;
  const stamp = Number.isFinite(new Date(updated).getTime()) ? new Date(updated).getTime() : 0;
  return `W/"${file.id}-${stamp}"`;
}

function applyDeliveryHeaders(res, file, { isExecutableMime, isPublicAsset }) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
  // Only genuinely public assets may be stored by a shared/CDN cache; anything
  // served to an authenticated admin must stay private.
  res.setHeader(
    'Cache-Control',
    isPublicAsset ? 'public, max-age=86400, must-revalidate' : 'private, no-store, max-age=0'
  );
  res.setHeader('ETag', weakETag(file));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (isExecutableMime) res.setHeader('Content-Security-Policy', XSS_CSP_HEADER);
}

/**
 * Stream a file payload with correct range / conditional-request handling.
 */
function sendFilePayload(req, res, file, streamData, { download = false, isPublicAsset = false } = {}) {
  const isExecutableMime = EXECUTABLE_MIME_TYPES.includes(String(file.mime_type || '').toLowerCase());
  applyDeliveryHeaders(res, file, { isExecutableMime, isPublicAsset });

  const mimeType = file.mime_type || streamData.mimeType || 'application/octet-stream';
  const totalSize = Number(streamData.size) || 0;

  // Conditional request: a client holding the current copy gets 304 instead of
  // re-downloading the whole body.
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && String(ifNoneMatch).split(',').some((tag) => tag.trim() === weakETag(file))) {
    return res.status(304).end();
  }

  if (download) {
    res.setHeader('Content-Disposition', contentDispositionFor(file.original_name || file.name));
  }
  res.setHeader('Content-Type', mimeType);
  if (totalSize > 0) res.setHeader('Content-Length', String(totalSize));

  // Range requests are only possible when the bytes are on local disk.
  const localPath = streamData.localPath;
  let localFileSize = 0;
  if (localPath && isSafePath(localPath) && fs.existsSync(localPath)) {
    try {
      localFileSize = fs.statSync(localPath).size;
    } catch (e) {
      localFileSize = 0;
    }
  }
  const canServeRanges = !download && localFileSize > 0;

  // Only advertise range support when a range can actually be honoured.
  res.setHeader('Accept-Ranges', canServeRanges ? 'bytes' : 'none');

  if (canServeRanges) {
    const range = parseRangeHeader(req.headers.range, localFileSize);

    if (range && range.unsatisfiable) {
      res.removeHeader('Content-Length');
      res.setHeader('Content-Range', `bytes */${localFileSize}`);
      return res.status(416).end();
    }

    if (range && Number.isFinite(range.start)) {
      const headers = {
        'Content-Range': `bytes ${range.start}-${range.end}/${localFileSize}`,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Type': mimeType,
        'Cache-Control': res.getHeader('Cache-Control') || 'private, no-store, max-age=0',
        ETag: weakETag(file),
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      if (isExecutableMime) headers['Content-Security-Policy'] = XSS_CSP_HEADER;

      res.writeHead(206, headers);
      const readStream = fs.createReadStream(localPath, { start: range.start, end: range.end });
      pipeStreamSafely(readStream, res);
      return;
    }
  }

  if (streamData.type === 'stream' && streamData.stream) {
    pipeStreamSafely(streamData.stream, res);
    return;
  }
  if (streamData.type === 'buffer' && streamData.buffer) {
    return res.send(streamData.buffer);
  }

  return res.status(404).json({ success: false, error: 'File content is no longer available.' });
}

function pipeStreamSafely(stream, res) {
  stream.on('error', (err) => {
    console.error('[DeveloperController] Stream error:', err.message);
    if (res.headersSent) {
      res.destroy(err);
    } else {
      res.status(500).json({ success: false, error: 'The file stream failed.' });
    }
  });
  res.on('close', () => {
    if (!res.writableFinished) {
      try {
        stream.destroy();
      } catch (e) {}
    }
  });
  stream.pipe(res);
}

// --- API Key Management (Admin Protected) ---
exports.getApiKeys = async (req, res) => {
  try {
    const keys = await db.getApiKeys();
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createApiKey = async (req, res) => {
  try {
    const { name, purpose, validity } = req.body || {};
    const cleanName = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';

    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'API Key name is required.' });
    }
    if (cleanName.length > 120) {
      return res.status(400).json({ success: false, error: 'API Key name must be 120 characters or fewer.' });
    }

    const allowedPurposes = ['web', 'mobile', 'backend', 'desktop', 'other', 'general'];
    const allowedValidity = ['never', '30d', '90d', '180d', '365d'];
    if (purpose !== undefined && !allowedPurposes.includes(purpose)) {
      return res.status(400).json({ success: false, error: `Invalid purpose. Use one of: ${allowedPurposes.join(', ')}.` });
    }
    if (validity !== undefined && !allowedValidity.includes(validity)) {
      return res.status(400).json({ success: false, error: `Invalid validity. Use one of: ${allowedValidity.join(', ')}.` });
    }

    const newKey = await db.createApiKey({
      name: cleanName,
      purpose: purpose || 'web',
      validity: validity || 'never',
    });

    if (!newKey || !newKey.key) {
      console.error('[DeveloperController] createApiKey returned no secret.');
      return res.status(500).json({ success: false, error: 'API Key could not be generated.' });
    }

    res.status(201).json({
      success: true,
      message: 'API Key generated successfully. Store it now - the cloud copy only keeps a hash.',
      key: newKey,
      notice: 'Send the key in the "X-API-Key" header. Query-string and form-field credentials are rejected.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getApiKeyFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = await db.getApiKeyById(id);
    if (!apiKey) {
      return res.status(404).json({ success: false, error: 'API Key not found.' });
    }

    const files = (await db.getFilesByApiKeyId(id)) || [];
    const totalSize = files.reduce((acc, f) => acc + (Number(f.size) || 0), 0);

    const categories = {
      images: files.filter((f) => f.category === 'images'),
      videos: files.filter((f) => f.category === 'videos'),
      audio: files.filter((f) => f.category === 'audio'),
      documents: files.filter((f) => f.category === 'documents'),
      archives: files.filter((f) => f.category === 'archives'),
      others: files.filter((f) => !['images', 'videos', 'audio', 'documents', 'archives'].includes(f.category)),
    };

    res.json({
      success: true,
      apiKey,
      totalFiles: files.length,
      totalSize,
      categoriesCount: {
        images: categories.images.length,
        videos: categories.videos.length,
        audio: categories.audio.length,
        documents: categories.documents.length,
        archives: categories.archives.length,
        others: categories.others.length,
      },
      files,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body || {};
    const updates = {};

    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
      if (!cleanName) {
        return res.status(400).json({ success: false, error: 'API Key name cannot be empty.' });
      }
      if (cleanName.length > 120) {
        return res.status(400).json({ success: false, error: 'API Key name must be 120 characters or fewer.' });
      }
      updates.name = cleanName;
    }

    if (status !== undefined) {
      if (typeof status !== 'string' || !['active', 'revoked'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be either "active" or "revoked".' });
      }
      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields provided to update.' });
    }

    const existing = await db.getApiKeyById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'API Key not found.' });
    }

    const updated = await db.updateApiKey(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API Key not found.' });
    }

    // Push the change to the cloud as well: db.updateApiKey() only writes the
    // local JSON, so a revoked key would otherwise be resurrected as "active"
    // by the next cloud sync.
    cloudDbService
      .saveApiKey(updated)
      .catch((e) => console.warn('[DeveloperController] Cloud sync of API key update failed:', e.message));

    // If API key is renamed, sync the corresponding folder name
    if (updates.name && updated.folder_id) {
      await db.updateFolder(updated.folder_id, { name: updates.name });
    }

    res.json({ success: true, key: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteApiKey = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.getApiKeyById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'API Key not found.' });
    }

    await db.deleteApiKey(id);

    // Remove the cloud copy too, otherwise the next sync re-imports the key.
    cloudDbService
      .deleteApiKey(id)
      .catch((e) => console.warn('[DeveloperController] Cloud delete of API key failed:', e.message));

    res.json({ success: true, message: 'API Key deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// --- Universal Developer API: Upload File / Image (POST /api/v1/upload) ---
exports.uploadViaApiKey = async (req, res) => {
  const rawFiles = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
  const uploadId = String((req.headers['x-upload-id'] || (req.body && req.body.upload_id) || '')).trim();
  const ownerId = req.apiKey && req.apiKey.id ? req.apiKey.id : null;

  let responded = false;
  const respondJson = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    if (status === 503) res.setHeader('Retry-After', '30');
    return res.status(status).json(payload);
  };

  try {
    // requireApiKey() normally guarantees this; refuse rather than writing a
    // record with api_key_id = undefined if the route was mounted without it.
    if (!req.apiKey || !req.apiKey.id) {
      return respondJson(401, { success: false, error: 'Unauthorized: A valid API Key is required.' });
    }

    if (rawFiles.length === 0) {
      return respondJson(400, {
        success: false,
        error: 'No file provided. Attach a file using field name "file" or "image" in multipart/form-data.',
      });
    }

    // Refuse early when nothing can be stored durably. Answering 503 here is
    // honest: the alternative is a record whose bytes vanish with the
    // serverless instance while the client is told it succeeded.
    const availability = await checkStorageAvailability();
    if (!availability.ok) {
      console.warn(`[DeveloperController] Upload rejected - storage unavailable: ${availability.reason}`);
      return respondJson(503, {
        success: false,
        error: availability.reason,
        retryable: true,
        runtime: isServerless ? 'serverless' : 'server',
        uploaded: 0,
      });
    }

    const baseUrl = getBaseUrl(req);
    const uploadedFiles = [];
    const rejectedFiles = [];
    const failedFiles = [];

    // Automatically get or create the dedicated folder with the same name as the API Key
    let apiKeyFolder = null;
    try {
      apiKeyFolder = await db.getOrCreateApiKeyFolder(req.apiKey);
    } catch (e) {
      console.error('[DeveloperController] Could not resolve the API key folder:', e.message);
      return respondJson(500, {
        success: false,
        error: `The destination folder for this API Key could not be prepared: ${e.message}`,
        uploaded: 0,
      });
    }
    const targetFolderId = apiKeyFolder ? apiKeyFolder.id : null;

    for (const file of rawFiles) {
      const rawName = Buffer.from(String(file.originalname || ''), 'latin1').toString('utf8');
      const originalName = sanitizeFileName(rawName);

      if (uploadId) uploadTracker.init(uploadId, originalName, file.size, { ownerId });

      // 1. Validate the bytes BEFORE any processing / storage work.
      const validation = validateUploadContent({
        filePath: file.path,
        originalName,
        declaredMime: file.mimetype,
        size: file.size,
      });

      if (!validation.valid) {
        console.warn(`[Security Alert] Rejected API upload: ${validation.reason}`);
        rejectedFiles.push({ name: originalName, reason: validation.reason });
        if (uploadId) uploadTracker.error(uploadId, validation.reason);
        continue;
      }

      try {
        const mimeType = resolveMimeType(file.mimetype, originalName, validation.kind);
        const category = detectCategory(mimeType, originalName);

        // 2. Upload to Telegram Saved Messages
        const uploadResult = await telegramService.uploadFile({
          originalName,
          buffer: file.buffer,
          filePath: file.path,
          mimeType,
          size: file.size,
          onProgress: uploadId
            ? (ratio) => {
                uploadTracker.updateCloudProgress(uploadId, ratio);
              }
            : null,
        });

        // 3. Never report success for bytes that are not retrievable later.
        if (!isDurableStorageResult(uploadResult)) {
          throw new StorageUnavailableError(
            'The file could not be durably stored (no Telegram message reference and no persistent local copy).'
          );
        }

        if (uploadId) uploadTracker.finalizing(uploadId);

        // Insert record into DB with api_key_id and folder_id automatically assigned
        const record = await db.insertFile({
          folder_id: targetFolderId,
          name: originalName,
          original_name: originalName,
          mime_type: mimeType,
          size: file.size,
          category,
          telegram_msg_id: uploadResult.telegramMsgId,
          telegram_chunk_ids: uploadResult.telegramChunkIds || null,
          is_chunked: uploadResult.isChunked || false,
          total_parts: uploadResult.totalParts || 1,
          telegram_chat_id: uploadResult.telegramChatId,
          file_hash: uploadResult.fileHash || uploadResult.file_hash || null,
          storage_type: uploadResult.storageType || 'telegram',
          local_path: uploadResult.localPath || null,
          api_key_id: req.apiKey.id,
          tags: ['api', req.apiKey.id, req.apiKey.name],
          is_starred: 0,
        });

        // Usage is only counted for files that were actually accepted.
        if (typeof db.incrementApiKeyUsage === 'function') {
          await db.incrementApiKeyUsage(req.apiKey.id);
        }

        // Build Developer-Friendly URLs
        const directUrl = `${baseUrl}/api/v1/raw/${record.id}`;
        const downloadUrl = `${baseUrl}/api/v1/download/${record.id}`;

        uploadedFiles.push({
          id: record.id,
          name: record.name,
          size: record.size,
          mime_type: record.mime_type,
          category: record.category,
          folder_id: targetFolderId,
          folder_name: apiKeyFolder ? apiKeyFolder.name : null,
          url: directUrl,
          direct_url: directUrl,
          download_url: downloadUrl,
          embed: {
            html: `<img src="${escapeHtmlAttr(directUrl)}" alt="${escapeHtmlAttr(record.name)}" />`,
            markdown: `![${record.name}](${directUrl})`,
          },
          created_at: record.created_at,
        });

        if (uploadId) uploadTracker.complete(uploadId);
      } catch (err) {
        const status = classifyUploadError(err);
        console.error(`[DeveloperController] Upload failed for "${originalName}":`, err.message);
        failedFiles.push({ name: originalName, reason: err.message, status });
        if (uploadId) uploadTracker.error(uploadId, err.message);
      } finally {
        // Always clean up the temporary disk file, whatever happened above.
        cleanupTempFile(file);
      }
    }

    if (uploadedFiles.length === 0) {
      const storageDown = failedFiles.some((f) => f.status === 503);
      if (storageDown) {
        return respondJson(503, {
          success: false,
          error:
            'Cloud storage is currently unavailable, so the upload was not saved. Nothing was stored - please retry shortly.',
          retryable: true,
          runtime: isServerless ? 'serverless' : 'server',
          uploaded: 0,
          failed: failedFiles,
          rejected: rejectedFiles,
        });
      }
      if (rejectedFiles.length > 0 && failedFiles.length === 0) {
        return respondJson(400, {
          success: false,
          error: rejectedFiles[0].reason,
          uploaded: 0,
          rejected: rejectedFiles,
        });
      }
      const firstFailure = failedFiles[0];
      return respondJson(firstFailure ? firstFailure.status || 500 : 500, {
        success: false,
        error: firstFailure ? firstFailure.reason : 'Failed to process any of the uploaded files.',
        uploaded: 0,
        failed: failedFiles,
        rejected: rejectedFiles,
      });
    }

    respondJson(201, {
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded and saved to folder "${apiKeyFolder ? apiKeyFolder.name : 'Root'}" successfully.`,
      uploaded_by: {
        api_key_name: req.apiKey.name,
        key_id: req.apiKey.id,
      },
      folder: apiKeyFolder
        ? {
            id: apiKeyFolder.id,
            name: apiKeyFolder.name,
          }
        : null,
      file: uploadedFiles.length === 1 ? uploadedFiles[0] : undefined,
      files: uploadedFiles,
      ...(rejectedFiles.length > 0 ? { rejected: rejectedFiles } : {}),
      ...(failedFiles.length > 0 ? { failed: failedFiles } : {}),
    });
  } catch (err) {
    console.error('[DeveloperController] uploadViaApiKey error:', err);
    respondJson(500, { success: false, error: 'The upload could not be completed.' });
  } finally {
    // Safety net: nothing received from the client may stay in TEMP_UPLOAD_DIR.
    cleanupTempFiles(rawFiles);
  }
};

// --- Public Direct Raw Image Stream (GET /api/v1/raw/:id or /api/v1/image/:id) ---
exports.serveRawFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);

    if (!file) {
      return res.status(404).json({ success: false, error: 'Image / file not found.' });
    }

    // Trashed files are never publicly retrievable - not even through the
    // public CDN path, and not for administrators either.
    if (file.is_trash) {
      return res.status(404).json({ success: false, error: 'Image / file not found.' });
    }

    const access = await resolveFileAccess(req, file);

    const isPublicAsset = !!file.api_key_id;
    const isShared = file.is_shared === 1 || file.is_shared === true;

    if (!access.authorized && !isPublicAsset && !isShared) {
      return respondAccessDenied(res, access);
    }

    const streamData = await telegramService.getFileStream(file);

    if (!streamData || (streamData.type !== 'stream' && streamData.type !== 'buffer')) {
      return res.status(404).json({ success: false, error: 'Image / file not found.' });
    }

    sendFilePayload(req, res, file, streamData, { download: false, isPublicAsset: isPublicAsset || isShared });
  } catch (err) {
    console.error('[DeveloperController] serveRawFile error:', err.message);
    if (res.headersSent) return res.destroy();
    const unavailable = DELIVERY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(String(err.message || '')));
    if (unavailable) res.setHeader('Retry-After', '30');
    return res.status(unavailable ? 503 : 404).json({
      success: false,
      error: unavailable
        ? 'The storage backend could not serve this file right now. Please retry.'
        : 'The file content could not be retrieved.',
    });
  }
};

// --- Public Download (GET /api/v1/download/:id) ---
exports.downloadRawFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);

    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // Same rule as the raw endpoint: trashed files are unreachable.
    if (file.is_trash) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const access = await resolveFileAccess(req, file);

    const isPublicAsset = !!file.api_key_id;
    const isShared = file.is_shared === 1 || file.is_shared === true;

    if (!access.authorized && !isPublicAsset && !isShared) {
      return respondAccessDenied(res, access);
    }

    const streamData = await telegramService.getFileStream(file);

    if (!streamData || (streamData.type !== 'stream' && streamData.type !== 'buffer')) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    sendFilePayload(req, res, file, streamData, { download: true, isPublicAsset: isPublicAsset || isShared });
  } catch (err) {
    console.error('[DeveloperController] downloadRawFile error:', err.message);
    if (res.headersSent) return res.destroy();
    const unavailable = DELIVERY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(String(err.message || '')));
    if (unavailable) res.setHeader('Retry-After', '30');
    return res.status(unavailable ? 503 : 404).json({
      success: false,
      error: unavailable
        ? 'The storage backend could not serve this file right now. Please retry.'
        : 'The file content could not be retrieved.',
    });
  }
};
