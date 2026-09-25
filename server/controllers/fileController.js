const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory, getSetting } = require('../db');
const telegramService = require('../services/telegramService');
const uploadTracker = require('../services/uploadTracker');

const { UPLOADS_DIR, isSafePath } = require('../config/paths');
const { verifyAdminToken } = require('../middleware/authMiddleware');

function sanitizeFileName(name) {
  if (!name) return 'unnamed_file';
  return name.replace(/[\/\?<>\\:\*\|":]/g, '_').replace(/\.\./g, '_').trim();
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

    // Auto-sync if file list is currently empty
    if ((db.data.files || []).length === 0) {
      try {
        await telegramService.syncFromTelegramSavedMessages(activeSession);
      } catch (e) {
        // Non-blocking
      }
    }

    const { folder_id, category, filter, search, sortBy, sortOrder } = req.query;
    const files = await db.getFiles({
      folder_id,
      category,
      filter: filter || 'all',
      search: search || '',
      sortBy: sortBy || 'created_at',
      sortOrder: sortOrder || 'desc',
    });
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
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded.' });
    }

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const { getSetting } = require('../db');
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
    let lastError = null;

    // Clean up temporary files if client abruptly closes or cancels connection
    const cleanupTempFiles = () => {
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
          }
        }
      }
      if (uploadId) {
        uploadTracker.error(uploadId, 'Upload connection aborted');
      }
    };
    req.on('close', () => {
      if (uploadedRecords.length === 0) cleanupTempFiles();
    });

    for (const file of req.files) {
      try {
        const rawName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const originalName = sanitizeFileName(rawName);

        if (uploadId) {
          uploadTracker.init(uploadId, originalName, file.size);
        }

        if (!validateMagicBytes(file.path, originalName)) {
          console.warn(`[Security Alert] Rejected file upload with mismatched executable signature: ${originalName}`);
          lastError = `Security Alert: Rejected ${originalName} with mismatched executable signature.`;
          if (uploadId) uploadTracker.error(uploadId, lastError);
          continue;
        }

        const mimeType = file.mimetype || mime.lookup(originalName) || 'application/octet-stream';
        const category = detectCategory(mimeType, originalName);

        // Upload to Telegram or Local
        const uploadResult = await telegramService.uploadFile({
          originalName,
          buffer: file.buffer,
          filePath: file.path,
          mimeType,
          size: file.size,
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
          size: file.size,
          category,
          telegram_msg_id: uploadResult.telegramMsgId,
          telegram_chunk_ids: uploadResult.telegramChunkIds || null,
          is_chunked: uploadResult.isChunked || false,
          total_parts: uploadResult.totalParts || 1,
          telegram_chat_id: uploadResult.telegramChatId,
          file_hash: uploadResult.fileHash || uploadResult.file_hash || null,
          storage_type: uploadResult.storageType,
          local_path: uploadResult.localPath,
          tags: [],
          is_starred: 0,
        });

        uploadedRecords.push(record);
        if (uploadId) {
          uploadTracker.complete(uploadId);
        }
      } catch (fileErr) {
        console.error(`[FileController] Error processing file ${file.originalname}:`, fileErr.message);
        lastError = fileErr.message;
        if (uploadId) {
          uploadTracker.error(uploadId, fileErr.message);
        }
      } finally {
        // Always clean up temporary disk file from TEMP_UPLOAD_DIR
        if (file.path && fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {}
        }
      }
    }

    if (uploadedRecords.length === 0) {
      return res.status(500).json({ success: false, error: lastError || 'Failed to process any of the uploaded files.' });
    }

    res.status(201).json({
      success: true,
      message: `${uploadedRecords.length} file(s) uploaded successfully.`,
      files: uploadedRecords,
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

    if (streamData.size) {
      res.setHeader('Content-Length', streamData.size);
    }

    if (streamData.type === 'stream') {
      streamData.stream.pipe(res);
    } else if (streamData.type === 'buffer') {
      res.send(streamData.buffer);
    }
  } catch (err) {
    console.error('[FileController] downloadFile error:', err);
    res.status(500).json({ success: false, error: err.message });
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

    // Return 304 immediately if client already has cached version
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const streamData = await telegramService.getFileStream(file, clientSession);

    // If streaming from local disk or cache path, support HTTP 206 Range requests for instant seeking & fast streaming
    if (streamData.localPath && fs.existsSync(streamData.localPath) && isSafePath(streamData.localPath)) {
      const stat = fs.statSync(streamData.localPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const fileStream = fs.createReadStream(streamData.localPath, { start, end });

        const headers = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'ETag': etag,
        };
        if (isExecutableMime) headers['Content-Security-Policy'] = cspHeader;

        res.writeHead(206, headers);
        fileStream.pipe(res);
        return;
      } else {
        const headers = {
          'Content-Length': fileSize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'ETag': etag,
        };
        if (isExecutableMime) headers['Content-Security-Policy'] = cspHeader;

        res.writeHead(200, headers);
        fs.createReadStream(streamData.localPath).pipe(res);
        return;
      }
    }

    // Direct buffer response
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (streamData.size) {
      res.setHeader('Content-Length', streamData.size);
    }

    if (streamData.type === 'buffer') {
      res.send(streamData.buffer);
    } else if (streamData.type === 'stream') {
      streamData.stream.pipe(res);
    }
  } catch (err) {
    console.error('[FileController] streamFile error:', err);
    res.status(500).send(err.message);
  }
};

