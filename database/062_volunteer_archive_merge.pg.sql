-- Volunteer archive columns for staff merge of duplicates (SL-DAY-03).
--
-- Staff can merge two volunteer records in the same shelter: bookings, notes,
-- qualifications and memberships move onto the kept account, then the
-- duplicate is archived (cannot sign in; hidden from the directory).
--
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE users
--     DROP COLUMN IF EXISTS archived_at,
--     DROP COLUMN IF EXISTS merged_into_user_id;

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS merged_into_user_id INTEGER DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_merged_into_user_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_merged_into_user_id_fkey
      FOREIGN KEY (merged_into_user_id) REFERENCES users (user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_archived_at
  ON users (archived_at)
  WHERE archived_at IS NOT NULL;

COMMIT;
