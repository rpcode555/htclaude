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

// Handle transient GramJS socket reconnect timeouts gracefully
process.on('unhandledRejection', (reason) => {
  if (reason && (reason.message === 'TIMEOUT' || String(reason).includes('TIMEOUT'))) return;
  console.warn('[Server Warning] Unhandled Rejection:', reason?.message || reason);
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

// Global Rate Limiting on API endpoints
app.use('/api', apiLimiter, apiRoutes);

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
  if (req.path.startsWith('/api')) {
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
  const server = app.listen(PORT, '0.0.0.0', async () => {
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
  server.timeout = 0;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 1200000; // 20 minutes
  server.headersTimeout = 1205000;
}

module.exports = app;
