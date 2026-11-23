-- 049: Optional object-storage key for shelter logos (SL-LATER-10)
--
-- Logos already live on shelters.logo / logo_mime (033). primary_colour is on
-- shelters from 036. This migration adds logo_storage_key so admin logo
-- uploads can use the same object-storage path as animal photos and documents
-- (045) when OBJECT_STORAGE_* is configured. Bytes stay in logo bytea when
-- object storage is off.
--
-- Do not apply this to production yourself — the coordinator/keeper runs
-- migrations in order.

BEGIN;

ALTER TABLE shelters ADD COLUMN IF NOT EXISTS logo_storage_key TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shelters_logo_storage_key
  ON shelters (logo_storage_key)
  WHERE logo_storage_key IS NOT NULL;

COMMIT;
