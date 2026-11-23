'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');
const {
  upload,
  handleMulterError,
  listResources,
  createLink,
  createFile,
  updateResource,
  deleteResource,
  downloadResource,
} = require('../controllers/resourceLibraryController');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get(
  '/',
  isAuthenticated,
  validateQuery(queries.shelterResources),
  listResources
);

router.post(
  '/links',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterResourceLink),
  createLink
);

router.post(
  '/files',
  isAuthenticated,
  requireStaff,
  auditMutations,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (handleMulterError(err, res)) return;
      return validateBody(bodies.shelterResourceFileMeta)(req, res, next);
    });
  },
  createFile
);

router.get('/:id/download', isAuthenticated, downloadResource);

router.put(
  '/:id',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterResourceUpdate),
  updateResource
);

router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteResource);

module.exports = router;
