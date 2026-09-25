const fs = require('fs');
const os = require('os');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory, getSetting, normalizeTags, normalizeMessageId, normalizeMessageIds } = require('../db');
const telegramService = require('../services/telegramService');
const uploadTracker = require('../services/uploadTracker');

const { UPLOADS_DIR, CACHE_DIR, TEMP_UPLOAD_DIR } = require('../config/paths');
const { verifyAdminToken } = require('../middleware/authMiddleware');

const ALLOWED_FILE_FILTERS = new Set(['all', 'trash', 'starred', 'recent']);
const ALLOWED_BATCH_ACTIONS = new Set(['star', 'unstar', 'move', 'trash', 'restore', 'delete']);
const MAX_BATCH_FILE_IDS = 1000;

function sanitizeFileName(name) {
  if (!name) return 'unnamed_file';
  return name.replace(/[\/\?<>\\:\*\|":]/g, '_').replace(/\.\./g, '_').trim();
}

// --- Local filesystem safety -----------------------------------------------
// isSafePath() from config/paths is a naive prefix check ("/uploads_evil" also
// passes), so every local file access in this controller goes through a strict
// containment test that additionally rejects symlink escapes.

const LOCAL_ROOTS = [UPLOADS_DIR, CACHE_DIR, TEMP_UPLOAD_DIR, os.tmpdir()]
  .filter(Boolean)
  .map((root) => {
    const resolved = path.resolve(root);
    try {
      return fs.realpathSync(resolved);
    } catch (e) {
      return resolved;
    }
  });
const LOCAL_ROOTS_RESOLVED = [UPLOADS_DIR, CACHE_DIR, TEMP_UPLOAD_DIR, os.tmpdir()]
  .filter(Boolean)
  .map((root) => path.resolve(root));

function isContainedInRoot(root, target) {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

function isSafeLocalPath(candidate) {
  if (!candidate || typeof candidate !== 'string' || candidate.includes('\0')) return false;

  let resolved;
  try {
    resolved = path.resolve(candidate);
  } catch (e) {
    return false;
  }
  if (!LOCAL_ROOTS_RESOLVED.some((root) => isContainedInRoot(root, resolved))) return false;

  try {
    const real = fs.realpathSync(resolved);
    return LOCAL_ROOTS.some((root) => isContainedInRoot(root, real));
  } catch (e) {
    // Target does not exist yet: the resolved-path check above is enough.
    return true;
  }
}

function safeUnlink(candidate) {
  if (!isSafeLocalPath(candidate)) return false;
  try {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
      return true;
    }
  } catch (e) {}
  return false;
}

/** Every Telegram message that belongs to a file record (primary id + all chunks). */
function collectTelegramMessageIds(file) {
  if (!file) return [];
  const ids = new Set();
  for (const id of normalizeMessageIds(file.telegram_chunk_ids)) ids.add(id);
  const primary = normalizeMessageId(file.telegram_msg_id);
  if (primary) ids.add(primary);
  return Array.from(ids);
}

function scheduleTelegramDelete(file, excludeIds = []) {
  const excluded = new Set(normalizeMessageIds(excludeIds));
  const ids = collectTelegramMessageIds(file).filter((id) => !excluded.has(id));
  if (ids.length === 0) return 0;
  telegramService.deleteTelegramMessage(ids, file.telegram_chat_id || 'me').catch(() => {});
  return ids.length;
}

function removeLocalArtifacts(file) {
  const removed = [];
  if (file && typeof file.local_path === 'string' && safeUnlink(file.local_path)) {
    removed.push(file.local_path);
  }
  try {
    if (typeof telegramService.removeLocalCache === 'function') {
      const cached = telegramService.removeLocalCache(file);
      if (cached) removed.push(cached);
    }
  } catch (e) {}
  return removed;
}

/**
 * RFC 7233 single-range parser.
 *  - `ignore`         : no usable range (malformed / multi-range) -> answer 200
 *  - `unsatisfiable`  : syntactically valid but outside the entity -> answer 416
 *  - `range`          : inclusive start/end offsets
 */
function parseRangeHeader(rangeHeader, totalSize) {
  if (typeof rangeHeader !== 'string' || !rangeHeader.trim()) return { kind: 'ignore' };

  const header = rangeHeader.trim();
  if (!/^bytes\s*=/i.test(header)) return { kind: 'ignore' };

  const spec = header.slice(header.indexOf('=') + 1).trim();
  if (!spec || spec.includes(',')) return { kind: 'ignore' }; // multipart/byteranges unsupported

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return { kind: 'ignore' };

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'ignore' };

  const size = Number(totalSize);
  if (!Number.isFinite(size) || size < 0) return { kind: 'ignore' };

  let start;
  let end;

  if (rawStart === '') {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0 || size === 0) return { kind: 'unsatisfiable', size };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (rawEnd === '') {
      end = size - 1;
    } else {
      end = Number(rawEnd);
      if (end < start) return { kind: 'ignore' };
      if (end > size - 1) end = size - 1;
    }
    if (size === 0 || start >= size) return { kind: 'unsatisfiable', size };
  }

  return { kind: 'range', start, end, size, length: end - start + 1 };
}

