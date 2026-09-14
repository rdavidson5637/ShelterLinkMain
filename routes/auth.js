const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} = require('../middleware/rateLimiter');

function adminRegistrationEnabled(req, res, next) {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_ADMIN_REGISTRATION !== 'true') {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  return next();
}

router.post('/register', registerLimiter, authController.register);
router.post('/register-admin', adminRegistrationEnabled, authController.registerAdmin);
router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', isAuthenticated, authController.getCurrentUser);

router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.get('/reset-password/:token', resetPasswordLimiter, authController.validateResetToken);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);

module.exports = router;
