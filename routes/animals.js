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

const router = express.Router();

router.get('/me/helped', isAuthenticated, myHelpedAnimals);
router.get('/', isAuthenticated, requireStaff, listAnimals);
router.post('/', isAuthenticated, requireStaff, auditMutations, createAnimal);
router.get('/:id', isAuthenticated, getAnimal);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateAnimal);
router.get('/:id/photo', isAuthenticated, getPhoto);
router.post(
  '/:id/photo',
  isAuthenticated,
  requireStaff,
  auditMutations,
  (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
      if (handleMulterError(err, res)) return;
      return next();
    });
  },
  uploadPhoto
);
router.post('/:id/activity', isAuthenticated, logActivity);

module.exports = router;
