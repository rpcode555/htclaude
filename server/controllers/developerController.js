const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db, detectCategory } = require('../db');
const telegramService = require('../services/telegramService');

const { UPLOADS_DIR, isSafePath } = require('../config/paths');
const { verifyAdminToken } = require('../middleware/authMiddleware');

function sanitizeFileName(name) {
  if (!name) return 'image_' + Date.now();
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

    if (safeMediaExts.includes(ext) && (isMZ || isELF)) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
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

      if (!validateMagicBytes(file.path, originalName)) {
        console.warn(`[Security Alert] Rejected API upload with mismatched executable signature: ${originalName}`);
        continue;
      }

      const mimeType = file.mimetype || mime.lookup(originalName) || 'application/octet-stream';
      const category = detectCategory(mimeType, originalName);

      // Upload directly to Telegram Saved Messages
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
        telegram_chunk_ids: uploadResult.telegramChunkIds || null,
        is_chunked: uploadResult.isChunked || false,
        total_parts: uploadResult.totalParts || 1,
        telegram_chat_id: uploadResult.telegramChatId,
        file_hash: uploadResult.fileHash || uploadResult.file_hash || null,
        storage_type: uploadResult.storageType,
        local_path: uploadResult.localPath,
        api_key_id: req.apiKey.id,
        tags: ['api', req.apiKey.id, req.apiKey.name],
        is_starred: 0,
      });

      // Clean up temporary disk file
      if (file.path && fs.existsSync(file.path)) {
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

    // Verify access: Admin auth, OR developer upload (api_key_id), OR explicitly shared
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

    const isPublicAsset = !!file.api_key_id;
    const isShared = (file.is_shared === 1 || file.is_shared === true) && !file.is_trash;

    if (!isAuthorized && !isPublicAsset && !isShared) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Private file is not shared.' });
    }

    // XSS Protection for executable MIME types (HTML, XHTML, SVG)
    const isExecutableMime = ['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(file.mime_type);
    const cspHeader = "sandbox allow-scripts allow-forms; default-src 'self' data:; style-src 'self' 'unsafe-inline'";
    if (isExecutableMime) {
      res.setHeader('Content-Security-Policy', cspHeader);
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

    // Support HTTP 206 Partial Content Range Requests for Video / Audio directly on in-memory buffer
    if (streamData.type === 'buffer' && streamData.buffer) {
      const buffer = streamData.buffer;
      const fileSize = buffer.length;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        const headers = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        };
        if (isExecutableMime) headers['Content-Security-Policy'] = cspHeader;

        res.writeHead(206, headers);
        res.end(buffer.slice(start, end + 1));
        return;
      }

      if (isExecutableMime) res.setHeader('Content-Security-Policy', cspHeader);
      return res.send(buffer);
    }

    if (streamData.type === 'stream') {
      streamData.stream.pipe(res);
      return;
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

    const isPublicAsset = !!file.api_key_id;
    const isShared = (file.is_shared === 1 || file.is_shared === true) && !file.is_trash;

    if (!isAuthorized && !isPublicAsset && !isShared) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Private file is not shared.' });
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
