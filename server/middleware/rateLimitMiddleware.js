// Enterprise Sliding-Window Rate Limiter Middleware (Zero External Dependencies)
// Protects against DoS, brute-force attacks, and abusive API traffic.

const requestBuckets = new Map();
const MAX_BUCKETS = 5000;

// Periodic cleanup of stale IP buckets. unref() keeps importing the server in
// tests/serverless environments from being held open by this housekeeping task.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of requestBuckets.entries()) {
    if (now - bucket.windowStart > 10 * 60 * 1000) {
      requestBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

function getRequestPath(req) {
  let requestPath = typeof req?.path === 'string' ? req.path : '/';
  if ((!requestPath || requestPath === '/') && typeof req?.originalUrl === 'string') {
    requestPath = req.originalUrl.split('?')[0] || '/';
  }

  // /api/files and /files are the same API operation. Normalize the prefix so
  // aliases cannot be used to obtain a fresh rate-limit bucket.
  if (requestPath === '/api') return '/';
  if (requestPath.startsWith('/api/')) requestPath = requestPath.slice(4) || '/';
  return requestPath || '/';
}

function getClientIp(req) {
  return req?.ip || req?.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Create a rate limiter middleware for specific routes.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Max allowed requests per IP/route
 * @param {string} options.message - Error message when rate limit is exceeded
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 100,
  message = 'Too many requests. Please try again shortly.',
} = {}) {
  const limiterWindowMs = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0
    ? Number(windowMs)
    : 60 * 1000;
  const limiterMaxRequests = Number.isFinite(Number(maxRequests)) && Number(maxRequests) > 0
    ? Math.floor(Number(maxRequests))
    : 100;
  const bucketNamespace = `${limiterWindowMs}:${limiterMaxRequests}:${message}`;

  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const clientIp = getClientIp(req);
    const routePath = getRequestPath(req);
    const now = Date.now();
    const bucketKey = `${bucketNamespace}:${clientIp}:${routePath}`;

    if (requestBuckets.size >= MAX_BUCKETS && !requestBuckets.has(bucketKey)) {
      const oldestKey = requestBuckets.keys().next().value;
      if (oldestKey) requestBuckets.delete(oldestKey);
    }

    let bucket = requestBuckets.get(bucketKey);
    if (!bucket || now - bucket.windowStart > limiterWindowMs) {
      bucket = { windowStart: now, count: 1 };
      requestBuckets.set(bucketKey, bucket);
    } else {
      bucket.count += 1;
    }

    const remaining = Math.max(0, limiterMaxRequests - bucket.count);
    const resetTime = Math.max(
      1,
      Math.ceil((bucket.windowStart + limiterWindowMs - now) / 1000)
    );

    res.setHeader('X-RateLimit-Limit', limiterMaxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (bucket.count > limiterMaxRequests) {
      // Never log originalUrl: query strings may contain legacy credentials.
      console.warn(`[Security Alert] Rate limit exceeded for IP: ${clientIp} on ${routePath}`);
      res.setHeader('Retry-After', resetTime);
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: resetTime,
      });
    }

    return next();
  };
}

module.exports = {
  createRateLimiter,
  authLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 150,
    message: 'Too many authentication attempts. Please wait 1 minute before trying again.',
  }),
  uploadLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: 'Upload rate limit reached. Please throttle your uploads.',
  }),
  apiLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 300,
    message: 'API rate limit exceeded. Please reduce request frequency.',
  }),
};