exports.updateFile = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, folder_id, is_starred, is_shared, tags } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = sanitizeFileName(name);
    if (folder_id !== undefined) updates.folder_id = folder_id === 'root' ? null : folder_id;
    if (is_starred !== undefined) updates.is_starred = is_starred ? 1 : 0;
    if (is_shared !== undefined) updates.is_shared = is_shared ? 1 : 0;
    if (tags !== undefined) updates.tags = tags;

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
    res.json({ success: true, message: 'File moved to trash.', file });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.restoreFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.restoreFile(id);
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
      if (file) {
        if (file.telegram_chunk_ids || file.telegram_msg_id) {
          telegramService.deleteTelegramMessage(file.telegram_chunk_ids || file.telegram_msg_id, file.telegram_chat_id).catch(() => {});
        }
        if (file.local_path && fs.existsSync(file.local_path) && isSafePath(file.local_path)) {
          try {
            fs.unlinkSync(file.local_path);
          } catch (e) {}
        }
        await db.deleteFile(id, false);
      }
      return res.json({ success: true, message: 'File deleted permanently.' });
    }

    // Default: Safely move file to Recycle Bin
    const file = await db.deleteFile(id, true);
    res.json({ success: true, message: 'File moved to Recycle Bin.', file });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.emptyTrash = async (req, res) => {
  try {
    const result = await db.emptyTrash();
    for (const f of result.trashedFiles) {
      if (f.telegram_chunk_ids || f.telegram_msg_id) {
        telegramService.deleteTelegramMessage(f.telegram_chunk_ids || f.telegram_msg_id, f.telegram_chat_id).catch(() => {});
      }
      if (f.local_path && fs.existsSync(f.local_path) && isSafePath(f.local_path)) {
        try {
          fs.unlinkSync(f.local_path);
        } catch (e) {}
      }
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.batchAction = async (req, res) => {
  try {
    const { action, fileIds, targetFolderId } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, error: 'File IDs array is required.' });
    }

    const results = [];
    for (const id of fileIds) {
      if (action === 'star') {
        const f = await db.updateFile(id, { is_starred: 1 });
        results.push(f);
      } else if (action === 'unstar') {
        const f = await db.updateFile(id, { is_starred: 0 });
        results.push(f);
      } else if (action === 'move') {
        const f = await db.updateFile(id, { folder_id: targetFolderId === 'root' ? null : targetFolderId });
        results.push(f);
      } else if (action === 'trash') {
        const f = await db.deleteFile(id, true);
        results.push(f);
      } else if (action === 'restore') {
        const f = await db.restoreFile(id);
        results.push(f);
      } else if (action === 'delete') {
        const f = await db.getFileById(id);
        if (f) {
          if (f.telegram_msg_id) {
            telegramService.deleteTelegramMessage(f.telegram_msg_id, f.telegram_chat_id).catch(() => {});
          }
          if (f.local_path && fs.existsSync(f.local_path) && isSafePath(f.local_path)) {
            try {
              fs.unlinkSync(f.local_path);
            } catch (e) {}
          }
          await db.deleteFile(id, false);
          results.push(f);
        }
      }
    }

    res.json({ success: true, count: results.length, results });
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
    const { name, content = '', folder_id = null } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'File name is required.' });
    }

    const originalName = sanitizeFileName(name.trim());
    const mimeType = mime.lookup(originalName) || 'text/plain';
    const category = detectCategory(mimeType, originalName);
    const targetFolderId = folder_id === 'root' || !folder_id ? null : folder_id;

    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    const { getSetting } = require('../db');
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const client = !isManualDisconnected ? await telegramService.ensureClient(clientSession) : null;

    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'First connect Telegram! Please connect your Telegram account before creating files.',
      });
    }

    const buffer = Buffer.from(content, 'utf8');
    const size = buffer.length;

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
      storage_type: uploadResult.storageType,
      local_path: uploadResult.localPath,
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
    const { content = '' } = req.body;
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const buffer = Buffer.from(content, 'utf8');
    const size = buffer.length;

    // Upload updated version to Telegram Saved Messages
    const uploadResult = await telegramService.uploadFile({
      originalName: file.name,
      buffer,
      mimeType: file.mime_type,
      size,
    });

    // Delete old Telegram message
    if (file.telegram_chunk_ids || file.telegram_msg_id) {
      telegramService.deleteTelegramMessage(file.telegram_chunk_ids || file.telegram_msg_id, file.telegram_chat_id).catch(() => {});
    }

    const updated = await db.updateFile(id, {
      size,
      telegram_msg_id: uploadResult.telegramMsgId,
      telegram_chunk_ids: uploadResult.telegramChunkIds || null,
      is_chunked: uploadResult.isChunked || false,
      total_parts: uploadResult.totalParts || 1,
      local_path: uploadResult.localPath,
    });

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
