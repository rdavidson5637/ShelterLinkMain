const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

router.post('/register', authController.register);
router.post('/register-admin', authController.registerAdmin);
router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', isAuthenticated, authController.getCurrentUser);

// Password reset — rate-limited to prevent abuse
router.post('/forgot-password', loginLimiter, authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
