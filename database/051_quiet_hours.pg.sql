-- Quiet hours for volunteer notification prefs (SL-LATER-16).
--
-- When both quiet_hours_start and quiet_hours_end are set, shift reminders
-- and urgent-cover alerts are held during that window (shelter local time).
-- NULL/NULL means no quiet hours. Safe to run more than once.
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE volunteer_profiles
--     DROP COLUMN IF EXISTS quiet_hours_start,
--     DROP COLUMN IF EXISTS quiet_hours_end;

BEGIN;

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS quiet_hours_start TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_end TIME DEFAULT NULL;

COMMIT;