function validateMagicBytes(filePath, originalName) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return true;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const isMZ = buffer[0] === 0x4d && buffer[1] === 0x5a;
    const isELF = buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;

    const ext = path.extname(originalName).toLowerCase();
    const safeMediaExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.pdf', '.txt', '.json'];

    // Reject executable code pretending to be images/media
    if (safeMediaExts.includes(ext) && (isMZ || isELF)) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

exports.listFiles = async (req, res) => {
  try {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (isManualDisconnected) {
      return res.json({ success: true, files: [] });
    }

    const sessionString = String((await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
    const clientSession = String(req.headers?.['x-telegram-session'] || req.query?.session || '').trim();
    const activeSession = sessionString || clientSession;

    if (!activeSession) {
      return res.json({ success: true, files: [] });
    }

    const client = await telegramService.ensureClient(activeSession);
    if (!client) {
      return res.json({ success: true, files: [] });
    }

    // Auto-sync if file list is currently empty or requested
    const shouldSync = (db.data.files || []).length === 0 || req.query?.sync === 'true';
    if (shouldSync) {
      try {
        // ?fullSync=true walks the complete Saved Messages history (slower, but
        // the only mode where a scan can be treated as authoritative).
        const syncOptions = req.query?.fullSync === 'true' ? { full: true } : undefined;
        await telegramService.syncFromTelegramSavedMessages(activeSession, syncOptions);
      } catch (e) {
        console.warn('[Files] Auto-sync notice:', e.message);
      }
    }

    const { folder_id, category, filter, search, sortBy, sortOrder } = req.query;
    if (filter !== undefined && !ALLOWED_FILE_FILTERS.has(String(filter))) {
      return res.status(400).json({
        success: false,
        error: `Invalid filter "${filter}". Allowed values: ${Array.from(ALLOWED_FILE_FILTERS).join(', ')}.`,
      });
    }

    // folder_id is forwarded exactly as received: an absent parameter means
    // "no folder filter", while 'root'/'' explicitly means the root folder.
    let files = await db.getFiles({
      folder_id,
      category,
      filter: filter || 'all',
      search: search || '',
      sortBy: sortBy || 'created_at',
      sortOrder: sortOrder || 'desc',
    });

    // Enforce: ONLY real Telegram Saved Messages data (no local sandbox/dummy files)
    files = files.filter((f) => f.storage_type === 'telegram' && f.telegram_msg_id);

    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    res.json({ success: true, file });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.uploadFiles = async (req, res) => {
  let requestCompleted = false;
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded.' });
    }

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const client = !isManualDisconnected ? await telegramService.ensureClient(clientSession) : null;

    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'First connect Telegram! Please connect your Telegram account before uploading files.',
      });
    }
    const targetFolderId = req.body.folder_id === 'root' || !req.body.folder_id ? null : req.body.folder_id;
    const uploadId = (req.body.upload_id || req.headers['x-upload-id'] || '').trim();
    const uploadedRecords = [];
    const failures = [];
    let lastError = null;

    // Clean up temporary files if client abruptly closes or cancels connection
    const cleanupTempFiles = (reportError) => {
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file && file.path) safeUnlink(file.path);
        }
      }
      if (reportError && uploadId) {
        uploadTracker.error(uploadId, 'Upload connection aborted');
      }
    };
    req.on('close', () => {
      // Leftover temp files are always removed; the tracker is only failed while
      // the request is still in flight.
      cleanupTempFiles(!requestCompleted);
    });

    for (const file of req.files) {
      const displayName = sanitizeFileName(String(file.originalname || 'unnamed_file'));
      try {
        const rawName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const originalName = sanitizeFileName(rawName);

        if (uploadId) {
          uploadTracker.init(uploadId, originalName, file.size);
        }

        if (!validateMagicBytes(file.path, originalName)) {
          console.warn(`[Security Alert] Rejected file upload with mismatched executable signature: ${originalName}`);
          lastError = `Security Alert: Rejected ${originalName} with mismatched executable signature.`;
          failures.push({ name: originalName, error: lastError, code: 'rejected' });
          if (uploadId) uploadTracker.error(uploadId, lastError);
          continue;
        }

        const mimeType = file.mimetype || mime.lookup(originalName) || 'application/octet-stream';
        const category = detectCategory(mimeType, originalName);
        const size = Number.isFinite(Number(file.size)) ? Math.max(0, Number(file.size)) : 0;

        // Upload to Telegram (no local storage fallback)
        const uploadResult = await telegramService.uploadFile({
          originalName,
          buffer: file.buffer,
          filePath: file.path,
          mimeType,
          size,
          sessionString: clientSession,
          onProgress: (ratio) => {
            if (uploadId) {
              uploadTracker.updateCloudProgress(uploadId, ratio);
            }
          },
        });

        if (uploadId) {
          uploadTracker.finalizing(uploadId);
        }

        // Insert record into DB
        const record = await db.insertFile({
          folder_id: targetFolderId,
          name: originalName,
          original_name: originalName,
          mime_type: mimeType,
          size,
          category,
          telegram_msg_id: uploadResult.telegramMsgId,
          telegram_chunk_ids: uploadResult.telegramChunkIds || null,
          is_chunked: uploadResult.isChunked || false,
          total_parts: uploadResult.totalParts || 1,
          telegram_chat_id: uploadResult.telegramChatId,
          file_hash: uploadResult.fileHash || uploadResult.file_hash || null,
          storage_type: 'telegram',
          local_path: null,
          tags: [],
          is_starred: 0,
        });

        uploadedRecords.push(record);
        if (uploadId) {
          uploadTracker.complete(uploadId);
        }
      } catch (fileErr) {
        console.error(`[FileController] Error processing file ${displayName}:`, fileErr.message);
        lastError = fileErr.message;
        failures.push({ name: displayName, error: fileErr.message });
        if (uploadId) {
          uploadTracker.error(uploadId, fileErr.message);
        }
      } finally {
        // Always clean up temporary disk file from TEMP_UPLOAD_DIR
        if (file.path) safeUnlink(file.path);
      }
    }

    requestCompleted = true;

    if (uploadedRecords.length === 0) {
      return res.status(500).json({
        success: false,
        error: lastError || 'Failed to process any of the uploaded files.',
        uploaded: 0,
        failed: failures.length,
        failures,
      });
    }

    // Partial success must never look like a total success.
    const partial = failures.length > 0;
    return res.status(201).json({
      success: true,
      partial,
      uploaded: uploadedRecords.length,
      failed: failures.length,
      requested: req.files.length,
      message: partial
        ? `${uploadedRecords.length} of ${req.files.length} file(s) uploaded. ${failures.length} failed.`
        : `${uploadedRecords.length} file(s) uploaded successfully.`,
      files: uploadedRecords,
      ...(partial ? { failures } : {}),
    });
  } catch (err) {
    console.error('[FileController] uploadFiles error:', err);
    res.status(500).json({ success: false, error: err.message || 'File upload failed.' });
  }
};

