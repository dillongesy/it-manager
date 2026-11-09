#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# IT Manager - one-time installer for a fresh Linux server (Debian / Ubuntu).
#
#   git clone <your repo> /opt/it-manager && cd /opt/it-manager && sudo ./install.sh
#
# What it does:
#   1. Installs Docker Engine + the compose plugin (if missing)
#   2. Asks a few questions (LAN or domain, addresses) and writes .env (no secrets)
#   3. Logs in to the image registry (only needed for private images)
#   4. Locks down the host firewall: ufw for the host + DOCKER-USER rules for the
#      containers (Docker-published ports bypass plain ufw otherwise)
#   5. Pulls and starts the stack, then prints the one-time setup code
#
# Afterwards, updating is just:  ./update.sh   (git pull + compose pull + up -d)
# Re-running install.sh is safe; it keeps your existing data and secrets.
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$(pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { # ask <var> <prompt> <default>
  local __v; read -r -p "  $2 [${3}]: " __v || true
  printf -v "$1" '%s' "${__v:-$3}"
}

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo ./install.sh"
command -v apt-get >/dev/null || die "This installer supports Debian/Ubuntu (apt). See README for other distros."

# Existing settings (re-run) become the defaults.
[ -f .env ] && set -a && . ./.env && set +a

bold "1/5  Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
info "$(docker --version)"

bold "2/5  Settings"
EXT_IF="$(ip route show default | awk '{print $5; exit}')"
HOST_IP="$(ip -4 -o addr show dev "$EXT_IF" | awk '{print $4}' | cut -d/ -f1 | head -n1)"
HOST_CIDR="$(ip -4 -o route show dev "$EXT_IF" proto kernel scope link | awk '{print $1}' | head -n1)"
info "Detected interface $EXT_IF, address $HOST_IP, LAN $HOST_CIDR"

ask LAN_CIDR "LAN that may reach the Portal (CIDR)" "${LAN_CIDR:-$HOST_CIDR}"
ask MODE "Mode: 'lan' (self-signed, recommended) or 'domain' (Let's Encrypt)" "${MODE:-lan}"

if [ "$MODE" = "domain" ]; then
  ask PORTAL_HOST "Portal hostname (must resolve to this server)" "${PORTAL_HOST:-portal.example.com}"
  ask FIELD_HOST  "Field App hostname" "${FIELD_HOST:-field.example.com}"
  ask ACME_EMAIL  "Email for Let's Encrypt notices" "${ACME_EMAIL:-admin@example.com}"
  ask FIELD_PUBLIC "Allow the Field App from the internet? (yes/no)" "${FIELD_PUBLIC:-no}"
  PORTAL_SITE="$PORTAL_HOST"; PORTAL_ORIGIN="https://$PORTAL_HOST"; PORTAL_TLS="tls $ACME_EMAIL"
  FIELD_PORT=443
  FIELD_SITE="$FIELD_HOST";   FIELD_ORIGIN="https://$FIELD_HOST";   FIELD_TLS="tls $ACME_EMAIL"
else
  ask LAN_NAME "Optional local DNS name for the Portal (blank = IP only)" "${LAN_NAME:-}"
  ask FIELD_PORT "Field App HTTPS port" "${FIELD_PORT:-8443}"
  FIELD_PUBLIC=no
  PORTAL_SITE="https://$HOST_IP"; [ -n "$LAN_NAME" ] && PORTAL_SITE="$PORTAL_SITE, https://$LAN_NAME"
  PORTAL_ORIGIN="https://${LAN_NAME:-$HOST_IP}"
  PORTAL_TLS="tls internal"
  FIELD_SITE="https://$HOST_IP:$FIELD_PORT"; [ -n "$LAN_NAME" ] && FIELD_SITE="$FIELD_SITE, https://$LAN_NAME:$FIELD_PORT"
  FIELD_ORIGIN="https://${LAN_NAME:-$HOST_IP}:$FIELD_PORT"
  FIELD_TLS="tls internal"
fi
FIELD_ALLOWED_RANGES=private_ranges
[ "$FIELD_PUBLIC" = "yes" ] && FIELD_ALLOWED_RANGES="0.0.0.0/0"
# Certificate for clients that send no server name. Browsers never send one for a
# bare IP, so in LAN mode this must be the IP or https://<ip> fails to connect.
DEFAULT_SNI="$HOST_IP"
[ "$MODE" = "domain" ] && DEFAULT_SNI="$PORTAL_HOST"

DEFAULT_REG="${IMAGE_REGISTRY:-}"
if [ -z "$DEFAULT_REG" ] && git remote get-url origin >/dev/null 2>&1; then
  DEFAULT_REG="ghcr.io/$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##' | tr 'A-Z' 'a-z')"
fi
ask IMAGE_REGISTRY "Image registry" "${DEFAULT_REG:-ghcr.io/your-org/it-manager}"
ask IMAGE_TAG "Image tag" "${IMAGE_TAG:-latest}"

# Internal Docker subnets: <prefix>.0.0/24 … <prefix>.8.0/24. They must not overlap
# anything the host already routes (LAN, VPN, other Docker networks), or traffic to
# those addresses would vanish into the stack.
OLD_NET_PREFIX="${NET_PREFIX:-}"
info "Internal container networks use <prefix>.0.0 – <prefix>.8.255."
while :; do
  ask NET_PREFIX "Internal subnet prefix" "${NET_PREFIX:-172.29}"
  rc=0; NET_CHECK="$(bash "$ROOT/scripts/check-net-prefix.sh" "$NET_PREFIX")" || rc=$?
  case "$rc" in
    0) break ;;
    2) info "$NET_CHECK" ;;
    1) printf '\033[33m  %s.0.0 – %s.8.255 overlaps networks already on this host:\033[0m\n' "$NET_PREFIX" "$NET_PREFIX"
       sed 's/^/    /' <<<"$NET_CHECK"
       ask NET_FORCE "Use it anyway? (yes/no)" "no"
       [ "$NET_FORCE" = "yes" ] && break ;;
    *) die "Subnet check failed (exit $rc)" ;;
  esac
