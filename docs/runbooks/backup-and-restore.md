# Backup and restore

ShelterLink stores personal data in Postgres. The dump is the copy you can
rebuild from. Supabase's free project does not give you point-in-time restore.
This runbook is the restore path.

The database is Postgres. The scripts use `pg_dump` and `psql`. `pg_dump`
reads one consistent snapshot and includes functions and triggers. That is the
Postgres equivalent of `mysqldump --single-transaction --routines --triggers`.

## Take a backup

From the repo root, with `pg_dump` installed:

```bash
BACKUP_DIR=/var/backups/shelterlink ./scripts/backup-db.sh
```

`BACKUP_DIR` and `BACKUP_ENCRYPTION_KEY` must be set. The key is at least 16
characters. The script writes `shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc` and
deletes the plaintext gzip before it exits. The password is not put on the
command line. It sits in a temporary pgpass file, mode 600, for the length of
the dump, then that file is deleted.

`npm run backup` does the same encryption and stores the file in `backups/`.
It now also keeps the password out of the `pg_dump` command line.

Do this once a day. The Node script deletes files in `backups/` that are older
than 14 days. Copy each encrypted file off the server before that window
closes. A backup that sits only on the database server is not a backup.

## Restore

You need the encrypted file and the same `BACKUP_ENCRYPTION_KEY`.

1. Create an empty database. Do not use the live database name.
2. Run:

```bash
./scripts/restore-db.sh /path/shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc scratch_db_name
```

The script refuses if the target name is the one in `DATABASE_URL` or `DB_NAME`,
and it refuses if that database already has a `users` table. The override is
`--i-know-this-is-production`. Do not use that override for a drill.

## Check that the restore worked

```bash
BACKUP_DIR=/var/backups/shelterlink ./scripts/verify-restore.sh
```

This creates a scratch database, restores the latest dump, compares row counts
for users, profiles, shifts, applications, hours, animals, and group bookings,
prints pass or fail, and drops the scratch database. The read against the
source database is counts only.

If `createdb` fails, the host does not let this login create databases. That
is normal on the Supabase pooler. Run the drill against a local Postgres, with
`DATABASE_URL` pointed at that local server and the dump file you copied off
production.

## Encrypting backups

The dump contains names, emails, phone numbers, addresses, dates of birth, and
emergency contacts. `backup-db.sh` will not leave a plaintext file. Keep
`BACKUP_ENCRYPTION_KEY` somewhere that is not the server that holds the dumps.
A backup without the key cannot be restored. Losing the key and the server
together means the data is gone.

## Still to confirm

- TODO: which machine runs the daily backup. The app host must stay on for a
  cron job. Confirm Railway, Render, or another box.
- TODO: where the encrypted file is copied after it is written. It must not be
  only on the same disk as Postgres.
- TODO: who, besides the person deploying, holds `BACKUP_ENCRYPTION_KEY`.
- TODO: how long Assisi wants off-server copies kept. The script's 14 days is
  only the local folder.
- TODO: the date a restore drill was actually run, and who ran it. The table
  in `docs/BACKUP-RESTORE.md` is still blank.

## Commands to run yourself

Do not run these against the live database until you have read the steps above.
Order:

1. `BACKUP_DIR=... BACKUP_ENCRYPTION_KEY=... ./scripts/backup-db.sh`
2. Confirm the new `.sql.gz.enc` file exists and no `.sql.gz` was left beside it.
3. On a local Postgres, `createdb shelterlink_restore_drill`
4. `./scripts/restore-db.sh <that file> shelterlink_restore_drill`
5. `BACKUP_DIR=... ./scripts/verify-restore.sh` with `DATABASE_URL` pointed at the database you just filled, or at local Postgres after you have loaded a copy.
6. `dropdb shelterlink_restore_drill` if you created it by hand.
