const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  createProfile,
  getProfile,
  updateProfile,
  getBadges,
} = require('../controllers/profileController');

const router = express.Router();

router.use(isAuthenticated);

router.post('/profile', createProfile);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.get('/badges', getBadges);

module.exports = router;



