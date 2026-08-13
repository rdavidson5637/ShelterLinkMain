'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
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

const router = express.Router();

router.get('/mine', isAuthenticated, listMyDocuments);

router.post(
  '/',
  isAuthenticated,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (handleMulterError(err, res)) return;
      return next();
    });
  },
  uploadDocument
);

router.get('/:id/download', isAuthenticated, downloadDocument);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateDocument);
router.delete('/:id', isAuthenticated, deleteDocument);

module.exports = router;
