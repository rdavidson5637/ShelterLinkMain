-- New-shelter setup checklist dismiss (SL-LATER-17).
-- Progress itself is computed from real shelter data (branding, booking
-- policy, minimum age, first shift, staff invite, privacy contact). This
-- column only records that an admin dismissed the complete checklist.
--
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE shelters DROP COLUMN IF EXISTS setup_checklist_dismissed_at;

BEGIN;

ALTER TABLE shelters ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at TIMESTAMP NULL;

COMMIT;
