const { RateLimiterMemory } = require('rate-limiter-flexible');

// Allgemeine Rate Limits
const generalLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: parseInt(process.env.RATE_LIMIT_MAX) || 100, // Anzahl der Requests
  duration: parseInt(process.env.RATE_LIMIT_WINDOW) / 1000 || 900, // 15 Minuten in Sekunden
});

// Strenge Rate Limits für Auth-Endpunkte
const authLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 5, // 5 Versuche
  duration: 900, // 15 Minuten
});

// OTP Rate Limits
const otpLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.body.phone || req.ip,
  points: 3, // 3 OTP-Anfragen
  duration: 300, // 5 Minuten
});

const createRateLimitMiddleware = (limiter, message = 'Too many requests') => {
  return async (req, res, next) => {
    try {
      await limiter.consume(req.ip);
      next();
    } catch (rejRes) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      res.set('Retry-After', String(secs));
      res.status(429).json({
        success: false,
        error: message,
        retryAfter: secs
      });
    }
  };
};

module.exports = {
  generalRateLimit: createRateLimitMiddleware(generalLimiter),
  authRateLimit: createRateLimitMiddleware(authLimiter, 'Too many authentication attempts'),
  otpRateLimit: createRateLimitMiddleware(otpLimiter, 'Too many OTP requests')
};
