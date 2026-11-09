#!/bin/sh
# ------------------------------------------------------------------------------
# init - runs before every start (docker compose up), finishes, and exits.
#
# First boot: generates every secret the stack needs and writes each service ONLY
# the secrets it needs, into its own volume (least privilege):
#
#   /secrets/portal-db   db_password                                   → portal-db (uid 70)
#   /secrets/portal-api  db_password, access/refresh secrets,
#                        encryption_key, bridge_token                  → portal-api (uid 1000)
#   /secrets/field-db    db_password                                   → field-db (uid 70)
#   /secrets/field-api   db_password, access/refresh secrets,
#                        service_token (= portal bridge_token)         → field-api (uid 1000)
#
# Containers mount their volume read-only. No secret is ever in docker-compose.yml,
# an .env file, environment variables, or `docker inspect` output.
#
#   /reveal/setup_code   one-time code that unlocks the setup wizard
#   /reveal/bundle.json  every secret, readable through the app EXACTLY ONCE; the
#                        Portal API shreds it the moment it is revealed
#
# Later boots: nothing is regenerated; ownership/permissions are re-asserted.
#
# Commands (docker compose run --rm init <cmd>):
#   (none)             normal start-up behaviour above
#   show-setup-code    print the current setup code (if setup hasn't happened)
#   new-setup-code     write and print a fresh setup code
#   clear-setup-code   remove the setup code (after an import)
#   set-encryption-key take the master key from $SET_ENCRYPTION_KEY (importing existing data)
# ------------------------------------------------------------------------------
set -eu
umask 077

P_DB=/secrets/portal-db
P_API=/secrets/portal-api
F_DB=/secrets/field-db
F_API=/secrets/field-api
REVEAL=/reveal

PG_UID=70        # postgres user in the postgres:*-alpine image
APP_UID=1000     # node user in the node:*-alpine image

hex()  { openssl rand -hex "$1"; }
pw()   { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 40; }
code() { openssl rand -hex 6 | tr 'a-f' 'A-F' | sed 's/\(....\)\(....\)\(....\)/\1-\2-\3/'; }

# write <file> <value> <uid>
write() {
  printf '%s' "$2" > "$1.tmp"
  chown "$3:$3" "$1.tmp"
  chmod 0400 "$1.tmp"
  mv -f "$1.tmp" "$1"
}

# ensure <file> <uid> <value-if-missing>
ensure() {
  if [ ! -s "$1" ]; then write "$1" "$3" "$2"; fi
}

read_secret() { cat "$1"; }

write_setup_code() {
  c="$(code)"
  printf '%s' "$c" > "$REVEAL/setup_code.tmp"
  chown "$APP_UID:$APP_UID" "$REVEAL/setup_code.tmp"
  chmod 0600 "$REVEAL/setup_code.tmp"
  mv -f "$REVEAL/setup_code.tmp" "$REVEAL/setup_code"
  echo "$c"
}

write_bundle() {
  cat > "$REVEAL/bundle.json.tmp" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "portal": {
    "ENCRYPTION_KEY": "$(read_secret $P_API/encryption_key)",
    "DB_PASSWORD": "$(read_secret $P_API/db_password)",
    "ACCESS_TOKEN_SECRET": "$(read_secret $P_API/access_token_secret)",
    "REFRESH_TOKEN_SECRET": "$(read_secret $P_API/refresh_token_secret)"
  },
  "field": {
    "DB_PASSWORD": "$(read_secret $F_API/db_password)",
    "ACCESS_TOKEN_SECRET": "$(read_secret $F_API/access_token_secret)",
    "REFRESH_TOKEN_SECRET": "$(read_secret $F_API/refresh_token_secret)"
  },
  "bridge": {
    "SERVICE_TOKEN": "$(read_secret $P_API/bridge_token)"
  }
}
EOF
  chown "$APP_UID:$APP_UID" "$REVEAL/bundle.json.tmp"
  chmod 0600 "$REVEAL/bundle.json.tmp"
  mv -f "$REVEAL/bundle.json.tmp" "$REVEAL/bundle.json"
}