exports.getUploadProgress = async (req, res) => {
  try {
    const { uploadId } = req.params;
    const progress = uploadTracker.get(uploadId);
    return res.json({ success: true, progress });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const streamData = await telegramService.getFileStream(file, clientSession);

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (Number.isFinite(Number(streamData.size))) {
      res.setHeader('Content-Length', String(Number(streamData.size)));
    }

    if (streamData.type === 'stream') {
      streamData.stream.on('error', (err) => {
        console.error('[FileController] download stream error:', err.message);
        res.destroy(err);
      });
      streamData.stream.pipe(res);
    } else if (streamData.type === 'buffer') {
      res.send(streamData.buffer);
    } else {
      res.status(500).end();
    }
  } catch (err) {
    console.error('[FileController] downloadFile error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.end();
    }
  }
};

exports.streamFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).send('File not found');
    }

    // Authorization: Admin session/token OR active Telegram session OR explicitly shared file
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    let isAuthorized = false;
    if (token) {
      const verified = await verifyAdminToken(token);
      if (verified) isAuthorized = true;
    }

    // Check Telegram session token from header or query param
    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const storedSession = (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '';
    if (!isAuthorized) {
      if (clientSession && storedSession && clientSession === storedSession) {
        isAuthorized = true;
      } else if (clientSession && clientSession.length > 30) {
        isAuthorized = true;
      } else if (telegramService.client && telegramService.authType === 'saved_messages') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      const isShared = (file.is_shared === 1 || file.is_shared === true) && !file.is_trash;
      if (!isShared) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Private file is not shared.' });
      }
    }

    // XSS Protection for executable MIME types (HTML, XHTML, SVG)
    const isExecutableMime = ['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(file.mime_type);
    const cspHeader = "sandbox allow-scripts allow-forms; default-src 'self' data:; style-src 'self' 'unsafe-inline'";
    if (isExecutableMime) {
      res.setHeader('Content-Security-Policy', cspHeader);
    }

    // Fast ETag and Cache-Control for instant browser reuse
    const etag = `"${file.id}-${file.size}-${new Date(file.updated_at || file.created_at).getTime()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('Accept-Ranges', 'bytes');

    // Return 304 immediately if client already has cached version
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const streamData = await telegramService.getFileStream(file, clientSession);

    const pipeFileStream = (stream) => {
      stream.on('error', (err) => {
        console.error('[FileController] streamFile stream error:', err.message);
        res.destroy(err);
      });
      stream.pipe(res);
    };

    // Serve from a verified-safe local path with full HTTP 206 Range support
    const localPath = streamData.localPath;
    if (localPath && isSafeLocalPath(localPath) && fs.existsSync(localPath)) {
      let stat;
      try {
        stat = fs.statSync(localPath);
      } catch (e) {
        stat = null;
      }

      if (stat && stat.isFile()) {
        const fileSize = stat.size;
        const range = parseRangeHeader(req.headers.range, fileSize);

        if (range.kind === 'unsatisfiable') {
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          return res.status(416).end();
        }

        const baseHeaders = {
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'ETag': etag,
        };
        if (isExecutableMime) baseHeaders['Content-Security-Policy'] = cspHeader;

        if (range.kind === 'range') {
          res.writeHead(206, {
            ...baseHeaders,
            'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
            'Content-Length': String(range.length),
          });
          pipeFileStream(fs.createReadStream(localPath, { start: range.start, end: range.end }));
          return;
        }

        res.writeHead(200, { ...baseHeaders, 'Content-Length': String(fileSize) });
        pipeFileStream(fs.createReadStream(localPath));
        return;
      }
    }

    // Direct buffer response
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (Number.isFinite(Number(streamData.size))) {
      res.setHeader('Content-Length', String(Number(streamData.size)));
    }

    if (streamData.type === 'buffer') {
      res.send(streamData.buffer);
    } else if (streamData.type === 'stream') {
      pipeFileStream(streamData.stream);
    } else {
      res.status(500).end();
    }
  } catch (err) {
    console.error('[FileController] streamFile error:', err);
    if (!res.headersSent) {
      res.status(500).send(err.message);
    } else {
      res.end();
    }
  }
};

exports.updateFile = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, folder_id, is_starred, is_shared, tags } = req.body || {};

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'File name must be a non-empty string.' });
      }
      updates.name = sanitizeFileName(name);
    }

    if (folder_id !== undefined) {
      if (folder_id === null || folder_id === 'root' || folder_id === '') {
        updates.folder_id = null;
      } else if (typeof folder_id === 'string') {
        const target = await db.getFolderById(folder_id);
        if (!target) {
          return res.status(400).json({ success: false, error: 'Target folder not found.' });
        }
        updates.folder_id = folder_id;
      } else {
        return res.status(400).json({ success: false, error: 'Invalid folder id.' });
      }
    }

    if (is_starred !== undefined) updates.is_starred = is_starred ? 1 : 0;
    if (is_shared !== undefined) updates.is_shared = is_shared ? 1 : 0;

    if (tags !== undefined) {
      const normalized = normalizeTags(tags);
      if (normalized === null) {
        return res.status(400).json({ success: false, error: 'Invalid tags: expected an array of strings.' });
      }
      updates.tags = normalized;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update.' });
    }

    const updated = await db.updateFile(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    res.json({ success: true, file: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.trashFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.deleteFile(id, true);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    res.json({ success: true, message: 'File moved to trash.', file });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.restoreFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.restoreFile(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    res.json({ success: true, message: 'File restored.', file });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const { id } = req.params;
    const isPermanent = req.query.permanent === 'true' || req.query.permanent === true;

    if (isPermanent) {
      const file = await db.getFileById(id);
      if (!file) {
        return res.status(404).json({ success: false, error: 'File not found.' });
      }
      // Every chunk message must be removed, not just the first one.
      const deletedTelegramMessages = scheduleTelegramDelete(file);
      removeLocalArtifacts(file);
      await db.deleteFile(id, false);
      return res.json({
        success: true,
        message: 'File deleted permanently.',
        deletedTelegramMessages,
      });
    }

    // Default: Safely move file to Recycle Bin
    const trashed = await db.deleteFile(id, true);
    if (!trashed) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    res.json({ success: true, message: 'File moved to Recycle Bin.', file: trashed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.emptyTrash = async (req, res) => {
  try {
    const result = await db.emptyTrash();
    let deletedTelegramMessages = 0;
    for (const f of result.trashedFiles || []) {
      deletedTelegramMessages += scheduleTelegramDelete(f);
      removeLocalArtifacts(f);
    }
    res.json({ success: true, ...result, deletedTelegramMessages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.batchAction = async (req, res) => {
  try {
    const { action: rawAction, fileIds, targetFolderId } = req.body || {};
    const action = String(rawAction || '').trim().toLowerCase();

    if (!ALLOWED_BATCH_ACTIONS.has(action)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported batch action "${rawAction === undefined ? '' : rawAction}". Supported actions: ${Array.from(ALLOWED_BATCH_ACTIONS).join(', ')}.`,
      });
    }

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, error: 'File IDs array is required.' });
    }
    if (fileIds.length > MAX_BATCH_FILE_IDS) {
      return res.status(400).json({ success: false, error: `Too many file ids (max ${MAX_BATCH_FILE_IDS}).` });
    }
    if (fileIds.some((id) => typeof id !== 'string' || !id)) {
      return res.status(400).json({ success: false, error: 'File IDs must be non-empty strings.' });
    }

    let resolvedTargetFolder = null;
    if (action === 'move') {
      if (targetFolderId === null || targetFolderId === undefined || targetFolderId === 'root' || targetFolderId === '') {
        resolvedTargetFolder = null;
      } else if (typeof targetFolderId === 'string') {
        const target = await db.getFolderById(targetFolderId);
        if (!target) {
          return res.status(400).json({ success: false, error: 'Target folder not found.' });
        }
        resolvedTargetFolder = targetFolderId;
      } else {
        return res.status(400).json({ success: false, error: 'Invalid target folder id.' });
      }
    }

    const results = [];
    const errors = [];
    let deletedTelegramMessages = 0;

    for (const id of fileIds) {
      try {
        if (action === 'star') {
          const f = await db.updateFile(id, { is_starred: 1 });
          if (!f) throw new Error('File not found.');
          results.push(f);
        } else if (action === 'unstar') {
          const f = await db.updateFile(id, { is_starred: 0 });
          if (!f) throw new Error('File not found.');
          results.push(f);
        } else if (action === 'move') {
          const f = await db.updateFile(id, { folder_id: resolvedTargetFolder });
          if (!f) throw new Error('File not found.');
          results.push(f);
        } else if (action === 'trash') {
          const f = await db.deleteFile(id, true);
          if (!f) throw new Error('File not found.');
          results.push(f);
        } else if (action === 'restore') {
          const f = await db.restoreFile(id);
          if (!f) throw new Error('File not found.');
          results.push(f);
        } else if (action === 'delete') {
          const f = await db.getFileById(id);
          if (!f) throw new Error('File not found.');
          deletedTelegramMessages += scheduleTelegramDelete(f);
          removeLocalArtifacts(f);
          await db.deleteFile(id, false);
          results.push(f);
        }
      } catch (itemErr) {
        errors.push({ id, error: itemErr.message });
      }
    }

    res.json({
      success: true,
      action,
      count: results.length,
      requested: fileIds.length,
      failed: errors.length,
      results,
      ...(errors.length > 0 ? { errors } : {}),
      ...(action === 'delete' ? { deletedTelegramMessages } : {}),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const sessionString = String((await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
    const clientSession = String(req.headers?.['x-telegram-session'] || req.query?.session || '').trim();
    const activeSession = sessionString || clientSession;

    if (isManualDisconnected || !activeSession) {
      return res.json({
        success: true,
        stats: {
          totalFiles: 0,
          totalSize: 0,
          formattedSize: '0 B',
          categories: {
            images: { count: 0, size: 0 },
            videos: { count: 0, size: 0 },
            audio: { count: 0, size: 0 },
            documents: { count: 0, size: 0 },
            archives: { count: 0, size: 0 },
            others: { count: 0, size: 0 },
          },
          trashCount: 0,
          starredCount: 0,
          recentCount: 0,
        },
      });
    }

    const stats = await db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createNoteFile = async (req, res) => {
  try {
    const { name, content = '', folder_id = null } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'File name is required.' });
    }
    if (content !== null && content !== undefined && typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'File content must be a string.' });
    }

    const originalName = sanitizeFileName(name.trim());
    const mimeType = mime.lookup(originalName) || 'text/plain';
    const category = detectCategory(mimeType, originalName);
    const targetFolderId = folder_id === 'root' || !folder_id ? null : folder_id;

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const client = !isManualDisconnected ? await telegramService.ensureClient(clientSession) : null;

    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'First connect Telegram! Please connect your Telegram account before creating files.',
      });
    }

    const buffer = Buffer.from(content || '', 'utf8');
    const size = buffer.length; // zero-byte notes are valid

    // Upload directly to Telegram Saved Messages
    const uploadResult = await telegramService.uploadFile({
      originalName,
      buffer,
      mimeType,
      size,
      sessionString: clientSession,
    });

    const record = await db.insertFile({
      folder_id: targetFolderId,
      name: originalName,
      original_name: originalName,
      mime_type: mimeType,
      size,
      category,
      telegram_msg_id: uploadResult.telegramMsgId,
      telegram_chunk_ids: uploadResult.telegramChunkIds || null,
      is_chunked: uploadResult.isChunked || false,
      total_parts: uploadResult.totalParts || 1,
      telegram_chat_id: uploadResult.telegramChatId || 'me',
      storage_type: 'telegram',
      local_path: null,
      tags: ['note', 'document'],
      is_starred: 0,
    });

    res.status(201).json({
      success: true,
      message: `File "${originalName}" created successfully.`,
      file: record,
    });
  } catch (err) {
    console.error('[FileController] createNoteFile error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create file.' });
  }
};

