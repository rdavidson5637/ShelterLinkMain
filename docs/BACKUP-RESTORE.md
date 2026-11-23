# Backup and restore

The step-by-step runbook is `docs/runbooks/backup-and-restore.md`.
Shell scripts: `scripts/backup-db.sh`, `scripts/restore-db.sh`, `scripts/verify-restore.sh`.

Backups are gzipped, then encrypted with AES-256-GCM. The script writes
`backups/shelterlink-YYYY-MM-DD.sql.gz.enc` and deletes files in that folder
older than 14 days. It will not write a plaintext dump.

Set `BACKUP_ENCRYPTION_KEY` (at least 16 characters) on the host that runs
`npm run backup`. Keep a copy of the key somewhere other than that host. A
backup without the key cannot be restored.

## Restore drill

This drill has not been run. Do not offer ShelterLink to another rescue until
someone completes it and writes the date here.

The steps are in `docs/runbooks/backup-and-restore.md` under "Restore drill on
a scratch copy". In short: take an encrypted dump, load it into an empty
scratch database on a separate Postgres server, check that the row counts in
the database match the row counts in the dump, then drop the scratch copy.
Never restore into the live database for a drill.

| Date | Who | Dump file date | Made by | Restore time | Result | Notes (roles created, errors) |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | Not done | |

Supabase free tier pauses and has no point-in-time restore. This dump is the
restore path until the project is on a plan that has one.
