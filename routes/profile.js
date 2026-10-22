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

const { validateBody } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();

router.use(isAuthenticated);

router.post('/profile', validateBody(bodies.profile), createProfile);
router.get('/profile', getProfile);
router.put('/profile', validateBody(bodies.profile), updateProfile);
router.get('/badges', getBadges);
router.get('/certificate', getMyCertificate);
router.post('/certificate', validateBody(bodies.empty), issueMyCertificate);

module.exports = router;



