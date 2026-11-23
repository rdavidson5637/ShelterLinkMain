-- SL-NEXT-06: optional two-factor sign-in (TOTP) for staff and admin.
-- Nullable columns only; existing rows stay NULL, which means 2FA is off.
-- Safe to run more than once. Branch only: do not apply to production
-- without Ryan, and take a backup first (npm run backup).
--
-- totp_secret          AES-256-GCM ciphertext of the base32 seed (utils/totp.js)
-- totp_enabled_at      set when the user confirms a first code; NULL = off
-- totp_last_counter    last accepted 30-second step, blocks code replay
-- totp_recovery_codes  JSON array of SHA-256 hashes of unused recovery codes
--
-- Rollback:
--   ALTER TABLE users DROP COLUMN IF EXISTS totp_recovery_codes;
--   ALTER TABLE users DROP COLUMN IF EXISTS totp_last_counter;
--   ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled_at;
--   ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT NULL;
