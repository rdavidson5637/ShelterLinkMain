-- Tenant hot-path indexes (SL-LATER-29). Next free after 056.
-- Composite indexes matching the hottest RLS-scoped query shapes:
--   shift listing / public board / dashboard open counts
--   day-sheet and this-week date ranges
--   booking lists by status and by volunteer
--   capacity checks by opportunity + status
--   this-week training expiry and waitlist offers
-- Safe to run more than once (IF NOT EXISTS). Feature branch only —
-- coordinator/keeper applies migrations in order after a backup.
--
-- Rollback (optional; indexes only):
--   DROP INDEX IF EXISTS idx_opportunities_shelter_status_start;
--   DROP INDEX IF EXISTS idx_opportunities_shelter_start;
--   DROP INDEX IF EXISTS idx_applications_shelter_status_applied;
--   DROP INDEX IF EXISTS idx_applications_shelter_user_applied;
--   DROP INDEX IF EXISTS idx_applications_shelter_opportunity_status;
--   DROP INDEX IF EXISTS idx_vq_shelter_expires;
--   DROP INDEX IF EXISTS idx_waitlist_offers_shelter_status;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shelters WHERE id = 1 AND slug = 'assisi') THEN
    RAISE EXCEPTION 'Shelter id 1 slug assisi is missing. Apply 033 first.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opportunities_shelter_status_start
  ON opportunities (shelter_id, status, start_date);

CREATE INDEX IF NOT EXISTS idx_opportunities_shelter_start
  ON opportunities (shelter_id, start_date);

CREATE INDEX IF NOT EXISTS idx_applications_shelter_status_applied
  ON applications (shelter_id, status, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_shelter_user_applied
  ON applications (shelter_id, user_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_shelter_opportunity_status
  ON applications (shelter_id, opportunity_id, status);

CREATE INDEX IF NOT EXISTS idx_vq_shelter_expires
  ON volunteer_qualifications (shelter_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_waitlist_offers_shelter_status
  ON waitlist_offers (shelter_id, status);

COMMIT;
