const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory } = require('../db');
const telegramService = require('../services/telegramService');

const { UPLOADS_DIR, isSafePath } = require('../config/paths');

function sanitizeFileName(name) {
  if (!name) return 'image_' + Date.now();
  return name.replace(/[\/\?<>\\:\*\|":]/g, '_').replace(/\.\./g, '_').trim();
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
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${protocol}://${host}`;
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
    const { name, purpose, validity } = req.body;
    const newKey = await db.createApiKey({
      name: name || 'Website API Key',
      purpose: purpose || 'web',
      validity: validity || 'never',
    });
    res.status(201).json({
      success: true,
      message: 'API Key generated successfully.',
      key: newKey,
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

    const files = await db.getFilesByApiKeyId(id);
    const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

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
    const { name, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (status !== undefined && ['active', 'revoked'].includes(status)) updates.status = status;

    const updated = await db.updateApiKey(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API Key not found.' });
    }

    // If API key is renamed, sync the corresponding folder name
    if (name !== undefined && updated.folder_id) {
      await db.updateFolder(updated.folder_id, { name: name.trim() });
    }

    res.json({ success: true, key: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteApiKey(id);
    res.json({ success: true, message: 'API Key deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// --- Universal Developer API: Upload File / Image (POST /api/v1/upload) ---
exports.uploadViaApiKey = async (req, res) => {
  try {
    const rawFiles = req.files || (req.file ? [req.file] : []);
    if (rawFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file provided. Attach a file using field name "file" or "image" in multipart/form-data.',
      });
    }

    const baseUrl = getBaseUrl(req);
    const uploadedFiles = [];

    // Automatically get or create the dedicated folder with the same name as the API Key
    const apiKeyFolder = await db.getOrCreateApiKeyFolder(req.apiKey);
    const targetFolderId = apiKeyFolder ? apiKeyFolder.id : null;

    for (const file of rawFiles) {
      const rawName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const originalName = sanitizeFileName(rawName);
      const mimeType = file.mimetype || mime.lookup(originalName) || 'application/octet-stream';
      const category = detectCategory(mimeType, originalName);

      // Upload directly to Telegram Storage Channel
      const uploadResult = await telegramService.uploadFile({
        originalName,
        buffer: file.buffer,
        filePath: file.path,
        mimeType,
        size: file.size,
      });

      // Insert record into DB with api_key_id and folder_id automatically assigned
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
        api_key_id: req.apiKey.id,
        tags: ['api', req.apiKey.id, req.apiKey.name],
        is_starred: 0,
      });

      // Clean up temporary disk file if stored on Telegram
      if (file.path && fs.existsSync(file.path) && uploadResult.storageType === 'telegram') {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {}
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
          html: `<img src="${directUrl}" alt="${record.name}" />`,
          markdown: `![${record.name}](${directUrl})`,
        },
        created_at: record.created_at,
      });
    }

    // Update API Key usage counter & last used timestamp
    await db.incrementApiKeyUsage(req.apiKey.id);

    res.status(201).json({
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
    });
  } catch (err) {
    console.error('[DeveloperController] uploadViaApiKey error:', err);
    res.status(500).json({ success: false, error: err.message });
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

    const streamData = await telegramService.getFileStream(file);

    // Global Public CORS & High-Performance Caching
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (streamData.size) {
      res.setHeader('Content-Length', streamData.size);
    }

    // Support HTTP 206 Partial Content Range Requests for Video / Audio
    if (streamData.localPath && fs.existsSync(streamData.localPath) && isSafePath(streamData.localPath)) {
      const stat = fs.statSync(streamData.localPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(streamData.localPath, { start, end }).pipe(res);
        return;
      }
    }

    if (streamData.type === 'stream') {
      streamData.stream.pipe(res);
    } else if (streamData.type === 'buffer') {
      res.send(streamData.buffer);
    }
  } catch (err) {
    console.error('[DeveloperController] serveRawFile error:', err);
    res.status(500).json({ success: false, error: err.message });
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

    const streamData = await telegramService.getFileStream(file);

    res.setHeader('Access-Control-Allow-Origin', '*');
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
    console.error('[DeveloperController] downloadRawFile error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
