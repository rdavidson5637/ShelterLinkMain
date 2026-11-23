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

`verify-restore.sh` compares the scratch copy with the database named by
`DATABASE_URL` on the same server. That is only a useful comparison when that
server already holds a full copy. For the drill below, where a production dump
is loaded onto a separate local Postgres, use the count check in step 8
instead. Never run `verify-restore.sh` with `DATABASE_URL` pointing at
production: it runs `createdb` and a restore on whatever server that URL names.

## Restore drill on a scratch copy

This is the drill that has to be done once before ShelterLink is offered to
another rescue, and again after any change to how backups are taken. It never
writes to production. The only production step is the backup in step 1, which
reads.

Work through it in order. Write down anything that goes wrong. A drill that
fails and is written down is more useful than one that is quietly worked
around.

### Before you start

- A machine with a Postgres server you control (a laptop is fine), plus
  `psql`, `createdb`, `dropdb`, `node`, and `python3`.
- Postgres on that machine at the same major version as production or newer.
  A plain SQL dump from a newer server can fail to load on an older one.
- A checkout of this repo on that machine, with `npm ci` run.
- The encrypted dump file and `BACKUP_ENCRYPTION_KEY`. Do not paste the key
  into a shared terminal log or a ticket.
- Disk encryption on the drill machine. The restored copy is real personal
  data, including AccessNI check status.

The scripts read `DATABASE_URL` from the environment first and from `.env` in
the repo root second. If that checkout's `.env` points at production, the
scripts will connect to production unless you export `DATABASE_URL` in the
shell. Step 3 does that. Check it before every command.

### Steps

1. **Take the dump.** Someone with production access runs the same command the
   daily backup uses. Until that is decided (see "Still to confirm"), use
   `backup-db.sh`:

   ```bash
   BACKUP_DIR=/secure/path BACKUP_ENCRYPTION_KEY=... ./scripts/backup-db.sh
   ```

   Note which command made the file. `backup-db.sh` passes `--no-owner
   --no-privileges` to `pg_dump`. `npm run backup` does not, so its dump also
   contains `ALTER ... OWNER` and `GRANT` lines, which need the same roles to
   exist on the drill server.

   If `pg_dump` fails with a version mismatch, install a client at the
   production server's major version or newer. If it fails through the
   Supabase pooler, use the session or direct connection string from the
   Supabase dashboard. Do not print that string into the drill notes.

2. **Copy the file to the drill machine.** Copy only the `.sql.gz.enc` file.
   Check it is not empty:

   ```bash
   ls -l shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc
   ```

3. **Point the scripts at the local server.** In the shell you will use for
   the rest of the drill:

   ```bash
   export DATABASE_URL='postgresql://postgres@localhost:5432/postgres'
   export BACKUP_ENCRYPTION_KEY='...'
   psql -d postgres -tAc 'select current_database()'
   ```

   Adjust the user and port for your local server. The last command must
   connect to local Postgres. If it asks for the production password or hangs,
   stop.

4. **Create the role the dump expects.** Tenant tables have row-level security
   policies `TO shelterlink_tenant` (migration 033). A fresh Postgres server
   does not have that role, and the restore stops at the first missing role.
   Roles belong to the whole server, so do this once per drill machine:

   ```bash
   psql -d postgres -c "CREATE ROLE shelterlink_tenant NOLOGIN NOBYPASSRLS;"
   ```

5. **Create an empty scratch database.**

   ```bash
   createdb shelterlink_restore_drill
   ```

6. **Restore.**

   ```bash
   ./scripts/restore-db.sh shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc shelterlink_restore_drill
   ```

   The script stops at the first SQL error. If it stops:

   - `role "..." does not exist`: create that role with `NOLOGIN` as in
     step 4, then `dropdb shelterlink_restore_drill` and go back to step 5.
     A dump taken from Supabase may name Supabase's own roles. Write down
     which ones you had to create.
   - An extension or schema error (for example a Supabase-only extension):
     write down the exact message. Do not edit the dump by hand to get past
     it. Record the drill as failed and bring the message to whoever owns the
     backup. The fix belongs in how the dump is taken.

   Time this step and write the time down. It is the best guess at how long a
   real restore takes.

