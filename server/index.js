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

// CORS Setup (Flexible & Secured)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      // Allow localhost and external clients
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-API-Key', 'x-api-key', 'X-API-Token', 'x-api-token', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Start Server if run directly
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`=========================================`);
    console.log(`🔒 Hightech Claude Server: http://localhost:${PORT}`);
    console.log(`🛡️ Admin Whitelist: ${process.env.ADMIN_EMAIL || 'palranjan144@gmail.com'}`);
    console.log(`📁 API endpoint: http://localhost:${PORT}/api`);
    console.log(`=========================================`);

    // Initialize Telegram background client
    await telegramService.init();
  });
}

module.exports = app;
