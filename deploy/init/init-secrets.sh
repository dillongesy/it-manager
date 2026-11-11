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
#   /secrets/field-api   db_password, access/refresh secrets, encryption_key,
#                        service_token (= portal bridge_token)         → field-api (uid 1000)
#   /secrets/portal-web  cert.pem, key.pem, ca.crt (Portal HTTPS)      → portal-web (uid 101) and
#                                                                        the setup wizard (gid 1000)
#   /secrets/field-web   cert.pem, key.pem (Field App office HTTPS)    → field-web (uid 101)
#   /pki                 the local CA's private key (init only)
#
# The Portal's HTTPS certificate, and the one the Field App uses on the office network,
# are signed by a local CA created on first boot. Each covers localhost plus
# PORTAL_HOSTNAMES (comma-separated names and IPs) and is re-issued when that list
# changes or less than 90 days remain. The two have separate keys. Installing ca.crt as
# a trusted root on each device removes the browser warning.
#
# Containers mount their volume read-only. No secret is ever in docker-compose.yml,
# an .env file, environment variables, or `docker inspect` output.
#
#   /host-control        settings requests from the Portal to the host helper, and a
#                        copy of the setup code for the setup wizard (until setup is done)
#   /reveal/setup_code   one-time code that unlocks the setup wizard
#   /reveal/bundle.json  every secret, readable through the app EXACTLY ONCE; the
#                        Portal API shreds it the moment it is revealed
#
# Later boots: nothing is regenerated; ownership/permissions are re-asserted.
#
# Commands (docker compose run --rm init <cmd>):
#   (none)             normal start-up behaviour above
#   show-setup-code    print the current setup code (if setup hasn't happened)
#   new-setup-code     write and print a fresh setup code (the Portal API also creates
#                      one on start-up if none exists while setup is pending)
#   clear-setup-code   remove the setup code (after an import)
#   set-encryption-key take the Portal key from $SET_ENCRYPTION_KEY and/or the Field key
#                      from $SET_FIELD_ENCRYPTION_KEY (restoring or importing data)
# ------------------------------------------------------------------------------
set -eu
umask 077

P_DB=/secrets/portal-db
P_API=/secrets/portal-api
F_DB=/secrets/field-db
F_API=/secrets/field-api
P_WEB=/secrets/portal-web
F_WEB=/secrets/field-web
PKI=/pki
REVEAL=/reveal
HOST_CONTROL=/host-control

PG_UID=70        # postgres user in the postgres:*-alpine image
APP_UID=1000     # node user in the node:*-alpine image
WEB_UID=101      # nginx user in the nginx-unprivileged image

CA_DAYS=3650
LEAF_DAYS=800    # under Apple's 825-day limit for TLS server certificates
RENEW_SECONDS=7776000   # re-issue when less than 90 days remain

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
    "REFRESH_TOKEN_SECRET": "$(read_secret $F_API/refresh_token_secret)",
    "ENCRYPTION_KEY": "$(read_secret $F_API/encryption_key)"
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

# Subject alternative names for the Portal certificate, e.g. "DNS:localhost,IP:127.0.0.1,IP:192.168.1.10".
portal_sans() {
  out="DNS:localhost,IP:127.0.0.1"
  for h in $(printf '%s' "${PORTAL_HOSTNAMES:-}" | tr ',' ' '); do
    if printf '%s' "$h" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then out="$out,IP:$h"
    elif printf '%s' "$h" | grep -Eq '^[A-Za-z0-9.-]+$'; then out="$out,DNS:$h"
    else echo "Ignoring invalid PORTAL_HOSTNAMES entry: $h" >&2; fi
  done
  printf '%s' "$out"
}

ensure_ca() {
  if [ ! -s "$PKI/ca.key" ] || [ ! -s "$PKI/ca.crt" ]; then
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$PKI/ca.key" 2>/dev/null
    openssl req -x509 -new -key "$PKI/ca.key" -sha256 -days "$CA_DAYS"       -subj "/O=IT Manager/CN=IT Manager Local CA $(hex 4)"       -addext "basicConstraints=critical,CA:TRUE,pathlen:0"       -addext "keyUsage=critical,keyCertSign,cRLSign"       -out "$PKI/ca.crt"
    rm -f "$PKI/leaf.crt" "$PKI/field.crt"
    echo "Created the local certificate authority."
  fi
}

# issue_leaf <name> <common name> <output dir>: keep $PKI/<name>.crt current for the
# SANs, then copy the chain and key into the output dir.
issue_leaf() {
  name="$1"; cn="$2"; out="$3"
  sans="$(portal_sans)"
  if [ -s "$PKI/$name.crt" ] && [ "$(cat "$PKI/$name.sans" 2>/dev/null)" = "$sans" ]      && openssl x509 -in "$PKI/$name.crt" -noout -checkend "$RENEW_SECONDS" >/dev/null; then
    :
  else
    ext="$(mktemp)"
    printf 'basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=%s
'       "$sans" > "$ext"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$PKI/$name.key" 2>/dev/null
    openssl req -new -key "$PKI/$name.key" -subj "/O=IT Manager/CN=$cn" -out "$PKI/$name.csr"
    openssl x509 -req -in "$PKI/$name.csr" -CA "$PKI/ca.crt" -CAkey "$PKI/ca.key" -CAcreateserial       -sha256 -days "$LEAF_DAYS" -extfile "$ext" -out "$PKI/$name.crt" 2>/dev/null
    rm -f "$ext" "$PKI/$name.csr"
    printf '%s' "$sans" > "$PKI/$name.sans"
    echo "Issued the $cn certificate for: $sans"
  fi
  cat "$PKI/$name.crt" "$PKI/ca.crt" > "$out/cert.pem.tmp" && mv -f "$out/cert.pem.tmp" "$out/cert.pem"
  cp "$PKI/$name.key" "$out/key.pem.tmp" && mv -f "$out/key.pem.tmp" "$out/key.pem"
}

