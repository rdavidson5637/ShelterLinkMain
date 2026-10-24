#!/usr/bin/env bash
# Restore the latest backup into a new scratch database and compare row counts
# with the database named by DATABASE_URL or DB_NAME.
#
# The comparison against the source database is read-only. The scratch database
# is created, filled, counted, and then dropped.
#
#   BACKUP_DIR=/var/backups/shelterlink ./scripts/verify-restore.sh
#
# Do not point this at a host where you cannot CREATE DATABASE. Supabase's
# pooler often cannot. Use a local Postgres for the drill. See the runbook.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/pg-connection.sh"

if [[ -z "${BACKUP_DIR:-}" ]]; then
  echo "Set BACKUP_DIR." >&2
  exit 1
fi
if ! command -v createdb >/dev/null 2>&1 || ! command -v dropdb >/dev/null 2>&1; then
  echo "createdb and dropdb are required." >&2
  exit 1
fi

latest="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'shelterlink-*.sql.gz' -o -name 'shelterlink-*.sql.gz.enc' \) -print | sort | tail -n 1)"
if [[ -z "$latest" ]]; then
  echo "No shelterlink dump found in BACKUP_DIR." >&2
  exit 1
fi

pg_prepare_connection
source_db="$PGDATABASE"
scratch="shelterlink_restore_$(date -u +%Y%m%d%H%M%S)"
trap 'rm -f "${PG_PASSFILE:-}"; dropdb --if-exists "$scratch" >/dev/null 2>&1 || true' EXIT

if [[ "$scratch" == "$source_db" ]]; then
  echo "Scratch name collided with the source database. Stop." >&2
  exit 1
fi

echo "Latest dump: $latest"
echo "Scratch database: $scratch"
echo "Source database (counts only): $source_db"

if ! createdb "$scratch"; then
  echo "Could not create the scratch database." >&2
  echo "If this host is Supabase, run the drill on local Postgres instead." >&2
  exit 1
fi

"$ROOT/scripts/restore-db.sh" "$latest" "$scratch"

tables=(users volunteer_profiles opportunities applications volunteer_hours animals group_bookings)
failed=0
printf '%-24s %12s %12s %s\n' "table" "source" "scratch" "result"
for table in "${tables[@]}"; do
  source_count="$(psql -d "$source_db" -tAc "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "missing")"
  scratch_count="$(psql -d "$scratch" -tAc "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "missing")"
  source_count="$(echo "$source_count" | tr -d '[:space:]')"
  scratch_count="$(echo "$scratch_count" | tr -d '[:space:]')"
  if [[ "$source_count" == "$scratch_count" && "$source_count" != "missing" ]]; then
    result="pass"
  else
    result="fail"
    failed=1
  fi
  printf '%-24s %12s %12s %s\n' "$table" "$source_count" "$scratch_count" "$result"
done

dropdb --if-exists "$scratch"
echo "Scratch database dropped."

if [[ "$failed" -ne 0 ]]; then
  echo "FAIL"
  exit 1
fi
echo "PASS"
