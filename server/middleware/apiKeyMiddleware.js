// Middleware to validate Developer API Keys (htc_live_...) for universal external integrations
const { db } = require('../db');

async function requireApiKey(req, res, next) {
  try {
    let rawKey = req.headers['x-api-key'] || req.headers['x-api-token'];

    if (!rawKey) {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token.startsWith('htc_live_')) {
          rawKey = token;
        }
      }
    }

    if (!rawKey && req.query) {
      rawKey = req.query.api_key || req.query.key;
    }

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing API Key. Provide "X-API-Key: htc_live_..." header.',
        documentation: 'https://github.com/hightech-claude/api-docs',
      });
    }

    const apiKeyRecord = await db.getApiKeyByKey(rawKey.trim());

    if (!apiKeyRecord) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid API Key.',
      });
    }

    if (apiKeyRecord.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: This API Key has been revoked or deactivated.',
      });
    }

    // Check expiration date
    if (apiKeyRecord.expires_at && new Date(apiKeyRecord.expires_at) < new Date()) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: This API Key expired on ${new Date(apiKeyRecord.expires_at).toLocaleDateString()}. Please generate a new key.`,
      });
    }

    // Attach API key record to request
    req.apiKey = apiKeyRecord;
    next();
  } catch (err) {
    console.error('[API Key Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Internal API Key verification failure.' });
  }
}

module.exports = { requireApiKey };
