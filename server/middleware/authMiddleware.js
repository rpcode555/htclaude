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

const tokenCache = new Map(); // In-memory cache for valid tokens (TTL: 5 minutes) to avoid network overhead

function getTargetAdminEmail() {
  return (process.env.ADMIN_EMAIL || 'palranjan144@gmail.com').toLowerCase();
}

async function requireAdminAuth(req, res, next) {
  try {
    if (req.method === 'OPTIONS') return next();

    const targetAdmin = getTargetAdminEmail();
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let idToken = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      // Support secure download links with token parameter
      idToken = req.query.token;
    }

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Private storage system. Authentication token is required.',
      });
    }

    // Check fast cache
    const cached = tokenCache.get(idToken);
    if (cached && cached.expiry > Date.now() && (!targetAdmin || cached.email === targetAdmin)) {
      req.user = cached;
      return next();
    }

    // Cryptographic verification via Google Identity Toolkit
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: FIREBASE_API_KEY is not configured.',
      });
    }

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
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or expired authentication token.',
      });
    }

    const verifiedUser = verifyData.users[0];
    const userEmail = (verifiedUser.email || '').toLowerCase();

    // Strict Admin Email Whitelist check
    if (userEmail !== targetAdmin) {
      console.warn(`[Security Alert] Blocked unauthorized access attempt by: ${userEmail}`);
      return res.status(403).json({
        success: false,
        error: `Forbidden: Access Denied. Only ${targetAdmin} is authorized.`,
      });
    }

    // Cache valid token for 5 minutes
    tokenCache.set(idToken, {
      uid: verifiedUser.localId,
      email: userEmail,
      expiry: Date.now() + 5 * 60 * 1000,
    });

    req.user = verifiedUser;
    next();
  } catch (err) {
    console.error('[Security Middleware Error]:', err.message);
    return res.status(500).json({ success: false, error: 'Internal security verification error.' });
  }
}

module.exports = {
  requireAdminAuth,
  getTargetAdminEmail,
};
