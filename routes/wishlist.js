'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');
const {
  listWishlist,
  createWishlistItem,
  updateWishlistItem,
  archiveWishlistItem,
} = require('../controllers/wishlistController');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get(
  '/',
  isAuthenticated,
  requireStaff,
  validateQuery(queries.shelterWishlist),
  listWishlist
);

router.post(
  '/',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterWishlistCreate),
  createWishlistItem
);

router.put(
  '/:id',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterWishlistUpdate),
  updateWishlistItem
);

router.post(
  '/:id/archive',
  isAuthenticated,
  requireStaff,
  auditMutations,
  archiveWishlistItem
);

module.exports = router;