ensure_tls() {
  ensure_ca
  issue_leaf leaf "IT Manager Portal" "$P_WEB"
  cp "$PKI/ca.crt" "$P_WEB/ca.crt.tmp" && mv -f "$P_WEB/ca.crt.tmp" "$P_WEB/ca.crt"
  issue_leaf field "IT Manager Field App" "$F_WEB"
}

# Keep the setup wizard's copy of the setup code in step with the Portal's.
sync_setup_code() {
  if [ -s "$REVEAL/setup_code" ]; then
    cp "$REVEAL/setup_code" "$HOST_CONTROL/setup_code.tmp"
    chown "$APP_UID:$APP_UID" "$HOST_CONTROL/setup_code.tmp"; chmod 0600 "$HOST_CONTROL/setup_code.tmp"
    mv -f "$HOST_CONTROL/setup_code.tmp" "$HOST_CONTROL/setup_code"
  else
    rm -f "$HOST_CONTROL/setup_code"
  fi
}

fix_perms() {
  for d in "$P_DB" "$F_DB"; do chown -R "$PG_UID:$PG_UID" "$d"; chmod 0500 "$d"; done
  for d in "$P_API" "$F_API"; do chown -R "$APP_UID:$APP_UID" "$d"; chmod 0500 "$d"; done
  find "$P_DB" "$F_DB" "$P_API" "$F_API" -type f -exec chmod 0400 {} +
  # Owner nginx (portal-web); group 1000 for the setup wizard, which serves the same certificate.
  chown -R "$WEB_UID:$APP_UID" "$P_WEB"; chmod 0550 "$P_WEB"
  find "$P_WEB" -type f -exec chmod 0440 {} +
  chown -R "$WEB_UID:$WEB_UID" "$F_WEB"; chmod 0500 "$F_WEB"
  find "$F_WEB" -type f -exec chmod 0400 {} +
  chown -R 0:0 "$PKI"; chmod 0700 "$PKI"; find "$PKI" -type f -exec chmod 0600 {} +
  # The Portal API must be able to delete (shred) files here, so it owns the dir.
  chown "$APP_UID:$APP_UID" "$REVEAL"; chmod 0700 "$REVEAL"
  # Settings requests for the host helper: written by the Portal API, read by root.
  chown "$APP_UID:$APP_UID" "$HOST_CONTROL"; chmod 0755 "$HOST_CONTROL"
  sync_setup_code
}

mkdir -p "$P_DB" "$P_API" "$F_DB" "$F_API" "$P_WEB" "$F_WEB" "$PKI" "$REVEAL" "$HOST_CONTROL"
# Root needs write access to its own volumes while working.
chmod 0700 "$P_DB" "$P_API" "$F_DB" "$F_API" "$P_WEB" "$F_WEB" "$PKI"

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
    k="${SET_ENCRYPTION_KEY:-}"; fk="${SET_FIELD_ENCRYPTION_KEY:-}"
    [ -n "$k" ] || [ -n "$fk" ] || { echo "Set SET_ENCRYPTION_KEY and/or SET_FIELD_ENCRYPTION_KEY." >&2; exit 1; }
    for v in "$k" "$fk"; do
      if [ -n "$v" ] && ! printf '%s' "$v" | grep -Eq '^[0-9a-fA-F]{64}$'; then
        echo "Encryption keys must be 64 hex characters." >&2; exit 1
      fi
    done
    [ -n "$k" ] && write "$P_API/encryption_key" "$(printf '%s' "$k" | tr 'A-F' 'a-f')" "$APP_UID"
    [ -n "$fk" ] && write "$F_API/encryption_key" "$(printf '%s' "$fk" | tr 'A-F' 'a-f')" "$APP_UID"
    # If the one-time bundle hasn't been revealed yet, keep it truthful.
    if [ -s "$REVEAL/bundle.json" ]; then write_bundle; fi
    fix_perms; echo "Encryption key(s) replaced."; exit 0 ;;
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
ensure "$F_API/encryption_key"       "$APP_UID" "$(hex 32)"
ensure "$F_API/service_token"        "$APP_UID" "$(read_secret $P_API/bridge_token)"

# HTTPS for the Portal and for the Field App on the office network
ensure_tls

if [ "$fresh" = "1" ]; then
  write_bundle
  c="$(write_setup_code)"
  fix_perms
  echo "──────────────────────────────────────────────────────────"
  echo " First boot: secrets generated."
  echo " SETUP CODE: $c"
  echo " Open https://<server> in a browser and enter this code to finish setup."
  echo " The Portal API also prints it in its log until setup is complete."
  echo "──────────────────────────────────────────────────────────"
else
  fix_perms
  echo "Secrets present; nothing to generate."
fi
