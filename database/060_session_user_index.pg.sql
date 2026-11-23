-- Signed-in devices (SL-LATER-33). Additive index only.
-- The connect-pg-simple "session" table is looked up by owner for the
-- signed-in devices list, "sign out other devices", password change and
-- password reset (sess->>'userId' = $1). Without this, each of those scans
-- every live session. Safe to run more than once. If the session table does
-- not exist yet (fresh app that has not started), this does nothing; the
-- app creates the table on start and the index can be applied after.
--
-- Rollback (optional; index only):
--   DROP INDEX IF EXISTS idx_session_user_id;

DO $$
BEGIN
  IF to_regclass('public.session') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_session_user_id ON session ((sess->>''userId''))';
  END IF;
END $$;
