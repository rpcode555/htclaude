// Security Middleware: Strict Firebase ID Token & Admin Whitelist Verification
const path = require('path');
const fs = require('fs');
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

// In-memory bounded LRU-style cache for verified tokens (TTL: 5 minutes)
const MAX_CACHE_ENTRIES = 500;
const tokenCache = new Map();

function getTargetAdminEmail() {
  return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

function pruneTokenCache() {
  const now = Date.now();
  for (const [token, data] of tokenCache.entries()) {
    if (data.expiry <= now) {
      tokenCache.delete(token);
    }
  }
  if (tokenCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey) tokenCache.delete(oldestKey);
  }
}

async function verifyAdminToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;

  const targetAdmin = getTargetAdminEmail();
  if (!targetAdmin) {
    console.error('[Security Alert] ADMIN_EMAIL environment variable is not configured.');
    return null;
  }

  // Check cache
  const cached = tokenCache.get(idToken);
  if (cached && cached.expiry > Date.now()) {
    if (cached.email === targetAdmin) return cached;
    return null;
  }

  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    console.error('[Security Alert] FIREBASE_API_KEY is not configured.');
    return null;
  }

  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
      return null;
    }

    const verifiedUser = verifyData.users[0];
    const userEmail = (verifiedUser.email || '').toLowerCase();

    if (userEmail !== targetAdmin) {
      console.warn(`[Security Alert] Blocked unauthorized user: ${userEmail}`);
      return null;
    }

    const userData = {
      uid: verifiedUser.localId,
      email: userEmail,
      expiry: Date.now() + 5 * 60 * 1000,
    };

    pruneTokenCache();
    tokenCache.set(idToken, userData);
    return userData;
  } catch (err) {
    console.error('[Security] Token verification error:', err.message);
    return null;
  }
}

async function requireAdminAuth(req, res, next) {
  try {
    if (req.method === 'OPTIONS') return next();

    const targetAdmin = getTargetAdminEmail();
    if (!targetAdmin) {
      return res.status(500).json({
        success: false,
        error: 'Server security configuration error: ADMIN_EMAIL is not set in environment.',
      });
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;
    let idToken = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      // Allow token in query parameter for browser downloads / direct media links
      idToken = req.query.token;
    }

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Private storage system. Authentication token is required.',
      });
    }

    const verifiedUser = await verifyAdminToken(idToken);
    if (!verifiedUser) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Access Denied. Invalid token or account not authorized.',
      });
    }

    req.user = verifiedUser;
    next();
  } catch (err) {
    console.error('[Security Middleware Error]:', err.message);
    return res.status(500).json({ success: false, error: 'Internal security verification error.' });
  }
}

module.exports = {
  requireAdminAuth,
  verifyAdminToken,
  getTargetAdminEmail,
};
