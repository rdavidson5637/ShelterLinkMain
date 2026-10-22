const express = require('express');
const { isAuthenticated, requireRole, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { messageLimiter } = require('../middleware/rateLimiter');
const { getAdminStats, getLeaderboard, getMonthlyHoursChart } = require('../controllers/statsController');
const { getAllVolunteers, updateVolunteerApproval, getVolunteerProfile, updateVolunteerServiceSettings } = require('../controllers/profileController');
const { updateFosterApproval } = require('../controllers/fosterController');
const {
  previewRecipients,
  sendBulkMessage,
  listMessages,
} = require('../controllers/messageController');
const {
  getVolunteerQualifications,
  awardQualification,
  revokeQualification,
} = require('../controllers/qualificationController');
const { getVolunteerCustomValues } = require('../controllers/customFieldController');
const { getVolunteerWaiverStatus } = require('../controllers/waiverController');
const { listVolunteerDocuments } = require('../controllers/documentController');
const {
  listAuditLog,
  exportVolunteerGdpr,
  eraseVolunteer,
  runRetention,
  updateUserRole,
} = require('../controllers/gdprController');
const { getDaySheet } = require('../controllers/daySheetController');
const { getWeekSheet, getWeekSheetIcs } = require('../controllers/weekSheetController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('userId', positiveParam('userId'));

router.use(auditMutations);

const adminOnly = requireRole('admin');
const staffOrAdmin = requireStaff;

router.get('/day-sheet', isAuthenticated, staffOrAdmin, validateQuery(queries.day), getDaySheet);
router.get('/week-sheet', isAuthenticated, staffOrAdmin, validateQuery(queries.week), getWeekSheet);
router.get('/week-sheet.ics', isAuthenticated, staffOrAdmin, validateQuery(queries.week), getWeekSheetIcs);
router.get('/stats', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getAdminStats);
router.get('/stats/leaderboard', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getLeaderboard);
router.get('/stats/monthly-hours', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getMonthlyHoursChart);
router.get('/volunteers', isAuthenticated, staffOrAdmin, getAllVolunteers);
router.get('/volunteers/:userId', isAuthenticated, staffOrAdmin, getVolunteerProfile);
router.put('/volunteers/:userId/approval', isAuthenticated, adminOnly, validateBody(bodies.approval), updateVolunteerApproval);
router.put('/volunteers/:userId/foster-approval', isAuthenticated, staffOrAdmin, validateBody(bodies.fosterApproval), updateFosterApproval);
router.put('/volunteers/:userId/service-settings', isAuthenticated, staffOrAdmin, validateBody(bodies.serviceSettings), updateVolunteerServiceSettings);
router.get('/volunteers/:userId/qualifications', isAuthenticated, staffOrAdmin, getVolunteerQualifications);
router.post('/volunteers/:userId/qualifications', isAuthenticated, staffOrAdmin, validateBody(bodies.awardQualification), awardQualification);
router.delete(
  '/volunteers/:userId/qualifications/:qualificationId',
  isAuthenticated,
  staffOrAdmin,
  revokeQualification
);
router.get('/volunteers/:userId/custom-fields', isAuthenticated, staffOrAdmin, getVolunteerCustomValues);
router.get('/volunteers/:userId/waivers', isAuthenticated, staffOrAdmin, getVolunteerWaiverStatus);
router.get('/volunteers/:userId/documents', isAuthenticated, adminOnly, listVolunteerDocuments);

router.get('/messages/recipients', isAuthenticated, adminOnly, validateQuery(queries.recipients), previewRecipients);
router.get('/messages', isAuthenticated, adminOnly, listMessages);
router.post('/messages', isAuthenticated, adminOnly, messageLimiter, validateBody(bodies.bulkMessage), sendBulkMessage);

router.get('/audit-log', isAuthenticated, adminOnly, validateQuery(queries.audit), listAuditLog);
router.get('/gdpr/volunteers/:userId/export', isAuthenticated, adminOnly, exportVolunteerGdpr);
router.post('/gdpr/volunteers/:userId/erase', isAuthenticated, adminOnly, validateBody(bodies.erase), eraseVolunteer);
router.post('/gdpr/retention/run', isAuthenticated, adminOnly, validateBody(bodies.empty), runRetention);
router.put('/users/:userId/role', isAuthenticated, adminOnly, validateBody(bodies.role), updateUserRole);

module.exports = router;
