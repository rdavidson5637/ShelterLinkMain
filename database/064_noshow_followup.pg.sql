-- No-show follow-up queue for staff (SL-DAY-05).
-- Tracks whether staff marked a no-show as contacted, and whether a
-- follow-up email was sent. Email is never automatic: only on an explicit
-- staff click. No SMS. No judgement labels or scores.
--
-- Feature branch only. Do not apply to production until Ryan approves and a
-- backup exists (npm run backup).
--
-- Rollback:
--   DROP INDEX IF EXISTS applications_no_show_contacted_idx;
--   ALTER TABLE applications DROP COLUMN IF EXISTS no_show_followup_sent_at;
--   ALTER TABLE applications DROP COLUMN IF EXISTS no_show_contacted_by;
--   ALTER TABLE applications DROP COLUMN IF EXISTS no_show_contacted_at;

BEGIN;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS no_show_contacted_at TIMESTAMP NULL;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS no_show_contacted_by INTEGER NULL;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS no_show_followup_sent_at TIMESTAMP NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_applications_no_show_contacted_by'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT fk_applications_no_show_contacted_by
      FOREIGN KEY (no_show_contacted_by) REFERENCES users (user_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS applications_no_show_contacted_idx
  ON applications (no_show, no_show_contacted_at)
  WHERE no_show = 1;

COMMIT;
