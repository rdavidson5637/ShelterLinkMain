const express = require('express');
const { isAuthenticated, requireStaff, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  createOpportunity,
  getAllOpportunities,
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
  cloneOpportunity,
  flagOpportunityUrgent,
} = require('../controllers/opportunityController');
const {
  listNotes,
  createNote,
  deleteNote,
} = require('../controllers/shiftNoteController');

const router = express.Router();

router.post('/', isAuthenticated, requireStaff, auditMutations, createOpportunity);
router.get('/', isAuthenticated, getAllOpportunities);
router.get('/:id/notes', isAuthenticated, listNotes);
router.post('/:id/notes', isAuthenticated, requireStaff, auditMutations, createNote);
router.delete('/:id/notes/:noteId', isAuthenticated, requireRole('admin'), auditMutations, deleteNote);
router.get('/:id', isAuthenticated, getOpportunity);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateOpportunity);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteOpportunity);
router.post('/:id/clone', isAuthenticated, requireStaff, auditMutations, cloneOpportunity);
router.post('/:id/urgent', isAuthenticated, requireStaff, auditMutations, flagOpportunityUrgent);

module.exports = router;
