-- Case-insensitive uniqueness for login and password reset.
-- users.email already has a case-sensitive unique constraint. This index
-- also rejects Admin@shelter.org and admin@shelter.org as two accounts.
--
-- Take a backup first (npm run backup), then:
--   BACKUP_CONFIRMED=yes npm run migrate
-- migrate.js will not apply this file until BACKUP_CONFIRMED=yes.
-- If two rows share an email ignoring case, this file aborts and changes nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(email) AS email_key
      FROM users
      GROUP BY lower(email)
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'duplicate emails exist when compared case-insensitively; back up, merge those users, then re-run';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));
