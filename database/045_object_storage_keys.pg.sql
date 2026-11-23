-- 045: Object storage keys for uploads (Postgres)
--
-- Volunteer documents and animal photos have lived in Postgres bytea (032).
-- Before a third shelter that volume is a poor fit for the free-tier DB
-- budget. This migration adds an optional storage_key so bytes can live in
-- an S3-compatible bucket (Cloudflare R2, Supabase Storage S3, MinIO) while
-- metadata stays in Postgres.
--
-- When OBJECT_STORAGE_* env vars are unset, the app still writes content
-- bytea as before. Existing rows keep working. Do not apply this to
-- production yourself — the coordinator/keeper runs migrations in order.

ALTER TABLE user_documents
  ADD COLUMN IF NOT EXISTS storage_key TEXT DEFAULT NULL;

ALTER TABLE animal_photos
  ADD COLUMN IF NOT EXISTS storage_key TEXT DEFAULT NULL;

-- Object-stored photos leave content null; DB-stored photos leave storage_key null.
ALTER TABLE animal_photos
  ALTER COLUMN content DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_documents_storage_key
  ON user_documents (storage_key)
  WHERE storage_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_animal_photos_storage_key
  ON animal_photos (storage_key)
  WHERE storage_key IS NOT NULL;