7. **Check that the tables exist.**

   ```bash
   psql -d shelterlink_restore_drill -c '\dt public.*'
   psql -d shelterlink_restore_drill -tAc 'select filename from schema_migrations order by filename'
   ```

   The list should match production's. Migrations 039 and 040 are not applied
   to production, so they should not appear.

8. **Compare row counts with the dump itself.** This proves every row in the
   file reached the database. It does not touch production.

   Decrypt a second copy outside `backups/`, count the rows in each `COPY`
   block, then delete it:

   ```bash
   node scripts/restore-backup.js shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc --out /tmp/sl-drill.sql
   awk '/^COPY /{t=$2; n=0; next} /^\\\.$/{if(t!="") print t, n; t=""; next} t!=""{n++}' /tmp/sl-drill.sql \
     | grep '^public\.' | sort > /tmp/sl-drill-dump-counts.txt
   rm -P /tmp/sl-drill.sql 2>/dev/null || shred -u /tmp/sl-drill.sql
   ```

   Count the same tables in the scratch database:

   ```bash
   for t in users volunteer_profiles opportunities applications volunteer_hours \
            animals group_bookings background_checks volunteer_references \
            user_documents shelters audit_log; do
     printf 'public.%s %s\n' "$t" "$(psql -d shelterlink_restore_drill -tAc "select count(*) from public.$t")"
   done | sort > /tmp/sl-drill-db-counts.txt
   join /tmp/sl-drill-dump-counts.txt /tmp/sl-drill-db-counts.txt | awk '{print $1, $2, $3, ($2==$3 ? "pass" : "FAIL")}'
   ```

   Every line must say `pass`. Run the counts as the local superuser. Row-level
   security applies only to `shelterlink_tenant`, so the superuser sees every
   row.

   Optional: if the person who took the dump also wrote down production counts
   for the same tables straight after step 1, compare them too. Expect small
   differences in tables written all the time, such as `audit_log` and
   `job_runs`. A large difference in `users` or `background_checks` is a
   failure.

9. **Spot-check one record.** Pick one test or staff account you are allowed
   to look at and confirm its shelter, role and email came back. Do not browse
   volunteer records for this. Do not start the app against the scratch copy
   with email or push configured: reminder jobs would message real people.

10. **Clean up.**

    ```bash
    dropdb shelterlink_restore_drill
    rm -f /tmp/sl-drill-dump-counts.txt /tmp/sl-drill-db-counts.txt
    ```

    Delete the copied `.sql.gz.enc` from the drill machine unless it is the
    agreed off-server copy. Unset `BACKUP_ENCRYPTION_KEY` in the shell.

11. **Record the drill** in the table in `docs/BACKUP-RESTORE.md`: date, who
    ran it, the dump's file name date, which command made it, how long the
    restore took, pass or fail, and any roles or errors from step 6.

## Still to confirm

- TODO: which machine runs the daily backup, and whether it uses
  `backup-db.sh` or `npm run backup`. The app host must stay on for a cron
  job. Confirm Railway, Render, or another box.
- TODO: where the encrypted file is copied after it is written. It must not be
  only on the same disk as Postgres.
- TODO: who, besides the person deploying, holds `BACKUP_ENCRYPTION_KEY`.
- TODO: how long Assisi wants off-server copies kept. The script's 14 days is
  only the local folder.
- TODO: `npm run backup` names files by date only, so a second run on the same
  day overwrites the first. Decide whether that matters.
- TODO: the date a restore drill was actually run, and who ran it. The table
  in `docs/BACKUP-RESTORE.md` is still blank.
