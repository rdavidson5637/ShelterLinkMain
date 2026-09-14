const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Strict limit for login — prevents brute-force attacks
const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 15, // 15 attempts per 15 minutes per IP
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
});

const forgotPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limit — generous enough for real use, tight enough to block abuse
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 300, // 300 requests per 15 minutes per IP
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Bulk messaging — protect SMTP account
const messageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: 'Too many message sends. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  apiLimiter,
  forgotPasswordLimiter,
  messageLimiter,
};
