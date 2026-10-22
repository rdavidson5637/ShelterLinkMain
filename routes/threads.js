'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { messageLimiter } = require('../middleware/rateLimiter');
const { auditMutations } = require('../middleware/auditLog');
const {
  listThreads,
  getUnreadCount,
  getThread,
  createThread,
  postMessage,
  deleteMessage,
  markThreadRead,
  muteThread,
} = require('../controllers/threadController');

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));
router.param('messageId', positiveParam('messageId'));

router.use(isAuthenticated);

router.get('/unread-count', getUnreadCount);
router.get('/', listThreads);
router.post('/', messageLimiter, auditMutations, validateBody(bodies.thread), createThread);
router.get('/:id', getThread);
router.post('/:id/messages', messageLimiter, auditMutations, validateBody(bodies.threadMessage), postMessage);
router.delete('/:id/messages/:messageId', auditMutations, deleteMessage);
router.post('/:id/read', validateBody(bodies.empty), markThreadRead);
router.post('/:id/mute', validateBody(bodies.mute), muteThread);

module.exports = router;
