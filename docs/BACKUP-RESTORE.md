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

This drill has not been run against the live database. Do not offer ShelterLink
to another rescue until someone completes it and writes the date here.

1. Run `npm run backup` and confirm a new `.sql.gz.enc` file exists.
2. Decrypt it to a file outside `backups/`:

```
BACKUP_ENCRYPTION_KEY='the key' node scripts/restore-backup.js backups/shelterlink-YYYY-MM-DD.sql.gz.enc --out /tmp/shelterlink-restore.sql
```

3. Create an empty scratch database. Do not use the live database name.
4. Load the SQL into that scratch database with `psql`.
5. Compare counts with the live database for `users`, `volunteer_hours`, `animals`, and `background_checks`.
6. Drop the scratch database when the counts match.
7. Record the date and the person who ran it below.

| Date | Who | Result |
| --- | --- | --- |
| | | Not done |

Supabase free tier pauses and has no point-in-time restore. This dump is the
restore path until the project is on a plan that has one.
