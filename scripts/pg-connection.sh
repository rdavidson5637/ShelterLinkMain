#!/usr/bin/env bash
# Reads DATABASE_URL or DB_* (from the environment, or from .env in the repo
# root) and prepares a Postgres connection for pg_dump, psql, and createdb.
#
# The password is written to a mode-600 pgpass file. It is not passed as a
# command argument and it is not left in PGPASSWORD. PGPASSWORD is easier to
# see in a process listing. The pgpass file is the tighter option. It exists
# only while the script runs, and the caller must delete it on exit.
#
# After this returns, DATABASE_URL is unset so child processes do not inherit
# the password inside the URL.

pg_prepare_connection() {
  local root meta
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to read the database settings." >&2
    return 1
  fi
  PG_PASSFILE="$(mktemp "${TMPDIR:-/tmp}/sl-pgpass.XXXXXX")"
  meta="$(mktemp "${TMPDIR:-/tmp}/sl-pgenv.XXXXXX")"
  chmod 600 "$PG_PASSFILE" "$meta"
  python3 - "$root" "$PG_PASSFILE" "$meta" << 'PY'
import os, sys, shlex
from urllib.parse import urlparse, unquote

root, pass_path, meta_path = sys.argv[1:]
env_path = os.path.join(root, '.env')
file_env = {}
if os.path.isfile(env_path):
    with open(env_path, encoding='utf-8') as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            file_env[key.strip()] = value.strip().strip('"').strip("'")

def setting(name, default=''):
    if os.environ.get(name, '').strip():
        return os.environ[name].strip()
    return file_env.get(name, default).strip()

url = setting('DATABASE_URL')
if url:
    parsed = urlparse(url)
    host = parsed.hostname or 'localhost'
    port = str(parsed.port or 5432)
    user = unquote(parsed.username or 'postgres')
    password = unquote(parsed.password or '')
    database = unquote((parsed.path or '').lstrip('/').split('?')[0] or 'shelterlink')
else:
    host = setting('DB_HOST', 'localhost') or 'localhost'
    port = setting('DB_PORT', '5432') or '5432'
    user = setting('DB_USER', 'postgres') or 'postgres'
    password = setting('DB_PASSWORD', '')
    database = setting('DB_NAME', 'shelterlink') or 'shelterlink'

def esc(value):
    return str(value).replace('\\', '\\\\').replace(':', '\\:')

with open(pass_path, 'w', encoding='utf-8') as handle:
    # Database column is * so createdb and the scratch database can authenticate.
    # Host, port, and user still have to match. The file is mode 600 and short-lived.
    handle.write(':'.join(esc(part) for part in (host, port, '*', user, password)) + '\n')
os.chmod(pass_path, 0o600)
with open(meta_path, 'w', encoding='utf-8') as handle:
    for key, value in (('PGHOST', host), ('PGPORT', port), ('PGUSER', user), ('PGDATABASE', database)):
        handle.write(f'export {key}={shlex.quote(value)}\n')
PY
  # shellcheck disable=SC1090
  source "$meta"
  rm -f "$meta"
  export PGPASSFILE="$PG_PASSFILE"
  unset DATABASE_URL PGPASSWORD
}
