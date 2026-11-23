-- Personal calendar feed tokens are stored hashed (SL-LATER-22).
-- users.ical_token holds the sha256 hex of the subscription secret.
-- No schema change: the column is already VARCHAR(64).
-- Legacy plaintext rows (from before this change) are accepted once by
-- GET /api/my-shifts.ics and rewritten to their sha256 digest on first hit.
-- New and reset tokens are written hashed only.
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback: none required (no DDL). Volunteers can reset their feed URL.

BEGIN;

SELECT 1;

COMMIT;
