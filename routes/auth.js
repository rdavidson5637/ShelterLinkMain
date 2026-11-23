const express = require('express');
const authController = require('../controllers/authController');
const twoFactorController = require('../controllers/twoFactorController');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const {
  loginLimiter,
  loginAccountLimiter,
  twoFactorAccountLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  forgotAccountLimiter,
  resetPasswordLimiter,
} = require('../middleware/rateLimiter');
const { validateBody, boundedParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('token', boundedParam('token', 128));

function adminRegistrationEnabled(req, res, next) {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_ADMIN_REGISTRATION !== 'true') {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  return next();
}

router.post('/register', registerLimiter, validateBody(bodies.register), authController.register);
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

module.exports = router;
