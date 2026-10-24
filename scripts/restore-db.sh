#!/usr/bin/env bash
# Restore one dump into a database you name.
#
#   ./scripts/restore-db.sh /path/shelterlink-YYYY-MM-DD-HHMMSS.sql.gz.enc scratch_db
#   ./scripts/restore-db.sh /path/shelterlink-YYYY-MM-DD-HHMMSS.sql.gz scratch_db
#
# Refuses to run when the target name is the database in DATABASE_URL / DB_NAME,
# or when that database already has a users table, unless you pass
# --i-know-this-is-production.
#
# Encrypted dumps need BACKUP_ENCRYPTION_KEY. The decrypted SQL is written
# outside BACKUP_DIR and deleted when the script exits.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/pg-connection.sh"

allow_production=0
dump=""
target=""
for arg in "$@"; do
  case "$arg" in
    --i-know-this-is-production) allow_production=1 ;;
    *)
      if [[ -z "$dump" ]]; then
        dump="$arg"
      elif [[ -z "$target" ]]; then
        target="$arg"
      else
        echo "Unexpected argument." >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$dump" || -z "$target" ]]; then
  echo "Usage: ./scripts/restore-db.sh <dump.sql.gz|dump.sql.gz.enc> <database-name> [--i-know-this-is-production]" >&2
  exit 1
fi
if [[ ! -f "$dump" ]]; then
  echo "Dump file not found." >&2
  exit 1
fi
if [[ ! "$target" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Database name must be letters, numbers, and underscores only." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed." >&2
  exit 1
fi

pg_prepare_connection
trap 'rm -f "${PG_PASSFILE:-}" "${plain_sql:-}"' EXIT

if [[ "$target" == "$PGDATABASE" && "$allow_production" -ne 1 ]]; then
  echo "Refusing to restore into '$target'." >&2
  echo "That is the database named by DATABASE_URL or DB_NAME." >&2
  echo "Pass --i-know-this-is-production only when you mean to overwrite it." >&2
  exit 1
fi

users_present="$(psql -d "$target" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'" 2>/dev/null || true)"
if [[ "${users_present:-0}" != "0" && "$allow_production" -ne 1 ]]; then
  echo "Refusing to restore into '$target' because it already has a users table." >&2
  echo "Use an empty scratch database, or pass --i-know-this-is-production." >&2
  exit 1
fi

plain_sql="$(mktemp "${TMPDIR:-/tmp}/sl-restore.XXXXXX.sql")"
chmod 600 "$plain_sql"

case "$dump" in
  *.sql.gz.enc)
    if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
      echo "Set BACKUP_ENCRYPTION_KEY. This dump is encrypted." >&2
      exit 1
    fi
    node "$ROOT/scripts/restore-backup.js" "$dump" --out "$plain_sql"
    ;;
  *.sql.gz)
    gzip -dc "$dump" > "$plain_sql"
    ;;
  *.sql)
    cp "$dump" "$plain_sql"
    ;;
  *)
    echo "Dump must end in .sql, .sql.gz, or .sql.gz.enc." >&2
    exit 1
    ;;
esac

psql -d "$target" -v ON_ERROR_STOP=1 -f "$plain_sql"
echo "Restore finished in database '$target'."
