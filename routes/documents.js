'use strict';

const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  upload,
  handleMulterError,
  uploadDocument,
  listMyDocuments,
  updateDocument,
  downloadDocument,
  deleteDocument,
} = require('../controllers/documentController');

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/mine', isAuthenticated, listMyDocuments);

router.post(
  '/',
  isAuthenticated,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (handleMulterError(err, res)) return;
      return validateBody(bodies.documentMeta)(req, res, next);
    });
  },
  uploadDocument
);

router.get('/:id/download', isAuthenticated, downloadDocument);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.documentMeta), updateDocument);
router.delete('/:id', isAuthenticated, deleteDocument);

module.exports = router;
