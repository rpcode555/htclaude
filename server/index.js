const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env reliably from server directory or root
const serverEnvPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '../.env');
if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const apiRoutes = require('./routes/api');
const telegramService = require('./services/telegramService');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;
let httpServer = null;
let shuttingDown = false;

function terminateAfterFatalError(kind, error) {
  console.error(`[Server Fatal] ${kind}:`, error);
  process.exitCode = 1;
  if (shuttingDown) return;
  shuttingDown = true;

  // Do not silently continue after an unknown exception: the process may be in
  // an inconsistent state. Close the listener first, then terminate. The
  // timeout prevents a stuck long-lived upload from blocking shutdown forever.
  const forceExitTimer = setTimeout(() => process.exit(1), 5000);
  forceExitTimer.unref?.();
  const finishShutdown = () => {
    clearTimeout(forceExitTimer);
    process.exit(1);
  };

  if (httpServer) {
    try {
      httpServer.close(finishShutdown);
      return;
    } catch (error) {
      console.error('[Server Fatal] Error while closing HTTP server:', error);
    }
  }

  setImmediate(finishShutdown);
}

// Never swallow an uncaught exception or an unhandled rejection. Previously a
// small set of Telegram/library messages were silently ignored, which could
// leave the API serving requests after process state had already diverged.
process.on('uncaughtException', (error) => {
  terminateAfterFatalError('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason) => {
  terminateAfterFatalError('Unhandled Rejection', reason);
});

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// CORS Configuration with strict origin verification
const allowedOrigins = [
  process.env.APP_URL,
  process.env.CUSTOM_DOMAIN ? (process.env.CUSTOM_DOMAIN.startsWith('http') ? process.env.CUSTOM_DOMAIN : `https://${process.env.CUSTOM_DOMAIN}`) : null,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      // Check whitelist or same-origin
      if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        return callback(null, true);
      }
      // Disallow all other origins
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-API-Key', 'x-api-key', 'X-API-Token', 'x-api-token', 'X-Telegram-Session', 'x-telegram-session', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const DIRECT_API_PREFIXES = ['/folders', '/files', '/auth', '/developer', '/stats', '/v1', '/config'];

function matchesPathPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isDirectApiPath(pathname) {
  return DIRECT_API_PREFIXES.some((prefix) => matchesPathPrefix(pathname, prefix));
}

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, '/api') || isDirectApiPath(pathname);
}

// Apply one API limiter to every supported API spelling. Previously only
// /api was limited; /v1 and the direct-prefix fallbacks could be used to evade
// the limit entirely.
app.use((req, res, next) => {
  if (isApiPath(req.path)) return apiLimiter(req, res, next);
  return next();
});

app.use('/api', apiRoutes);

// Support serverless environments where Vercel rewrite might strip /api prefix
app.use((req, res, next) => {
  if (isDirectApiPath(req.path)) return apiRoutes(req, res, next);
  return next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Hightech Claude API',
    security: 'Zero-Trust Protected & Hardened',
    timestamp: new Date().toISOString(),
  });
});

// Serve frontend static files if built
const clientDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
}

// Fallback handler for SPA
app.use((req, res) => {
  if (matchesPathPrefix(req.path, '/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexHtml = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Hightech Claude Server</title></head>
        <body style="font-family: system-ui; background: #060911; color: #f8fafc; padding: 50px; text-align: center;">
          <h1 style="color: #38bdf8;">🔒 Hightech Claude Private API Server</h1>
          <p style="color: #94a3b8;">Protected with Firebase ID token verification and Telegram cloud integration.</p>
        </body>
      </html>
    `);
  }
});

// Start Server if run directly (Local development / dedicated server)
if (require.main === module && !process.env.VERCEL) {
  httpServer = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`=========================================`);
    console.log(`🔒 Hightech Claude Server: http://localhost:${PORT}`);
    console.log(`🛡️ Admin Whitelist: ${process.env.ADMIN_EMAIL || 'Not configured'}`);
    console.log(`📁 API endpoint: http://localhost:${PORT}/api`);
    console.log(`🚀 Unlimited File Size & Chunking: Enabled`);
    console.log(`=========================================`);

    // Initialize Telegram background client
    await telegramService.init();
  });

  // Remove socket timeout for unlimited multi-GB file uploads/downloads
  httpServer.timeout = 0;
  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 1200000; // 20 minutes
  httpServer.headersTimeout = 1205000;
}

module.exports = app;
