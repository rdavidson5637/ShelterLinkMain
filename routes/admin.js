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
const {
  getVolunteerGuardianConsent,
  recordVolunteerGuardianConsent,
  withdrawVolunteerGuardianConsent,
  getAgeSettings,
  updateAgeSettings,
} = require('../controllers/guardianConsentController');
const { listVolunteerDocuments } = require('../controllers/documentController');
const {
  listAuditLog,
  exportAuditLogCsv,
  exportVolunteerGdpr,
  eraseVolunteer,
  getRetentionSettings,
  updateRetentionSettings,
  previewRetention,
  runRetention,
  updateUserRole,
} = require('../controllers/gdprController');
const {
  getBookingSettings,
  updateBookingSettings,
  updateVolunteerTrusted,
} = require('../controllers/bookingPolicyController');
const {
  upload: brandLogoUpload,
  handleMulterError: handleBrandLogoMulterError,
  getBrandSettings,
  updateBrandSettings,
  uploadBrandLogo,
} = require('../controllers/shelterBrandController');
const {
  getSetupChecklist,
  dismissSetupChecklist,
  getPrivacyContact,
  updatePrivacyContact,
} = require('../controllers/setupChecklistController');
const { getDaySheet } = require('../controllers/daySheetController');
const {
  getImpactReport,
  getImpactReportCsv,
  getImpactReportPdf,
} = require('../controllers/impactReportController');
const {
  getNewsletterAudienceCsv,
  getNewsletterSyncStatus,
  postNewsletterSync,
} = require('../controllers/newsletterAudienceController');
const { getWeekSheet, getWeekSheetIcs } = require('../controllers/weekSheetController');
const { getThisWeek } = require('../controllers/thisWeekController');
const { getCopyPreview, postCopyWeek } = require('../controllers/weekCopyController');
const {
  listClosures,
  createClosure,
  getAffectedShifts,
  deleteClosure,
} = require('../controllers/closureController');
const { getVolunteerHoursStatement } = require('../controllers/hoursStatementController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { listStaffInvites, createStaffInvite, revokeStaffInvite } = require('../controllers/staffInviteController');
const { bodies, queries } = require('../validation/bodies');
const { previewImport, runImport, sendInvites } = require('../controllers/volunteerImportController');
const { MAX_BYTES: IMPORT_MAX_BYTES } = require('../utils/volunteerCsv');
const { listEmailPreviews } = require('../controllers/emailPreviewController');

const router = express.Router();
router.param('userId', positiveParam('userId'));
router.param('inviteId', positiveParam('inviteId'));
router.param('closureId', positiveParam('closureId'));

router.use(auditMutations);

const adminOnly = requireRole('admin');
const staffOrAdmin = requireStaff;

router.get('/day-sheet', isAuthenticated, staffOrAdmin, validateQuery(queries.day), getDaySheet);
router.get('/week-sheet', isAuthenticated, staffOrAdmin, validateQuery(queries.week), getWeekSheet);
router.get('/week-sheet.ics', isAuthenticated, staffOrAdmin, validateQuery(queries.week), getWeekSheetIcs);
router.get('/week-sheet/copy-preview', isAuthenticated, staffOrAdmin, validateQuery(queries.weekCopy), getCopyPreview);
router.post('/week-sheet/copy', isAuthenticated, staffOrAdmin, validateBody(bodies.weekCopy), postCopyWeek);
router.get('/this-week', isAuthenticated, staffOrAdmin, getThisWeek);
router.get('/stats', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getAdminStats);
router.get('/reports/impact', isAuthenticated, staffOrAdmin, validateQuery(queries.impactReport), getImpactReport);
router.get('/reports/impact.csv', isAuthenticated, staffOrAdmin, validateQuery(queries.impactReport), getImpactReportCsv);
router.get('/reports/impact.pdf', isAuthenticated, staffOrAdmin, validateQuery(queries.impactReport), getImpactReportPdf);
router.get('/reports/newsletter-audience.csv', isAuthenticated, staffOrAdmin, getNewsletterAudienceCsv);
router.get('/reports/newsletter-sync', isAuthenticated, staffOrAdmin, getNewsletterSyncStatus);
router.post('/reports/newsletter-sync', isAuthenticated, staffOrAdmin, postNewsletterSync);
router.get('/stats/leaderboard', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getLeaderboard);
router.get('/stats/monthly-hours', isAuthenticated, staffOrAdmin, validateQuery(queries.year), getMonthlyHoursChart);
router.get('/volunteers', isAuthenticated, staffOrAdmin, getAllVolunteers);

// SL-LATER-32: CSV import. The file is sent as text/csv, read only here, with
// its own size limit (the JSON parser stays at its default).
const csvText = express.text({ type: ['text/csv', 'text/plain'], limit: IMPORT_MAX_BYTES + 1024 });
function readCsvBody(req, res, next) {
  csvText(req, res, (error) => {
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: `The file is larger than ${IMPORT_MAX_BYTES / 1024} KB. Split it into smaller files.` });
    }
    if (error) return res.status(400).json({ error: 'The file could not be read. Export it from your spreadsheet as CSV (UTF-8).' });
    return next();
  });
}
router.post('/volunteers/import/preview', isAuthenticated, adminOnly, readCsvBody, previewImport);
router.post('/volunteers/import', isAuthenticated, adminOnly, readCsvBody, runImport);
router.post('/volunteers/invites', isAuthenticated, staffOrAdmin, messageLimiter, validateBody(bodies.volunteerInvites), sendInvites);
router.get('/volunteers/:userId', isAuthenticated, staffOrAdmin, getVolunteerProfile);
router.get(
  '/volunteers/:userId/hours-statement',
  isAuthenticated,
  staffOrAdmin,
  validateQuery(queries.hoursStatement),
  getVolunteerHoursStatement
);
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
router.get('/volunteers/:userId/guardian-consent', isAuthenticated, staffOrAdmin, getVolunteerGuardianConsent);
router.post('/volunteers/:userId/guardian-consent', isAuthenticated, staffOrAdmin, validateBody(bodies.guardianConsent), recordVolunteerGuardianConsent);
router.delete('/volunteers/:userId/guardian-consent', isAuthenticated, staffOrAdmin, withdrawVolunteerGuardianConsent);
router.get('/settings/age', isAuthenticated, staffOrAdmin, getAgeSettings);
router.put('/settings/age', isAuthenticated, adminOnly, validateBody(bodies.ageSettings), updateAgeSettings);
router.get('/volunteers/:userId/documents', isAuthenticated, adminOnly, listVolunteerDocuments);

