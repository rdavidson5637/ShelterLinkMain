const express = require('express');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  listPublicOpportunities,
  publicOpportunitiesIcs,
} = require('../controllers/publicController');
const {
  getPublicReference,
  getPublicReferenceLogo,
  submitPublicReference,
} = require('../controllers/vettingController');
const { verifyCertificate } = require('../controllers/certificateController');
const { getPublicConfig, getDemoInfo } = require('../controllers/publicConfigController');
const { getBrand, getBrandLogo } = require('../controllers/brandController');

const router = express.Router();

// Generous public rate limit already covered by apiLimiter; keep routes open.
router.get('/config', apiLimiter, getPublicConfig);
router.get('/brand', apiLimiter, getBrand);
router.get('/brand/logo', apiLimiter, getBrandLogo);
router.get('/demo-info', apiLimiter, getDemoInfo);
router.get('/opportunities', apiLimiter, listPublicOpportunities);
router.get('/opportunities.ics', apiLimiter, publicOpportunitiesIcs);
router.get('/references/:token/logo', apiLimiter, getPublicReferenceLogo);
router.get('/references/:token', apiLimiter, getPublicReference);
router.post('/references/:token', apiLimiter, submitPublicReference);
router.get('/verify-certificate/:code', apiLimiter, verifyCertificate);

module.exports = router;
