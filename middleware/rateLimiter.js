const rateLimit = require('express-rate-limit');
const ipKeyGenerator = rateLimit.ipKeyGenerator;

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

const WINDOW_MS = positiveInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);

const LIMITS = {
  login: positiveInt('RATE_LIMIT_LOGIN', 15),
  loginAccount: positiveInt('RATE_LIMIT_LOGIN_ACCOUNT', 5),
  api: positiveInt('RATE_LIMIT_API', 300),
  register: positiveInt('RATE_LIMIT_REGISTER', 8),
  forgotPassword: positiveInt('RATE_LIMIT_FORGOT', 5),
  forgotAccount: positiveInt('RATE_LIMIT_FORGOT_ACCOUNT', 5),
  resetPassword: positiveInt('RATE_LIMIT_RESET', 8),
  message: positiveInt('RATE_LIMIT_MESSAGE', 10),
  groupBooking: positiveInt('RATE_LIMIT_GROUP_BOOKING', 8),
  groupBookingEmail: positiveInt('RATE_LIMIT_GROUP_BOOKING_EMAIL', 3),
  pushTest: positiveInt('RATE_LIMIT_PUSH_TEST', 3),
};

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.login,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Failed attempts for one email from one IP. Another IP is a separate counter.
// The window expires on its own. No staff action is required.
const loginAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.loginAccount,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const ip = ipKeyGenerator(req.ip);
    if (email) return `acct:${email}|${ip}`;
    return ip;
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

const groupBookingEmailLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: LIMITS.groupBookingEmail,
  message: 'Too many group booking requests for this email. Try again tomorrow.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const email = String((req.body && req.body.contact_email) || '')
      .trim()
      .toLowerCase()
      .replace(/[\r\n]/g, '');
    return email ? `group:${email}` : 'group:missing';
  },
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
  groupBookingEmailLimiter,
  messageLimiter,
  pushTestLimiter,
};