done
RECREATE_NETS=no
if [ -n "$OLD_NET_PREFIX" ] && [ "$OLD_NET_PREFIX" != "$NET_PREFIX" ] \
   && [ -n "$(docker network ls -q --filter label=com.docker.compose.project=itmanager)" ]; then
  RECREATE_NETS=yes
  info "Subnet prefix changed ($OLD_NET_PREFIX → $NET_PREFIX): the stack's networks will be recreated (data is kept)."
fi

umask 077
cat > .env <<EOF
# Written by install.sh on $(date -u +%Y-%m-%dT%H:%MZ). No secrets in here.
MODE=$MODE
LAN_CIDR=$LAN_CIDR
LAN_NAME=${LAN_NAME:-}
PORTAL_HOST=${PORTAL_HOST:-}
FIELD_HOST=${FIELD_HOST:-}
ACME_EMAIL=${ACME_EMAIL:-}
FIELD_PUBLIC=$FIELD_PUBLIC
IMAGE_REGISTRY=$IMAGE_REGISTRY
IMAGE_TAG=$IMAGE_TAG
PORTAL_SITE="$PORTAL_SITE"
PORTAL_ORIGIN=$PORTAL_ORIGIN
PORTAL_TLS="$PORTAL_TLS"
PORTAL_ALLOWED_RANGES=private_ranges
FIELD_PORT=$FIELD_PORT
FIELD_SITE="$FIELD_SITE"
FIELD_ORIGIN=$FIELD_ORIGIN
FIELD_TLS="$FIELD_TLS"
FIELD_ALLOWED_RANGES=$FIELD_ALLOWED_RANGES
DEFAULT_SNI=$DEFAULT_SNI
SKU_PREFIX=${SKU_PREFIX:-INV}
NET_PREFIX=$NET_PREFIX
EOF
umask 022
info "Wrote .env"

bold "3/5  Registry"
REG_HOST="${IMAGE_REGISTRY%%/*}"
if ! docker pull -q "$IMAGE_REGISTRY/init:$IMAGE_TAG" >/dev/null 2>&1; then
  info "Images are private (or not built yet). Log in to $REG_HOST."
  info "For GHCR: a GitHub token (classic) with only the read:packages scope."
  ask REG_USER "Registry username" "${REG_USER:-}"
  read -r -s -p "  Token: " REG_TOKEN; echo
  printf '%s' "$REG_TOKEN" | docker login "$REG_HOST" -u "$REG_USER" --password-stdin
  unset REG_TOKEN
fi

bold "4/5  Firewall"
EXT_IF="$EXT_IF" LAN_CIDR="$LAN_CIDR" FIELD_PORT="$FIELD_PORT" FIELD_PUBLIC="$FIELD_PUBLIC" MODE="$MODE" \
  bash "$ROOT/scripts/firewall.sh"

bold "5/5  Start"
docker compose pull
if [ "$RECREATE_NETS" = "yes" ]; then
  # Networks keep their subnet for life; a new prefix needs fresh ones. No -v: volumes stay.
  docker compose down --remove-orphans
fi
docker compose up -d --remove-orphans
info "Waiting for the stack to become healthy…"
for _ in $(seq 1 60); do
  if docker compose ps --format '{{.Service}} {{.Health}}' | grep -E '^(portal-api|field-api) ' | grep -vq healthy; then
    sleep 5
  else
    break
  fi
done
docker compose ps

echo
bold "Done."
info "Portal:    $PORTAL_ORIGIN"
info "Field App: $FIELD_ORIGIN"
if CODE="$(docker compose run --rm --no-deps -T init show-setup-code 2>/dev/null)"; then
  echo
  bold "  SETUP CODE: $CODE"
  info "Open the Portal and enter this code to create the first admin."
  info "Lost it? ./scripts/show-setup-code.sh"
fi
if [ "$MODE" = "lan" ]; then
  echo
  info "Browsers will warn about the self-signed certificate until you trust this"
  info "server's root CA once per PC/phone:  ./scripts/export-ca.sh"
fi
