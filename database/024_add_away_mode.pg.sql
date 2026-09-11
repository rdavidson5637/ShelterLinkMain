-- 024: Away mode / retention columns on volunteer_profiles (Postgres)

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS away_until DATE DEFAULT NULL;

ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS last_engagement_email_at TIMESTAMP DEFAULT NULL;
