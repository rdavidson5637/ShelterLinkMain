-- Training module refreshers (SL-LATER-28).
-- Optional validity_months on each training module. When set, a pass awards
-- the linked qualification with that expiry. Volunteers get email/push
-- 14 days before expiry (job_runs dedupe, quiet hours). Expired awards
-- already fail shift gates via volunteer_qualifications.expires_at.
-- Safe to run more than once. Feature branch only — coordinator/keeper
-- applies migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE training_modules DROP COLUMN IF EXISTS validity_months;

BEGIN;

ALTER TABLE training_modules
  ADD COLUMN IF NOT EXISTS validity_months INTEGER DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'training_modules_validity_months_chk'
  ) THEN
    ALTER TABLE training_modules
      ADD CONSTRAINT training_modules_validity_months_chk
      CHECK (validity_months IS NULL OR (validity_months >= 1 AND validity_months <= 240));
  END IF;
END $$;

COMMIT;
