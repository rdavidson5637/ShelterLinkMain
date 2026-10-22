-- Records that the person saw the privacy notice, and which version.
-- Existing rows stay NULL. Nullable columns only. Safe to run more than once.
-- Take a backup first (npm run backup). Do not run this against production
-- until that backup exists.
--
-- Rollback:
--   ALTER TABLE users DROP COLUMN IF EXISTS privacy_notice_version;
--   ALTER TABLE users DROP COLUMN IF EXISTS consent_given_at;

ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(32) NULL;
