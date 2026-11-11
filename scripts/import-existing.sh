#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# Load another installation's data into this stack: a legacy, non-Docker install of the
# app, or loose database dumps. (This stack's own backups are restored with
# sudo ./install.sh backup restore; see README, "Backups and disaster recovery".)
#
# What you need (from the old servers):
#   portal.dump / field.dump   pg_dump custom-format dumps. On a legacy server:
#                                pg_dump -Fc --no-owner --no-acl -U <user> <portal db> > portal.dump
#                                pg_dump -Fc --no-owner --no-acl -U <user> <field db>  > field.dump
#   *-uploads.tgz              the uploads folders:  tar -C <backend>/uploads -czf portal-uploads.tgz .
#   the ENCRYPTION_KEY         from the one-time reveal, a --secrets backup, or the old
#                              portal/backend/.env - without it stored passwords can't be decrypted
#   old-portal.env (optional)  a legacy .env whose integration settings should be copied
#                              into Admin → Integrations
#
# Then on this server (stack installed and running; the setup wizard is not needed):
#   sudo ./scripts/import-existing.sh #     --portal-dump portal.dump [--field-dump field.dump] #     --encryption-key <64 hex chars> #     [--portal-uploads portal-uploads.tgz] [--field-uploads field-uploads.tgz] #     [--portal-env old-portal.env]
#
# This REPLACES the data in this stack. Users and logins from the import keep working.
# ------------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

PORTAL_DUMP= FIELD_DUMP= KEY= PORTAL_UP= FIELD_UP= PORTAL_ENV=
while [ $# -gt 0 ]; do
  case "$1" in
    --portal-dump) PORTAL_DUMP="$2"; shift 2 ;;
    --field-dump) FIELD_DUMP="$2"; shift 2 ;;
    --encryption-key) KEY="$2"; shift 2 ;;
    --portal-uploads) PORTAL_UP="$2"; shift 2 ;;
    --field-uploads) FIELD_UP="$2"; shift 2 ;;
    --portal-env) PORTAL_ENV="$2"; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$PORTAL_DUMP" ] && [ -n "$KEY" ] || { echo "--portal-dump and --encryption-key are required." >&2; exit 2; }
printf '%s' "$KEY" | grep -Eq '^[0-9a-fA-F]{64}$' || { echo "Encryption key must be 64 hex characters." >&2; exit 2; }

echo "This will ERASE the Portal${FIELD_DUMP:+ and Field} data in this stack and replace it with the import."
read -r -p "Type IMPORT to continue: " ok
[ "$ok" = "IMPORT" ] || exit 1

echo "Stopping app containers…"
docker compose stop proxy portal-web portal-api field-web field-api

echo "Installing the imported master encryption key…"
docker compose run --rm --no-deps -T -e SET_ENCRYPTION_KEY="$KEY" init set-encryption-key

restore() { # restore <db-service> <db/user> <dump>
  docker compose up -d "$1"
  until docker compose exec -T "$1" pg_isready -U "$2" -d "$2" >/dev/null 2>&1; do sleep 2; done
  docker compose exec -T "$1" psql -v ON_ERROR_STOP=1 -U "$2" -d "$2" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  docker compose exec -T "$1" pg_restore --no-owner --no-acl --role="$2" -U "$2" -d "$2" < "$3"
}

echo "Restoring Portal database…"
restore portal-db portal "$PORTAL_DUMP"
if [ -n "$FIELD_DUMP" ]; then
  echo "Restoring Field database…"
  restore field-db field "$FIELD_DUMP"
fi

untar() { # untar <volume> <tgz>
  docker run --rm -i -v "itmanager_$1:/v" alpine:3.20 sh -c 'tar -C /v -xzf - && chown -R 1000:1000 /v' < "$2"
}
[ -n "$PORTAL_UP" ] && { echo "Restoring Portal uploads…"; untar portal_uploads "$PORTAL_UP"; }
[ -n "$FIELD_UP" ]  && { echo "Restoring Field uploads…";  untar field_uploads  "$FIELD_UP"; }

# The imported database already has users, so the setup wizard will never run.
docker compose run --rm --no-deps -T init clear-setup-code

echo "Starting the stack (migrations bring the imported schema up to date)…"
docker compose up -d

if [ -n "$PORTAL_ENV" ]; then
  echo "Importing integration settings from $PORTAL_ENV…"
  until [ "$(docker compose ps --format '{{.Health}}' portal-api)" = "healthy" ]; do sleep 3; done
  docker compose exec -T portal-api node scripts/import-integrations.js - < "$PORTAL_ENV"
fi

echo "Import complete. Sign in with an existing login from the imported data."
echo "The one-time recovery bundle (Admin → Security) now contains the imported key."
