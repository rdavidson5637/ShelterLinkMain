'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  seedStarterItems,
  getMyProgress,
} = require('../controllers/inductionChecklistController');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/me', isAuthenticated, getMyProgress);
router.get('/items', isAuthenticated, requireStaff, validateQuery(queries.inductionItems), listItems);
router.post(
  '/items/starter',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  seedStarterItems
);
router.post(
  '/items',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.inductionItem),
  createItem
);
router.put(
  '/items/:id',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.inductionItem),
  updateItem
);
router.delete('/items/:id', isAuthenticated, requireStaff, auditMutations, deleteItem);

module.exports = router;
