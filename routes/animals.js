'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  upload,
  handleMulterError,
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  uploadPhoto,
  getPhoto,
  logActivity,
  myHelpedAnimals,
} = require('../controllers/animalController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/me/helped', isAuthenticated, myHelpedAnimals);
router.get('/', isAuthenticated, requireStaff, validateQuery(queries.animals), listAnimals);
router.post('/', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.animal), createAnimal);
router.get('/:id', isAuthenticated, getAnimal);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.animal), updateAnimal);
router.get('/:id/photo', isAuthenticated, getPhoto);
router.post(
  '/:id/photo',
  isAuthenticated,
  requireStaff,
  auditMutations,
  (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
      if (handleMulterError(err, res)) return;
      return validateBody(bodies.empty)(req, res, next);
    });
  },
  uploadPhoto
);
router.post('/:id/activity', isAuthenticated, validateBody(bodies.animalActivity), logActivity);

module.exports = router;
