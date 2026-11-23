-- Structured volunteer emergency contacts (SL-DAY-01).
--
-- Adds name, relationship and phone alongside the legacy emergency_contact
-- free-text column (kept for day/week sheets and older rows). Safe to run
-- more than once. Feature branch only — do not apply to production until
-- the coordinator or keeper runs migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE volunteer_profiles
--     DROP COLUMN IF EXISTS emergency_contact_name,
--     DROP COLUMN IF EXISTS emergency_contact_relationship,
--     DROP COLUMN IF EXISTS emergency_contact_phone;

BEGIN;

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(120) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(80) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(40) DEFAULT NULL;

COMMIT;
