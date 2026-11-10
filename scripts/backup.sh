#!/usr/bin/env bash
# Back up both databases and both upload volumes to ./backups/<timestamp>/.
#
#   ./scripts/backup.sh                 data only (safe to store anywhere encrypted)
#   sudo ./scripts/backup.sh --secrets  ALSO copy the secret volumes (root only;
#                                       treat that backup like the keys themselves)
#
# Restoring onto a new server needs the data AND the Portal ENCRYPTION_KEY (from
# the one-time reveal, or from a --secrets backup) - see README "Disaster recovery".
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

WITH_SECRETS=0
[ "${1:-}" = "--secrets" ] && WITH_SECRETS=1

OUT="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
chmod 700 backups "$OUT"

echo "Dumping databases…"
docker compose exec -T portal-db pg_dump -U portal -d portal -Fc > "$OUT/portal.dump"
docker compose exec -T field-db  pg_dump -U field  -d field  -Fc > "$OUT/field.dump"

vol_tar() { # vol_tar <volume> <file>
  docker run --rm -v "itmanager_$1:/v:ro" alpine:3.20 tar -C /v -czf - . > "$2"
}

echo "Archiving uploads…"
vol_tar portal_uploads "$OUT/portal-uploads.tgz"
vol_tar field_uploads  "$OUT/field-uploads.tgz"

if [ "$WITH_SECRETS" = "1" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "--secrets requires root." >&2; exit 1; }
  echo "Archiving secret volumes…"
  for v in secrets_portal_db secrets_portal_api secrets_portal_web secrets_field_db secrets_field_api pki proxy_data proxy_letsencrypt; do
    vol_tar "$v" "$OUT/$v.tgz"
  done
fi

chmod 600 "$OUT"/*
echo "Backup written to $OUT"
ls -lh "$OUT"
