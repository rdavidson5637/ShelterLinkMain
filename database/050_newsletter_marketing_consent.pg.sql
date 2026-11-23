-- Newsletter / marketing consent on volunteer profiles (SL-LATER-15).
-- Explicit opt-in only (default off). When set, marketing_consent_at records
-- the date. Staff export of the opted-in audience is separate; Brevo/Mailchimp
-- sync ships as a disabled provider with no keys or accounts.
--
-- Feature branch only. Do not apply to production until Ryan approves and a
-- backup exists (npm run backup).
--
-- Rollback:
--   ALTER TABLE volunteer_profiles DROP COLUMN IF EXISTS marketing_consent_at;
--   ALTER TABLE volunteer_profiles DROP COLUMN IF EXISTS marketing_consent;

BEGIN;

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS marketing_consent SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMP NULL;

-- Existing rows stay opted out. Guard against a bad default if the column
-- was added without NOT NULL DEFAULT in an earlier attempt.
UPDATE volunteer_profiles
   SET marketing_consent = 0
 WHERE marketing_consent IS NULL;

CREATE INDEX IF NOT EXISTS volunteer_profiles_marketing_consent_idx
  ON volunteer_profiles (shelter_id, marketing_consent)
  WHERE marketing_consent = 1;

COMMIT;
