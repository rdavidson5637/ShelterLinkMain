const rateLimit = require('express-rate-limit');
const ipKeyGenerator = rateLimit.ipKeyGenerator;

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const LIMITS = {
  login: 15,
  loginAccount: 5,
  api: 300,
  register: 8,
  forgotPassword: 5,
  forgotAccount: 5,
  resetPassword: 8,
  message: 10,
  groupBooking: 8,
  pushTest: 3,
};

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.login,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Failed attempts against one email, including attempts from many IPs.
const loginAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.loginAccount,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (email) return `acct:${email}`;
    return ipKeyGenerator(req.ip);
  },
});

// General API limit — generous enough for real use, tight enough to block abuse
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: process.env.NODE_ENV === 'test' ? 10000 : LIMITS.api,
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

const forgotAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.forgotAccount,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (email) return `forgot:${email}`;
    return ipKeyGenerator(req.ip);
  },
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

const groupBookingLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.groupBooking,
  message: 'Too many group booking requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const pushTestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: LIMITS.pushTest,
  keyGenerator: (req) => {
    if (req.session && req.session.userId) return `user:${req.session.userId}`;
    return ipKeyGenerator(req.ip || 'anon');
  },
  message: { error: 'Too many test notifications. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
pushTestLimiter.max = LIMITS.pushTest;

module.exports = {
  LIMITS,
  WINDOW_MS,
  loginLimiter,
  loginAccountLimiter,
  apiLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  forgotAccountLimiter,
  resetPasswordLimiter,
  groupBookingLimiter,
  messageLimiter,
  pushTestLimiter,
};
