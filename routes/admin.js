const express = require('express');
const { isAuthenticated, requireRole, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { messageLimiter } = require('../middleware/rateLimiter');
const { getAdminStats, getLeaderboard, getMonthlyHoursChart } = require('../controllers/statsController');
const { getAllVolunteers, updateVolunteerApproval, getVolunteerProfile, updateVolunteerServiceSettings } = require('../controllers/profileController');
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

const router = express.Router();

router.use(auditMutations);

const adminOnly = requireRole('admin');
const staffOrAdmin = requireStaff;

router.get('/stats', isAuthenticated, staffOrAdmin, getAdminStats);
router.get('/stats/leaderboard', isAuthenticated, staffOrAdmin, getLeaderboard);
router.get('/stats/monthly-hours', isAuthenticated, staffOrAdmin, getMonthlyHoursChart);
router.get('/volunteers', isAuthenticated, staffOrAdmin, getAllVolunteers);
router.get('/volunteers/:userId', isAuthenticated, staffOrAdmin, getVolunteerProfile);
router.put('/volunteers/:userId/approval', isAuthenticated, adminOnly, updateVolunteerApproval);
router.put('/volunteers/:userId/service-settings', isAuthenticated, staffOrAdmin, updateVolunteerServiceSettings);
router.get('/volunteers/:userId/qualifications', isAuthenticated, staffOrAdmin, getVolunteerQualifications);
router.post('/volunteers/:userId/qualifications', isAuthenticated, staffOrAdmin, awardQualification);
router.delete(
  '/volunteers/:userId/qualifications/:qualificationId',
  isAuthenticated,
  staffOrAdmin,
  revokeQualification
);
router.get('/volunteers/:userId/custom-fields', isAuthenticated, staffOrAdmin, getVolunteerCustomValues);
router.get('/volunteers/:userId/waivers', isAuthenticated, staffOrAdmin, getVolunteerWaiverStatus);
router.get('/volunteers/:userId/documents', isAuthenticated, staffOrAdmin, listVolunteerDocuments);

router.get('/messages/recipients', isAuthenticated, adminOnly, previewRecipients);
router.get('/messages', isAuthenticated, adminOnly, listMessages);
router.post('/messages', isAuthenticated, adminOnly, messageLimiter, sendBulkMessage);

router.get('/audit-log', isAuthenticated, adminOnly, listAuditLog);
router.get('/gdpr/volunteers/:userId/export', isAuthenticated, adminOnly, exportVolunteerGdpr);
router.post('/gdpr/volunteers/:userId/erase', isAuthenticated, adminOnly, eraseVolunteer);
router.post('/gdpr/retention/run', isAuthenticated, adminOnly, runRetention);
router.put('/users/:userId/role', isAuthenticated, adminOnly, updateUserRole);

module.exports = router;
