-- Booking approval policy (SL-NOW-03).
--   shelter_booking_policy  per shelter. One row per shelter. booking_mode is
--                           'approval' (every booking waits for staff, the
--                           behaviour before this migration) or 'instant'
--                           (trusted volunteers are confirmed straight away
--                           and the waitlist fills to confirmed for them).
--                           No row means 'approval'.
--   trusted_volunteers      per shelter. A volunteer that shelter staff have
--                           marked as trusted to book instantly. Trust is
--                           only ever granted by an admin. There is no hours
--                           threshold or automatic promotion to trusted.
--                           Removing trust deletes the row; the change is in
--                           audit_log (admin routes are audited).
-- Booking rule (enforced in the app, see utils/bookingPolicy.js):
--   mode 'approval'                     -> pending (or waitlisted when full)
--   mode 'instant', not trusted         -> pending (or waitlisted when full)
--   mode 'instant', trusted, seat free  -> accepted
--   mode 'instant', trusted, full       -> waitlisted; when a seat frees up
--                                          the oldest waitlisted volunteer is
--                                          accepted if trusted and still
--                                          eligible, otherwise pending.
-- Existing shelters, including Assisi (id 1), get no row and so stay on
-- 'approval'. Nothing changes for them until an admin switches mode.
-- Kept apart from shelter_settings (041, SL-NOW-02) so the two branches do
-- not migrate the same table.
-- Safe to run more than once. Requires 033_add_shelters.pg.sql.
-- Feature branch only. Do not apply to production until Ryan approves the
-- deploy and a backup exists (npm run backup).
--
-- Rollback:
--   DROP TABLE IF EXISTS trusted_volunteers, shelter_booking_policy;
--   DROP FUNCTION IF EXISTS reject_cross_shelter_trusted_volunteers();
--   DROP FUNCTION IF EXISTS reject_cross_shelter_shelter_booking_policy();

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shelters WHERE id = 1 AND slug = 'assisi') THEN
    RAISE EXCEPTION 'Shelter id 1 slug assisi is missing. Apply 033 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- shelter_booking_policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shelter_booking_policy (
  shelter_id    INTEGER PRIMARY KEY DEFAULT (NULLIF(current_setting('app.shelter_id', true), '')::integer),
  booking_mode  VARCHAR(20) NOT NULL DEFAULT 'approval',
  updated_by    INTEGER,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT shelter_booking_policy_mode_chk CHECK (booking_mode IN ('approval', 'instant')),
  CONSTRAINT shelter_booking_policy_shelter_id_fkey
    FOREIGN KEY (shelter_id) REFERENCES shelters (id) ON DELETE RESTRICT,
  CONSTRAINT shelter_booking_policy_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES users (user_id) ON DELETE SET NULL
);

ALTER TABLE shelter_booking_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shelter_booking_policy;
CREATE POLICY tenant_isolation ON shelter_booking_policy
  FOR ALL
  TO shelterlink_tenant
  USING (shelter_id = NULLIF(current_setting('app.shelter_id', true), '')::integer)
  WITH CHECK (shelter_id = NULLIF(current_setting('app.shelter_id', true), '')::integer);

CREATE OR REPLACE FUNCTION reject_cross_shelter_shelter_booking_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM assert_same_shelter(NEW.shelter_id, 'users', 'user_id', NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_same_shelter ON shelter_booking_policy;
CREATE TRIGGER trg_same_shelter
  BEFORE INSERT OR UPDATE ON shelter_booking_policy
  FOR EACH ROW EXECUTE FUNCTION reject_cross_shelter_shelter_booking_policy();

-- ---------------------------------------------------------------------------
-- trusted_volunteers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_volunteers (
  shelter_id  INTEGER NOT NULL DEFAULT (NULLIF(current_setting('app.shelter_id', true), '')::integer),
  user_id     INTEGER NOT NULL,
  granted_by  INTEGER,
  granted_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT trusted_volunteers_pkey PRIMARY KEY (shelter_id, user_id),
  CONSTRAINT trusted_volunteers_shelter_id_fkey
    FOREIGN KEY (shelter_id) REFERENCES shelters (id) ON DELETE RESTRICT,
  CONSTRAINT trusted_volunteers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT trusted_volunteers_granted_by_fkey
    FOREIGN KEY (granted_by) REFERENCES users (user_id) ON DELETE SET NULL
);

ALTER TABLE trusted_volunteers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON trusted_volunteers;
CREATE POLICY tenant_isolation ON trusted_volunteers
  FOR ALL
  TO shelterlink_tenant
  USING (shelter_id = NULLIF(current_setting('app.shelter_id', true), '')::integer)
  WITH CHECK (shelter_id = NULLIF(current_setting('app.shelter_id', true), '')::integer);

CREATE OR REPLACE FUNCTION reject_cross_shelter_trusted_volunteers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM assert_same_shelter(NEW.shelter_id, 'users', 'user_id', NEW.user_id);
  PERFORM assert_same_shelter(NEW.shelter_id, 'users', 'user_id', NEW.granted_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_same_shelter ON trusted_volunteers;
CREATE TRIGGER trg_same_shelter
  BEFORE INSERT OR UPDATE ON trusted_volunteers
  FOR EACH ROW EXECUTE FUNCTION reject_cross_shelter_trusted_volunteers();

GRANT SELECT, INSERT, UPDATE, DELETE ON shelter_booking_policy TO shelterlink_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON trusted_volunteers TO shelterlink_tenant;

COMMIT;
