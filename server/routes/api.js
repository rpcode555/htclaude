const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const authController = require('../controllers/authController');
const folderController = require('../controllers/folderController');
const fileController = require('../controllers/fileController');
const developerController = require('../controllers/developerController');
const { requireAdminAuth } = require('../middleware/authMiddleware');
const { requireApiKey } = require('../middleware/apiKeyMiddleware');
const { authLimiter, uploadLimiter } = require('../middleware/rateLimitMiddleware');

const { TEMP_UPLOAD_DIR } = require('../config/paths');

// Multer storage setup for temporary upload handling
try {
  if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  }
} catch (e) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2000 * 1024 * 1024, // 2GB limit per file (Telegram standard)
  },
});

// --- Public Firebase Config (Served dynamically from backend environment) ---
router.get('/config/firebase', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
  });
});

// =========================================================================
// UNIVERSAL DEVELOPER API (v1) - Use Anywhere with X-API-Key or Public CDN
// =========================================================================

// 1. Universal Upload Endpoint (Protected by X-API-Key: htc_live_...)
router.post(
  '/v1/upload',
  uploadLimiter,
  requireApiKey,
  upload.any(),
  developerController.uploadViaApiKey
);

// 2. Public Direct Image Delivery / CDN Stream (Zero Auth Required - Embed directly in <img src="...">)
router.get('/v1/raw/:id', developerController.serveRawFile);
router.get('/v1/image/:id', developerController.serveRawFile);
router.get('/v1/download/:id', developerController.downloadRawFile);

// =========================================================================
// DEVELOPER API KEYS MANAGEMENT (Protected by Firebase Admin Authentication)
// =========================================================================
router.get('/developer/keys', requireAdminAuth, developerController.getApiKeys);
router.post('/developer/keys', requireAdminAuth, developerController.createApiKey);
router.get('/developer/keys/:id/files', requireAdminAuth, developerController.getApiKeyFiles);
router.patch('/developer/keys/:id', requireAdminAuth, developerController.updateApiKey);
router.delete('/developer/keys/:id', requireAdminAuth, developerController.deleteApiKey);

// =========================================================================
// CORE APP PROTECTED ROUTES (Protected by Firebase Admin Authentication)
// =========================================================================
router.get('/auth/status', requireAdminAuth, authController.getStatus);
router.post('/auth/send-code', authLimiter, requireAdminAuth, authController.sendCode);
router.post('/auth/verify-code', authLimiter, requireAdminAuth, authController.verifyCode);
router.post('/auth/bot-connect', authLimiter, requireAdminAuth, authController.botConnect);
router.post('/auth/disconnect', requireAdminAuth, authController.disconnect);
router.post('/auth/settings', requireAdminAuth, authController.updateSettings);

// --- Folders (Protected) ---
router.get('/folders', requireAdminAuth, folderController.getFolders);
router.post('/folders', requireAdminAuth, folderController.createFolder);
router.patch('/folders/:id', requireAdminAuth, folderController.updateFolder);
router.delete('/folders/:id', requireAdminAuth, folderController.deleteFolder);
router.post('/folders/:id/restore', requireAdminAuth, folderController.restoreFolder);

// --- Files (Protected) ---
router.get('/files', requireAdminAuth, fileController.listFiles);
router.get('/files/:id', requireAdminAuth, fileController.getFile);
router.post('/files/upload', uploadLimiter, requireAdminAuth, upload.any(), fileController.uploadFiles);
router.get('/files/:id/download', requireAdminAuth, fileController.downloadFile);
router.get('/files/:id/stream', fileController.streamFile);
router.patch('/files/:id', requireAdminAuth, fileController.updateFile);
router.delete('/files/:id/trash', requireAdminAuth, fileController.trashFile);
router.post('/files/:id/restore', requireAdminAuth, fileController.restoreFile);
router.delete('/files/:id', requireAdminAuth, fileController.deleteFile);
router.delete('/files/trash/empty', requireAdminAuth, fileController.emptyTrash);
router.post('/files/batch', requireAdminAuth, fileController.batchAction);

// --- Stats (Protected) ---
router.get('/stats', requireAdminAuth, fileController.getStats);

module.exports = router;
