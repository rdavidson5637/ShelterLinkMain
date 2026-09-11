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

const router = express.Router();

router.use(isAuthenticated);

router.get('/unread-count', getUnreadCount);
router.get('/', listThreads);
router.post('/', messageLimiter, auditMutations, createThread);
router.get('/:id', getThread);
router.post('/:id/messages', messageLimiter, auditMutations, postMessage);
router.delete('/:id/messages/:messageId', auditMutations, deleteMessage);
router.post('/:id/read', markThreadRead);
router.post('/:id/mute', muteThread);

module.exports = router;