router.get('/messages/recipients', isAuthenticated, adminOnly, validateQuery(queries.recipients), previewRecipients);
router.get('/messages', isAuthenticated, adminOnly, listMessages);
router.post('/messages', isAuthenticated, adminOnly, messageLimiter, validateBody(bodies.bulkMessage), sendBulkMessage);

router.get('/audit-log', isAuthenticated, adminOnly, validateQuery(queries.audit), listAuditLog);
router.get('/audit-log.csv', isAuthenticated, adminOnly, validateQuery(queries.audit), exportAuditLogCsv);
router.get('/gdpr/volunteers/:userId/export', isAuthenticated, adminOnly, exportVolunteerGdpr);
router.post('/gdpr/volunteers/:userId/erase', isAuthenticated, adminOnly, validateBody(bodies.erase), eraseVolunteer);
router.get('/settings/retention', isAuthenticated, adminOnly, getRetentionSettings);
router.put(
  '/settings/retention',
  isAuthenticated,
  adminOnly,
  validateBody(bodies.retentionSettings),
  updateRetentionSettings
);
router.get('/gdpr/retention/preview', isAuthenticated, adminOnly, previewRetention);
router.post('/gdpr/retention/run', isAuthenticated, adminOnly, validateBody(bodies.empty), runRetention);
router.put('/users/:userId/role', isAuthenticated, adminOnly, validateBody(bodies.role), updateUserRole);

// Team invites: admins invite staff and other admins to their own shelter.
router.get('/invites', isAuthenticated, adminOnly, listStaffInvites);
router.post('/invites', isAuthenticated, adminOnly, messageLimiter, validateBody(bodies.staffInvite), createStaffInvite);
router.post('/invites/:inviteId/revoke', isAuthenticated, adminOnly, validateBody(bodies.empty), revokeStaffInvite);

// SL-NOW-03: booking approval policy. Trust is admin-granted only.
router.get('/settings/booking', isAuthenticated, staffOrAdmin, getBookingSettings);
router.put('/settings/booking', isAuthenticated, adminOnly, validateBody(bodies.bookingSettings), updateBookingSettings);
router.put('/volunteers/:userId/trusted', isAuthenticated, adminOnly, validateBody(bodies.trustedVolunteer), updateVolunteerTrusted);

// SL-LATER-30: closure dates. Adding one lists booked shifts inside it;
// nothing is cancelled or emailed automatically.
router.get('/closures', isAuthenticated, staffOrAdmin, validateQuery(queries.closures), listClosures);
router.post('/closures', isAuthenticated, adminOnly, validateBody(bodies.shelterClosure), createClosure);
router.get('/closures/:closureId/affected', isAuthenticated, staffOrAdmin, getAffectedShifts);
router.delete('/closures/:closureId', isAuthenticated, adminOnly, deleteClosure);

// SL-LATER-10: per-shelter accent colour and logo.
router.get('/settings/brand', isAuthenticated, staffOrAdmin, getBrandSettings);
router.put('/settings/brand', isAuthenticated, adminOnly, validateBody(bodies.brandSettings), updateBrandSettings);

// SL-LATER-38: read-only email previews (sample data, never sends).
router.get('/email-previews', isAuthenticated, adminOnly, listEmailPreviews);
router.post(
  '/settings/brand/logo',
  isAuthenticated,
  adminOnly,
  (req, res, next) => {
    brandLogoUpload.single('logo')(req, res, (err) => {
      if (handleBrandLogoMulterError(err, res)) return;
      return next();
    });
  },
  uploadBrandLogo
);

// SL-LATER-17: new-shelter setup checklist (progress from real data).
router.get('/setup-checklist', isAuthenticated, adminOnly, getSetupChecklist);
router.post(
  '/setup-checklist/dismiss',
  isAuthenticated,
  adminOnly,
  validateBody(bodies.empty),
  dismissSetupChecklist
);
router.get('/settings/privacy-contact', isAuthenticated, staffOrAdmin, getPrivacyContact);
router.put(
  '/settings/privacy-contact',
  isAuthenticated,
  adminOnly,
  validateBody(bodies.privacyContact),
  updatePrivacyContact
);

module.exports = router;
