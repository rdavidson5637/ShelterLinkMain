-- One pending application per web address and per charity (PR8 review).
--
-- The application form already refuses a slug or charity that has a
-- pending application, but that is a read then a write: two submissions at
-- the same moment can both pass the check. These partial unique indexes make
-- the database refuse the second one. Decided (approved/rejected) rows are
-- not covered, so a rejected charity can apply again.
--
-- The app maps a unique violation on these indexes to the same field errors
-- as the read-time check (controllers/shelterApplicationController.js).
--
-- Fails with a clear message, and changes nothing, if pending duplicates
-- already exist: reject or approve the extras first.
-- Safe to run more than once. Requires 036_self_serve_shelters.pg.sql.
-- NOT YET APPLIED to any environment. Take a backup first (npm run backup)
-- and do not run this against production until the deploy is approved.
--
-- Rollback:
--   DROP INDEX IF EXISTS shelter_applications_pending_slug_key;
--   DROP INDEX IF EXISTS shelter_applications_pending_charity_key;

BEGIN;

DO $$
DECLARE
  dup_slugs INTEGER;
  dup_charities INTEGER;
BEGIN
  SELECT count(*) INTO dup_slugs FROM (
    SELECT desired_slug FROM shelter_applications
    WHERE status = 'pending' GROUP BY desired_slug HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO dup_charities FROM (
    SELECT regulator, charity_number FROM shelter_applications
    WHERE status = 'pending' GROUP BY regulator, charity_number HAVING count(*) > 1
  ) d;
  IF dup_slugs > 0 OR dup_charities > 0 THEN
    RAISE EXCEPTION 'Pending shelter_applications has duplicates (% slugs, % charities). Decide the extras first.',
      dup_slugs, dup_charities;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shelter_applications_pending_slug_key
  ON shelter_applications (desired_slug)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS shelter_applications_pending_charity_key
  ON shelter_applications (regulator, charity_number)
  WHERE status = 'pending';

COMMIT;
