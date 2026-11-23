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

const { listUpcomingClosures } = require('../controllers/closureController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));
router.param('noteId', positiveParam('noteId'));

router.post('/', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.opportunity), createOpportunity);
router.get('/', isAuthenticated, validateQuery(queries.opportunities), getAllOpportunities);
router.get('/closures', isAuthenticated, listUpcomingClosures);
router.get('/:id/notes', isAuthenticated, listNotes);
router.post('/:id/notes', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.shiftNote), createNote);
router.delete('/:id/notes/:noteId', isAuthenticated, requireRole('admin'), auditMutations, deleteNote);
router.get('/:id', isAuthenticated, getOpportunity);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.opportunity), updateOpportunity);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, validateQuery(queries.opportunities), deleteOpportunity);
router.post('/:id/clone', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), cloneOpportunity);
router.post('/:id/urgent', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), flagOpportunityUrgent);

module.exports = router;
