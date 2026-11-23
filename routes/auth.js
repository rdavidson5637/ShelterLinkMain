const express = require('express');
const authController = require('../controllers/authController');
const twoFactorController = require('../controllers/twoFactorController');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const {
  loginLimiter,
  loginAccountLimiter,
  twoFactorAccountLimiter,
  registerLimiter,
  registerEmailLimiter,
  forgotPasswordLimiter,
  forgotAccountLimiter,
  resetPasswordLimiter,
  inviteCheckLimiter,
  inviteAcceptLimiter,
} = require('../middleware/rateLimiter');
const { validateBody, boundedParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');
const inviteController = require('../controllers/inviteController');
const sessionsController = require('../controllers/sessionsController');

const router = express.Router();
router.param('token', boundedParam('token', 128));

function adminRegistrationEnabled(req, res, next) {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_ADMIN_REGISTRATION !== 'true') {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  return next();
}

router.post(
  '/register',
  registerEmailLimiter,
  registerLimiter,
  validateBody(bodies.register),
  authController.register
);
router.post('/register-admin', adminRegistrationEnabled, validateBody(bodies.registerAdmin), authController.registerAdmin);
router.post('/login', loginAccountLimiter, loginLimiter, validateBody(bodies.login), authController.login);

// Two-factor sign-in (SL-NEXT-06). verify runs between password and session,
// so it is not behind isAuthenticated; the other four are for signed-in staff/admin.
router.post(
  '/2fa/verify',
  twoFactorAccountLimiter,
  loginLimiter,
  validateBody(bodies.twoFactorVerify),
  authController.verifyTwoFactor
);
router.get('/2fa', requireStaff, twoFactorController.status);
router.post('/2fa/setup', requireStaff, loginLimiter, validateBody(bodies.twoFactorSetup), twoFactorController.setup);
router.post('/2fa/enable', requireStaff, twoFactorAccountLimiter, validateBody(bodies.twoFactorEnable), twoFactorController.enable);
router.post(
  '/2fa/disable',
  requireStaff,
  twoFactorAccountLimiter,
  validateBody(bodies.twoFactorDisable),
  twoFactorController.disable
);

router.post('/logout', validateBody(bodies.empty), authController.logout);
router.post('/logout-all', isAuthenticated, validateBody(bodies.empty), authController.logoutAll);
router.get('/me', isAuthenticated, authController.getCurrentUser);

// Signed-in devices (SL-LATER-33). Own sessions only; ids are opaque handles.
router.get('/sessions', isAuthenticated, sessionsController.listSessions);
router.post(
  '/sessions/revoke-others',
  isAuthenticated,
  validateBody(bodies.empty),
  sessionsController.revokeOtherSessions
);
router.delete('/sessions/:id', isAuthenticated, sessionsController.revokeSession);
router.post(
  '/change-password',
  isAuthenticated,
  loginLimiter,
  validateBody(bodies.changePassword),
  sessionsController.changePassword
);
router.get('/memberships', isAuthenticated, authController.listMyMemberships);
router.post(
  '/privacy-notice',
  isAuthenticated,
  validateBody(bodies.privacyNotice),
  authController.acknowledgePrivacyNotice
);

// Separate limiter so failed logins cannot masquerade as reset-path errors.
router.post('/forgot-password', forgotAccountLimiter, forgotPasswordLimiter, validateBody(bodies.forgot), authController.forgotPassword);
router.get('/reset-password/:token', resetPasswordLimiter, authController.validateResetToken);
router.post('/reset-password', resetPasswordLimiter, validateBody(bodies.reset), authController.resetPassword);

// One-time shelter invites (admin or staff). Signed out; the shelter, email
// and role all come from the invite row.
// The token travels in the POST body only, never in a URL, so it stays out
// of access logs, proxies and Referer headers.
router.post('/invite/check', inviteCheckLimiter, validateBody(bodies.inviteCheck), inviteController.checkInvite);
router.post('/accept-invite', inviteAcceptLimiter, validateBody(bodies.acceptInvite), inviteController.acceptInvite);

module.exports = router;
