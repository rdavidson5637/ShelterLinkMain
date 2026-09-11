-- 032: Store uploaded files in Postgres instead of on local disk (Postgres)
--
-- Hosts like Railway/Render/Fly have an ephemeral filesystem: anything written
-- to disk is lost on every redeploy or restart. Volunteer documents (AccessNI,
-- references) and animal photos must survive that, so the bytes now live in the
-- database and ride along in `npm run backup` (pg_dump).
--
-- Files are small and capped at 5MB, volume is low (one shelter), so bytea in
-- Postgres is the pragmatic choice and needs no extra service or secret.

-- Volunteer documents: add the payload column. Nullable so existing rows (which
-- only ever existed in local dev) do not block the migration; the API always
-- writes it for new uploads.
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS content BYTEA;

-- Animal photos: kept in their own table so `SELECT a.* FROM animals a` never
-- drags image bytes into list/detail queries.
CREATE TABLE IF NOT EXISTS animal_photos (
  animal_id   INTEGER       NOT NULL PRIMARY KEY,
  content     BYTEA         NOT NULL,
  mime_type   VARCHAR(100)  NOT NULL DEFAULT 'image/jpeg',
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_animal_photos_animal
    FOREIGN KEY (animal_id) REFERENCES animals (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
