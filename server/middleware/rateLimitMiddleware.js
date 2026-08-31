// Enterprise Sliding-Window Rate Limiter Middleware (Zero External Dependencies)
// Protects against DoS, brute-force attacks, and abusive API traffic

const requestBuckets = new Map();

// Periodic cleanup of stale IP buckets every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of requestBuckets.entries()) {
    if (now - bucket.windowStart > 10 * 60 * 1000) {
      requestBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate limiter middleware for specific routes
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (e.g. 60000 = 1 minute)
 * @param {number} options.maxRequests - Max allowed requests per IP in that window
 * @param {string} options.message - Error message when rate limit is exceeded
 */
function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 100, message = 'Too many requests. Please try again shortly.' } = {}) {
  return (req, res, next) => {
    // Determine client IP reliably (supports Cloudflare, Vercel, Nginx proxies)
    const clientIp =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const now = Date.now();
    const bucketKey = `${clientIp}:${req.baseUrl || req.path}`;

    let bucket = requestBuckets.get(bucketKey);

    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = {
        windowStart: now,
        count: 1,
      };
      requestBuckets.set(bucketKey, bucket);
    } else {
      bucket.count += 1;
    }

    // Set standard rate limit headers
    const remaining = Math.max(0, maxRequests - bucket.count);
    const resetTime = Math.ceil((bucket.windowStart + windowMs - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (bucket.count > maxRequests) {
      console.warn(`[Security Alert] Rate limit exceeded for IP: ${clientIp} on ${req.originalUrl}`);
      res.setHeader('Retry-After', resetTime);
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: resetTime,
      });
    }

    next();
  };
}

module.exports = {
  createRateLimiter,
  authLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
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
