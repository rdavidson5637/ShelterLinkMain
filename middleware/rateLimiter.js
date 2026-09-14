const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const LIMITS = {
  login: 15,
  api: 300,
  register: 8,
  forgotPassword: 5,
  resetPassword: 8,
  message: 10,
};

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.login,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.api,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.register,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.forgotPassword,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.resetPassword,
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.message,
  message: 'Too many message sends. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  LIMITS,
  WINDOW_MS,
  loginLimiter,
  apiLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  messageLimiter,
};
