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

const {
  getMyAgeStatus,
  giveMyGuardianConsent,
} = require('../controllers/guardianConsentController');

const { validateBody } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();

router.use(isAuthenticated);

router.post('/profile', validateBody(bodies.profile), createProfile);
router.get('/profile', getProfile);
router.put('/profile', validateBody(bodies.profile), updateProfile);
router.get('/profile/age', getMyAgeStatus);
router.post('/profile/guardian-consent', validateBody(bodies.guardianConsent), giveMyGuardianConsent);
router.get('/badges', getBadges);
router.get('/certificate', getMyCertificate);
router.post('/certificate', validateBody(bodies.empty), issueMyCertificate);

module.exports = router;



