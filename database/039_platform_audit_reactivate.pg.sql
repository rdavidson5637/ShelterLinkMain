-- Let platform_audit record shelter.reactivated (PR9), written when a
-- platform owner turns a suspended shelter back on. Global table, no data
-- change. Safe to run more than once. Requires 038_platform_audit.pg.sql.
-- Do not run this against production until the deploy is approved.
--
-- Rollback (reactivation rows must go first, or the old check rejects them):
--   DELETE FROM platform_audit WHERE action = 'shelter.reactivated';
--   ALTER TABLE platform_audit DROP CONSTRAINT IF EXISTS platform_audit_action_chk;
--   ALTER TABLE platform_audit ADD CONSTRAINT platform_audit_action_chk
--     CHECK (action IN ('application.approved','application.rejected','invite.created','shelter.suspended'));

BEGIN;

ALTER TABLE platform_audit DROP CONSTRAINT IF EXISTS platform_audit_action_chk;
ALTER TABLE platform_audit ADD CONSTRAINT platform_audit_action_chk
  CHECK (action IN ('application.approved','application.rejected','invite.created','shelter.suspended','shelter.reactivated'));

COMMIT;
