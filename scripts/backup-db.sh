#!/usr/bin/env bash
# Gzipped Postgres dump, then encrypted with the same format as npm run backup.
#
# This is Postgres, not MySQL. pg_dump takes one consistent snapshot, which is
# the equivalent of mysqldump --single-transaction, and it includes functions
# and triggers by default (the equivalent of --routines --triggers).
#
# The password is not placed on the command line. See scripts/pg-connection.sh.
#
# Usage, from the repo root:
#   BACKUP_DIR=/var/backups/shelterlink ./scripts/backup-db.sh
#
# Requires BACKUP_DIR and BACKUP_ENCRYPTION_KEY (at least 16 characters).
# Refuses to leave a plaintext dump on disk.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/pg-connection.sh"

if [[ -z "${BACKUP_DIR:-}" ]]; then
  echo "Set BACKUP_DIR to a directory outside the database server's data disk." >&2
  exit 1
fi
if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" || ${#BACKUP_ENCRYPTION_KEY} -lt 16 ]]; then
  echo "Set BACKUP_ENCRYPTION_KEY to at least 16 characters." >&2
  echo "Refusing to write an unencrypted backup. The dump contains personal data." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is not installed. Install the Postgres client tools and re-run." >&2
  exit 1
fi

pg_prepare_connection
trap 'rm -f "${PG_PASSFILE:-}"' EXIT

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y-%m-%d-%H%M%S)"
plain="$BACKUP_DIR/shelterlink-${stamp}.sql.gz"
encrypted="$BACKUP_DIR/shelterlink-${stamp}.sql.gz.enc"

cleanup_plain() {
  rm -f "$plain" "${PG_PASSFILE:-}"
}
trap cleanup_plain EXIT

if ! pg_dump --format=plain --no-owner --no-privileges | gzip -c > "$plain"; then
  echo "pg_dump failed." >&2
  exit 1
fi
if [[ ! -s "$plain" ]]; then
  echo "pg_dump produced an empty file." >&2
  exit 1
fi

node - "$plain" "$encrypted" << 'PY'
const fs = require('fs');
const { encryptBuffer } = require('./utils/backupCrypto');
const [plain, encrypted] = process.argv.slice(2);
const body = fs.readFileSync(plain);
fs.writeFileSync(encrypted, encryptBuffer(body, process.env.BACKUP_ENCRYPTION_KEY));
PY

rm -f "$plain"
trap 'rm -f "${PG_PASSFILE:-}"' EXIT
echo "Encrypted backup written. Plaintext dump removed."
echo "$encrypted"
