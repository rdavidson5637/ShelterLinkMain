const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  createProfile,
  getProfile,
  updateProfile,
  getBadges,
} = require('../controllers/profileController');
const {
  getMyCertificate,
  issueMyCertificate,
} = require('../controllers/certificateController');

const router = express.Router();

router.use(isAuthenticated);

router.post('/profile', createProfile);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.get('/badges', getBadges);
router.get('/certificate', getMyCertificate);
router.post('/certificate', issueMyCertificate);

module.exports = router;



