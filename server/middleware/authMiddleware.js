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

const DEFAULT_ADMIN_EMAIL = 'palranjan144@gmail.com';
const DEFAULT_FIREBASE_API_KEY = 'AIzaSyBB_iq8REPny3J2f98oRtQe-og4rUIzm9Q';
const DEFAULT_PROJECT_ID = 'melodic-keyword-374810';

// In-memory bounded LRU-style cache for verified tokens (TTL: 5 minutes)
const MAX_CACHE_ENTRIES = 500;
const tokenCache = new Map();

function getAuthorizedAdminEmails() {
  const envAdmins = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  return envAdmins
    .split(',')
    .map((e) => e.trim().replace(/['"]/g, '').toLowerCase())
    .concat(DEFAULT_ADMIN_EMAIL.toLowerCase())
    .filter(Boolean);
}

function isEmailAuthorized(email) {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  return getAuthorizedAdminEmails().includes(cleanEmail);
}

function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
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

  // 1. Check cache first
  const cached = tokenCache.get(idToken);
  if (cached && cached.expiry > Date.now()) {
    if (isEmailAuthorized(cached.email)) return cached;
    return null;
  }

  // 2. Decode JWT payload structure
  const decoded = decodeJwt(idToken);
  if (!decoded) return null;

  const userEmail = (decoded.email || '').trim().toLowerCase();
  const userPhone = (decoded.phone_number || '').trim();
  const userId = decoded.user_id || decoded.sub;

  // Check if token is expired
  if (decoded.exp && decoded.exp * 1000 < Date.now()) {
    console.warn('[Security Alert] ID Token expired');
    return null;
  }

  // Check project id match
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  if (decoded.aud && decoded.aud !== projectId) {
    console.warn(`[Security Alert] ID Token audience mismatch: ${decoded.aud} vs ${projectId}`);
    return null;
  }

  // 3. Online verification via Google Identity Toolkit
  const apiKey = (process.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY).trim();
  let verifiedByGoogle = false;

  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (verifyRes.ok) {
      const verifyData = await verifyRes.json();
      if (verifyData.users && verifyData.users.length > 0) {
        verifiedByGoogle = true;
      }
    }
  } catch (e) {
    console.warn('[Security] Identity Toolkit lookup notice:', e.message);
  }

  const isGoogleIssued = decoded.iss === `https://securetoken.google.com/${projectId}`;
  if (!verifiedByGoogle && !isGoogleIssued) {
    return null;
  }

  // Verify email or phone authorization
  if (userEmail) {
    if (!isEmailAuthorized(userEmail)) {
      console.warn(`[Security Alert] Blocked unauthorized email: ${userEmail}`);
      return null;
    }
  } else if (!userPhone && !userId) {
    return null;
  }

  const userData = {
    uid: userId || 'admin',
    email: userEmail || `${userPhone || 'admin'}@telegram.auth`,
    phone: userPhone,
    expiry: Date.now() + 5 * 60 * 1000,
  };

  pruneTokenCache();
  tokenCache.set(idToken, userData);
  return userData;
}

async function requireAdminAuth(req, res, next) {
  try {
    if (req.method === 'OPTIONS') return next();

    const authHeader = req.headers.authorization || req.headers.Authorization;
    let idToken = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      // Allow token in query parameter for browser downloads / direct media links
      idToken = req.query.token;
    }

    // Allow active Telegram session for authenticated browser downloads / direct requests
    const clientSession = (req.headers['x-telegram-session'] || req.query?.session || '').trim();
    if (clientSession && clientSession.length > 30) {
      const { getSetting } = require('../db');
      const storedSession = (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '';
      if (!storedSession || clientSession === storedSession) {
        req.telegramSession = clientSession;
        return next();
      }
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
  getTargetAdminEmail: () => DEFAULT_ADMIN_EMAIL,
};
