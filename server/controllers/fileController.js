const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory } = require('../db');
const telegramService = require('../services/telegramService');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

// Security helper: Prevent directory traversal
function isSafePath(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(UPLOADS_DIR);
}

function sanitizeFileName(name) {
  if (!name) return 'unnamed_file';
  return name.replace(/[\/\?<>\\:\*\|":]/g, '_').replace(/\.\./g, '_').trim();
}

exports.listFiles = async (req, res) => {
  try {
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

    const targetFolderId = req.body.folder_id === 'root' || !req.body.folder_id ? null : req.body.folder_id;
    const uploadedRecords = [];

    for (const file of req.files) {
      const rawName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const originalName = sanitizeFileName(rawName);
      const mimeType = file.mimetype || mime.lookup(originalName) || 'application/octet-stream';
      const category = detectCategory(mimeType, originalName);

      // Upload to Telegram or Local
      const uploadResult = await telegramService.uploadFile({
        originalName,
        buffer: file.buffer,
        filePath: file.path,
        mimeType,
        size: file.size,
      });

      // Insert record into DB
      const record = await db.insertFile({
        folder_id: targetFolderId,
        name: originalName,
        original_name: originalName,
        mime_type: mimeType,
        size: file.size,
        category,
        telegram_msg_id: uploadResult.telegramMsgId,
        telegram_chat_id: uploadResult.telegramChatId,
        file_hash: uploadResult.fileHash || uploadResult.file_hash || null,
        storage_type: uploadResult.storageType,
        local_path: uploadResult.localPath,
        tags: [],
        is_starred: 0,
      });

      // Clean up temporary disk file
      if (file.path && fs.existsSync(file.path) && uploadResult.storageType === 'telegram') {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {}
      }

      uploadedRecords.push(record);
    }

    res.status(201).json({
      success: true,
      message: `${uploadedRecords.length} file(s) uploaded successfully.`,
      files: uploadedRecords,
    });
  } catch (err) {
    console.error('[FileController] uploadFiles error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db.getFileById(id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const streamData = await telegramService.getFileStream(file);

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

    // Fast ETag and Cache-Control for instant browser reuse
    const etag = `"${file.id}-${file.size}-${new Date(file.updated_at || file.created_at).getTime()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    // Return 304 immediately if client already has cached version
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const streamData = await telegramService.getFileStream(file);

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

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'ETag': etag,
        });
        fileStream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'ETag': etag,
        });
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
    const { name, folder_id, is_starred, tags } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = sanitizeFileName(name);
    if (folder_id !== undefined) updates.folder_id = folder_id === 'root' ? null : folder_id;
    if (is_starred !== undefined) updates.is_starred = is_starred ? 1 : 0;
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
        if (file.telegram_msg_id) {
          telegramService.deleteTelegramMessage(file.telegram_msg_id, file.telegram_chat_id).catch(() => {});
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
      if (f.telegram_msg_id) {
        telegramService.deleteTelegramMessage(f.telegram_msg_id, f.telegram_chat_id).catch(() => {});
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
    const stats = await db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
