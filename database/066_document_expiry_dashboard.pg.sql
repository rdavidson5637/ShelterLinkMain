-- Document / check / qualification expiry dashboard for staff (SL-DAY-12).
-- Adds a timestamp so staff can see when they last sent an optional email
-- reminder. Email is never automatic: only on an explicit staff click. No SMS.
--
-- Reuses existing expiry columns:
--   background_checks.expires_on
--   user_documents.expires_at
--   volunteer_qualifications.expires_at
--
-- Feature branch only. Do not apply to production until Ryan approves and a
-- backup exists (npm run backup).
--
-- Rollback:
--   ALTER TABLE volunteer_qualifications DROP COLUMN IF EXISTS last_staff_reminder_sent_at;
--   ALTER TABLE user_documents DROP COLUMN IF EXISTS last_staff_reminder_sent_at;
--   ALTER TABLE background_checks DROP COLUMN IF EXISTS last_staff_reminder_sent_at;

BEGIN;

ALTER TABLE background_checks
  ADD COLUMN IF NOT EXISTS last_staff_reminder_sent_at TIMESTAMP NULL;

ALTER TABLE user_documents
  ADD COLUMN IF NOT EXISTS last_staff_reminder_sent_at TIMESTAMP NULL;

ALTER TABLE volunteer_qualifications
  ADD COLUMN IF NOT EXISTS last_staff_reminder_sent_at TIMESTAMP NULL;

COMMIT;