fix_perms() {
  for d in "$P_DB" "$F_DB"; do chown -R "$PG_UID:$PG_UID" "$d"; chmod 0500 "$d"; done
  for d in "$P_API" "$F_API"; do chown -R "$APP_UID:$APP_UID" "$d"; chmod 0500 "$d"; done
  find "$P_DB" "$F_DB" "$P_API" "$F_API" -type f -exec chmod 0400 {} +
  # The Portal API must be able to delete (shred) files here, so it owns the dir.
  chown "$APP_UID:$APP_UID" "$REVEAL"; chmod 0700 "$REVEAL"
}

mkdir -p "$P_DB" "$P_API" "$F_DB" "$F_API" "$REVEAL"
# Root needs write access to its own volumes while working.
chmod 0700 "$P_DB" "$P_API" "$F_DB" "$F_API"

cmd="${1:-init}"

case "$cmd" in
  show-setup-code)
    if [ -s "$REVEAL/setup_code" ]; then cat "$REVEAL/setup_code"; echo
    else echo "No setup code (setup already completed, or run: new-setup-code)" >&2; exit 1; fi
    fix_perms; exit 0 ;;
  new-setup-code)
    write_setup_code; fix_perms; exit 0 ;;
  clear-setup-code)
    rm -f "$REVEAL/setup_code"; fix_perms; echo "Setup code removed."; exit 0 ;;
  set-encryption-key)
    k="${SET_ENCRYPTION_KEY:-}"
    if ! printf '%s' "$k" | grep -Eq '^[0-9a-fA-F]{64}$'; then
      echo "SET_ENCRYPTION_KEY must be 64 hex characters." >&2; exit 1
    fi
    write "$P_API/encryption_key" "$(printf '%s' "$k" | tr 'A-F' 'a-f')" "$APP_UID"
    # If the one-time bundle hasn't been revealed yet, keep it truthful.
    if [ -s "$REVEAL/bundle.json" ]; then write_bundle; fi
    fix_perms; echo "Master encryption key replaced."; exit 0 ;;
  init) ;;
  *) echo "Unknown command: $cmd" >&2; exit 2 ;;
esac

fresh=0
[ -s "$P_API/encryption_key" ] || fresh=1

# Portal
ensure "$P_API/db_password"          "$APP_UID" "$(pw)"
ensure "$P_DB/db_password"           "$PG_UID"  "$(read_secret $P_API/db_password)"
ensure "$P_API/access_token_secret"  "$APP_UID" "$(hex 64)"
ensure "$P_API/refresh_token_secret" "$APP_UID" "$(hex 64)"
ensure "$P_API/encryption_key"       "$APP_UID" "$(hex 32)"
ensure "$P_API/bridge_token"         "$APP_UID" "$(hex 32)"

# Field
ensure "$F_API/db_password"          "$APP_UID" "$(pw)"
ensure "$F_DB/db_password"           "$PG_UID"  "$(read_secret $F_API/db_password)"
ensure "$F_API/access_token_secret"  "$APP_UID" "$(hex 64)"
ensure "$F_API/refresh_token_secret" "$APP_UID" "$(hex 64)"
ensure "$F_API/service_token"        "$APP_UID" "$(read_secret $P_API/bridge_token)"

if [ "$fresh" = "1" ]; then
  write_bundle
  c="$(write_setup_code)"
  fix_perms
  echo "──────────────────────────────────────────────────────────"
  echo " First boot: secrets generated."
  echo " SETUP CODE: $c"
  echo " Open the Portal in a browser and enter this code to finish setup."
  echo "──────────────────────────────────────────────────────────"
else
  fix_perms
  echo "Secrets present; nothing to generate."
fi