exports.updateFileContent = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    if (content !== null && content !== undefined && typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'File content must be a string.' });
    }

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const client = !isManualDisconnected ? await telegramService.ensureClient(clientSession) : null;
    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'First connect Telegram! Please connect your Telegram account before updating files.',
      });
    }

    const buffer = Buffer.from(content || '', 'utf8');
    const size = buffer.length;

    // Upload updated version to Telegram Saved Messages
    const uploadResult = await telegramService.uploadFile({
      originalName: file.name,
      buffer,
      mimeType: file.mime_type,
      size,
      sessionString: clientSession,
    });

    const updated = await db.updateFile(id, {
      size,
      telegram_msg_id: uploadResult.telegramMsgId,
      telegram_chunk_ids: uploadResult.telegramChunkIds || null,
      is_chunked: uploadResult.isChunked || false,
      total_parts: uploadResult.totalParts || 1,
      local_path: null,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // The previous content is only dropped once the new record is persisted.
    const newIds = [uploadResult.telegramMsgId, ...(uploadResult.telegramChunkIds || [])].filter(Boolean);
    scheduleTelegramDelete(file, newIds);
    removeLocalArtifacts(file);

    res.json({
      success: true,
      message: `File "${file.name}" updated successfully.`,
      file: updated,
    });
  } catch (err) {
    console.error('[FileController] updateFileContent error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update file.' });
  }
};

exports.getSharedFileInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);
    if (!file || file.is_trash || (!file.is_shared && file.is_shared !== 1)) {
      return res.status(404).json({ success: false, error: 'Shared file not found or link has expired/revoked.' });
    }

    // Strictly read-only public payload - zero sensitive admin data
    res.json({
      success: true,
      file: {
        id: file.id,
        name: file.name,
        original_name: file.original_name,
        size: file.size,
        mime_type: file.mime_type,
        category: file.category,
        created_at: file.created_at,
        stream_url: `/api/files/${file.id}/stream`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Exported for focused unit tests of the parsing / safety helpers.
exports.internalHelpers = {
  parseRangeHeader,
  isSafeLocalPath,
  collectTelegramMessageIds,
  normalizeTags,
  sanitizeFileName,
};
