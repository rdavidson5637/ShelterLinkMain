const rateLimit = require('express-rate-limit');
const ipKeyGenerator = rateLimit.ipKeyGenerator;
const { createPgRateLimitStore } = require('./pgRateLimitStore');

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
  invitePage: positiveInt('RATE_LIMIT_INVITE_PAGE', 60),
  inviteCheck: positiveInt('RATE_LIMIT_INVITE_CHECK', 30),
  inviteAccept: positiveInt('RATE_LIMIT_INVITE', 8),
  message: positiveInt('RATE_LIMIT_MESSAGE', 10),
  groupBooking: positiveInt('RATE_LIMIT_GROUP_BOOKING', 8),
  groupBookingEmail: positiveInt('RATE_LIMIT_GROUP_BOOKING_EMAIL', 3),
  pushTest: positiveInt('RATE_LIMIT_PUSH_TEST', 3),
  twoFactorAccount: positiveInt('RATE_LIMIT_2FA_ACCOUNT', 10),
};

// Shared Postgres counters in production so replicas enforce one budget.
// RATE_LIMIT_STORE=postgres enables it elsewhere; =memory forces in-process.
function useSharedStore() {
  const mode = String(process.env.RATE_LIMIT_STORE || '').trim().toLowerCase();
  if (mode === 'memory') return false;
  if (mode === 'postgres' || mode === 'pg') return true;
  return process.env.NODE_ENV === 'production';
}

function storeFor(prefix) {
  if (!useSharedStore()) return undefined;
  return createPgRateLimitStore(prefix);
}

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.login,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: storeFor('rl:login:'),
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
  store: storeFor('rl:login-acct:'),
  keyGenerator(req) {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const ip = ipKeyGenerator(req.ip);
    if (email) return `acct:${email}|${ip}`;
    return ip;
  },
});

// Wrong two-factor codes for one account, from any IP. Keyed on the user
// waiting at the code step (or signed in, for turning 2FA off), so starting a
// fresh password step does not reset the count.
const twoFactorAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.twoFactorAccount,
  message: { error: 'Too many wrong codes. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const pending = req.session && req.session.pendingTwoFactor;
    const userId = (pending && pending.userId) || (req.session && req.session.userId);
    if (userId) return `2fa:${userId}`;
    return ipKeyGenerator(req.ip || 'anon');
  },
});

// General API limit — generous enough for real use, tight enough to block abuse
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: process.env.NODE_ENV === 'test' ? 10000 : LIMITS.api,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:api:'),
});

const registerLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.register,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:register:'),
});

const forgotPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.forgotPassword,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:forgot:'),
});

const forgotAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.forgotAccount,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:forgot-acct:'),
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
  store: storeFor('rl:reset:'),
});

// Invite links. Tokens are 256-bit, so these are about load and noise, not
// guessing. Separate counters so loading the page and checking the link
// (which a person may do several times, or several people behind one NAT)
// never use up the attempts left for actually creating the account.
const invitePageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.invitePage,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:invite-page:'),
});

const inviteCheckLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.inviteCheck,
  message: 'Too many invite checks. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:invite-check:'),
});

const inviteAcceptLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.inviteAccept,
  message: 'Too many invite attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:invite-accept:'),
});

const messageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.message,
  message: 'Too many message sends. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:message:'),
});

const groupBookingLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: LIMITS.groupBooking,
  message: 'Too many group booking requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:group:'),
});

const groupBookingEmailLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: LIMITS.groupBookingEmail,
  message: 'Too many group booking requests for this email. Try again tomorrow.',
  standardHeaders: true,
  legacyHeaders: false,
  store: storeFor('rl:group-email:'),
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
  store: storeFor('rl:push-test:'),
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
  useSharedStore,
  loginLimiter,
  loginAccountLimiter,
  twoFactorAccountLimiter,
  apiLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  forgotAccountLimiter,
  resetPasswordLimiter,
  invitePageLimiter,
  inviteCheckLimiter,
  inviteAcceptLimiter,
  groupBookingLimiter,
  groupBookingEmailLimiter,
  messageLimiter,
  pushTestLimiter,
};
