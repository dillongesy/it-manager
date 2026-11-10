#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# IT Manager installer for a Debian or Ubuntu server.
#
#   sudo ./install.sh                              install, or change settings later
#   sudo ./install.sh firewall    on|off|status    host firewall hardening
#   sudo ./install.sh auto-update on|off|status    scheduled updates
#
# A full install:
#   1. Installs Docker Engine and the compose plugin (if missing).
#   2. Asks a few questions and writes .env (no secrets).
#   3. Hardens the host firewall (on unless you decline): ufw for the host itself,
#      and DOCKER-USER rules for the containers, because Docker-published ports
#      bypass ufw. 80/443 (Nginx Proxy Manager) are open; the Portal (8443) and the
#      proxy's admin UI (81) accept the LAN only.
#   4. Schedules automatic updates (on unless you decline; default Sunday 02:00).
#   5. Starts the stack and prints the Portal address and the setup code.
#
# Updating is the same as for any compose project, and is what the timer runs:
#   docker compose pull && docker compose up -d
# Re-running this script is safe: data, secrets and settings are kept.
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$(pwd)"
CONF_DIR=/etc/it-manager
CONF="$CONF_DIR/install.conf"
UNIT=it-manager-update

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  %s\033[0m\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { # ask <var> <prompt> <default>
  local __v; read -r -p "  $2 [${3}]: " __v || true
  printf -v "$1" '%s' "${__v:-$3}"
}
yes_no() { case "${1,,}" in y|yes|on|true) return 0 ;; *) return 1 ;; esac; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo ./install.sh"

# Saved answers (from an earlier run) become the defaults.
[ -f "$CONF" ] && . "$CONF"
[ -f .env ] && set -a && . ./.env && set +a

save_conf() {
  mkdir -p "$CONF_DIR"
  umask 077
  cat > "$CONF" <<EOF
# Written by install.sh. Used by: sudo ./install.sh firewall|auto-update ...
ROOT=$ROOT
EXT_IF=$EXT_IF
LAN_CIDR=$LAN_CIDR
SSH_FROM=$SSH_FROM
PORTAL_PORT=$PORTAL_PORT
PROXY_ADMIN_PORT=$PROXY_ADMIN_PORT
NET_PREFIX=$NET_PREFIX
FIREWALL=$FIREWALL
UPDATE_SCHEDULE="$UPDATE_SCHEDULE"
EOF
  umask 022
}

# -- Firewall --------------------------------------------------------------------

AFTER=/etc/ufw/after.rules
MARK_BEGIN='# BEGIN IT-MANAGER DOCKER-USER'
MARK_END='# END IT-MANAGER DOCKER-USER'

remove_docker_user_block() {
  [ -f "$AFTER" ] && sed -i "/$MARK_BEGIN/,/$MARK_END/d" "$AFTER"
}

firewall_on() {
  : "${EXT_IF:?}" "${LAN_CIDR:?}" "${NET_PREFIX:?}"
  command -v ufw >/dev/null || { apt-get update -qq && apt-get install -y -qq ufw >/dev/null; }

  # rule <port> <source>: let new connections to a published port through.
  rule() { echo "-A DOCKER-USER -i $EXT_IF -p tcp -s $2 -m conntrack --ctorigdstport $1 --ctdir ORIGINAL -j RETURN"; }

  # The block is written before any ufw command runs: `ufw default ...` rewrites the
  # rules files and fails on any non-ASCII character in them.
  local block
  block="$(cat <<EOF
$MARK_BEGIN (managed by install.sh - do not edit)
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -s $NET_PREFIX.0.0/24 -d $NET_PREFIX.1.0/24 -j DROP
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
$(rule 80 0.0.0.0/0)
$(rule 443 0.0.0.0/0)
$(rule "$PORTAL_PORT" "$LAN_CIDR")
$(rule "$PROXY_ADMIN_PORT" "$LAN_CIDR")
-A DOCKER-USER -i $EXT_IF -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -j RETURN
COMMIT
$MARK_END
EOF
)"
  cp -n "$AFTER" "$AFTER.it-manager.bak" 2>/dev/null || true
  remove_docker_user_block
  printf '\n%s\n' "$block" >> "$AFTER"

  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  if [ "$SSH_FROM" = "any" ]; then
    ufw allow 22/tcp comment 'SSH' >/dev/null
  else
    ufw allow from "$SSH_FROM" to any port 22 proto tcp comment 'SSH (LAN)' >/dev/null
  fi
  ufw --force enable >/dev/null
  iptables -F DOCKER-USER 2>/dev/null || true
  ufw reload >/dev/null
  # Docker's FORWARD jump into DOCKER-USER; recreated by Docker on restart.
  iptables -C FORWARD -j DOCKER-USER 2>/dev/null || iptables -I FORWARD -j DOCKER-USER 2>/dev/null || true

  FIREWALL=on
  info "Firewall on. Open to all: 80, 443. LAN ($LAN_CIDR) only: $PORTAL_PORT (Portal), $PROXY_ADMIN_PORT (proxy admin)."
  info "SSH from: $SSH_FROM"
}

firewall_off() {
  remove_docker_user_block
  iptables -F DOCKER-USER 2>/dev/null || true
  if command -v ufw >/dev/null; then ufw --force disable >/dev/null; fi
  FIREWALL=off
  warn "Firewall hardening is off. The Portal still refuses non-LAN clients itself;"
  warn "make sure your router forwards only ports 80 and 443 to this server."
}

firewall_status() {
  echo "Hardening: ${FIREWALL:-unknown}"
  command -v ufw >/dev/null && ufw status | head -n 1
  if grep -q "$MARK_BEGIN" "$AFTER" 2>/dev/null; then echo "Container rules: installed"; else echo "Container rules: not installed"; fi
}

# -- Automatic updates -------------------------------------------------------------

auto_update_on() {
  systemd-analyze calendar "$UPDATE_SCHEDULE" >/dev/null 2>&1 || die "Not a valid schedule: $UPDATE_SCHEDULE (systemd OnCalendar format, e.g. \"Sun *-*-* 02:00:00\")."
  cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Update IT Manager (pull new images and restart what changed)
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=/usr/bin/docker compose pull --quiet
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStartPost=/usr/bin/docker image prune -f
EOF
  cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Scheduled IT Manager updates

[Timer]
OnCalendar=$UPDATE_SCHEDULE
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$UNIT.timer" >/dev/null 2>&1
  info "Automatic updates: $UPDATE_SCHEDULE (next: $(systemctl show "$UNIT.timer" -p NextElapseUSecRealtime --value 2>/dev/null || echo unknown))."
}

auto_update_off() {
  systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service"
  systemctl daemon-reload
  UPDATE_SCHEDULE=off
  info "Automatic updates are off. Update by hand with: docker compose pull && docker compose up -d"
}

# -- Subcommands --------------------------------------------------------------------

case "${1:-install}" in
  firewall)
    [ -f "$CONF" ] || die "Run sudo ./install.sh first."
    case "${2:-status}" in
      on) firewall_on; save_conf ;;
      off) firewall_off; save_conf ;;
      status) firewall_status ;;
      *) die "Usage: sudo ./install.sh firewall on|off|status" ;;
    esac
    exit 0 ;;
  auto-update)
    [ -f "$CONF" ] || die "Run sudo ./install.sh first."
    case "${2:-status}" in
      on) [ "${UPDATE_SCHEDULE:-off}" = off ] && UPDATE_SCHEDULE="Sun *-*-* 02:00:00"; auto_update_on; save_conf ;;
      off) auto_update_off; save_conf ;;
      status) systemctl list-timers "$UNIT.timer" --all --no-pager 2>/dev/null | head -n 2 ;;
      *) die "Usage: sudo ./install.sh auto-update on|off|status" ;;
    esac
    exit 0 ;;
  install) ;;
  *) die "Usage: sudo ./install.sh [firewall on|off|status | auto-update on|off|status]" ;;
esac

# -- Install ------------------------------------------------------------------------

command -v apt-get >/dev/null || die "This installer supports Debian and Ubuntu. See README.md for other systems."

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

ask LAN_CIDR "LAN allowed to open the Portal (CIDR)" "${LAN_CIDR:-$HOST_CIDR}"
SSH_FROM="${SSH_FROM:-$LAN_CIDR}"
info "Staff open the Portal at https://<name or IP>:8443. List every name and IP they use,"
info "so the Portal's certificate covers them (comma-separated)."
ask PORTAL_HOSTNAMES "Portal names and IPs" "${PORTAL_HOSTNAMES:-$HOST_IP}"
PORTAL_PORT="${PORTAL_PORT:-8443}"
PROXY_ADMIN_PORT="${PROXY_ADMIN_PORT:-81}"

# Internal Docker subnets: <prefix>.0.0/24 ... <prefix>.8.0/24. They must not overlap
# anything the host already routes (LAN, VPN, other Docker networks).
OLD_NET_PREFIX="${NET_PREFIX:-}"
info "Internal container networks use <prefix>.0.0 - <prefix>.8.255."
while :; do
  ask NET_PREFIX "Internal subnet prefix" "${NET_PREFIX:-172.29}"
  rc=0; NET_CHECK="$(bash "$ROOT/scripts/check-net-prefix.sh" "$NET_PREFIX")" || rc=$?
  case "$rc" in
    0) break ;;
    2) info "$NET_CHECK" ;;
    1) warn "$NET_PREFIX.0.0 - $NET_PREFIX.8.255 overlaps networks already on this host:"
       sed 's/^/    /' <<<"$NET_CHECK"
       ask NET_FORCE "Use it anyway? (yes/no)" "no"
       yes_no "$NET_FORCE" && break ;;
    *) die "Subnet check failed (exit $rc)" ;;
  esac
done
RECREATE_NETS=no
if [ -n "$OLD_NET_PREFIX" ] && [ "$OLD_NET_PREFIX" != "$NET_PREFIX" ] \
   && [ -n "$(docker network ls -q --filter label=com.docker.compose.project=itmanager)" ]; then
  RECREATE_NETS=yes
  info "Subnet prefix changed ($OLD_NET_PREFIX -> $NET_PREFIX): the stack's networks will be recreated (data is kept)."
fi

umask 077
{
  echo "# Written by install.sh on $(date -u +%Y-%m-%dT%H:%MZ). No secrets in here. See .env.example."
  echo "PORTAL_HOSTNAMES=$PORTAL_HOSTNAMES"
  echo "NET_PREFIX=$NET_PREFIX"
  [ "$PORTAL_PORT" != 8443 ] && echo "PORTAL_PORT=$PORTAL_PORT"
  [ "$PROXY_ADMIN_PORT" != 81 ] && echo "PROXY_ADMIN_PORT=$PROXY_ADMIN_PORT"
  [ -n "${IMAGE_REGISTRY:-}" ] && echo "IMAGE_REGISTRY=$IMAGE_REGISTRY"
  [ -n "${IMAGE_TAG:-}" ] && echo "IMAGE_TAG=$IMAGE_TAG"
  [ -n "${SKU_PREFIX:-}" ] && echo "SKU_PREFIX=$SKU_PREFIX"
  true
} > .env
umask 022
info "Wrote .env"

bold "3/5  Firewall"
ask HARDEN "Harden the host firewall? (yes/no)" "$( [ "${FIREWALL:-on}" = off ] && echo no || echo yes )"
if yes_no "$HARDEN"; then firewall_on; else firewall_off; fi
# Docker re-creates its FORWARD jump into DOCKER-USER when it restarts.
systemctl restart docker

bold "4/5  Automatic updates"
info "Schedule in systemd OnCalendar format, or 'off'."
ask UPDATE_SCHEDULE "Update schedule" "${UPDATE_SCHEDULE:-Sun *-*-* 02:00:00}"
if [ "$UPDATE_SCHEDULE" = off ]; then auto_update_off; else auto_update_on; fi
save_conf

bold "5/5  Start"
docker compose pull || die "Could not pull the images. If they are private, run: docker login ghcr.io"
if [ "$RECREATE_NETS" = yes ]; then
  # A network keeps its subnet for life; a new prefix needs new networks. Volumes stay.
  docker compose down --remove-orphans
fi
# Remove containers of services no longer in docker-compose.yml first, so the ports
# they held are free for the services that replace them.
SERVICES=" $(docker compose config --services | tr '\n' ' ') "
for id in $(docker ps -aq --filter label=com.docker.compose.project=itmanager); do
  svc="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
  [[ "$SERVICES" == *" $svc "* ]] || docker rm -f "$id" >/dev/null
done
docker compose up -d --remove-orphans
info "Waiting for the services to become healthy..."
for _ in $(seq 1 60); do
  if docker compose ps --format '{{.Service}} {{.Health}}' | grep -E '^(portal-web|portal-api|field-api) ' | grep -vq ' healthy$'; then
    sleep 5
  else
    break
  fi
done
docker compose ps

echo
bold "Done."
info "Portal:           https://$HOST_IP:$PORTAL_PORT"
info "Proxy admin (NPM): http://$HOST_IP:$PROXY_ADMIN_PORT"
if CODE="$(docker compose run --rm --no-deps -T init show-setup-code 2>/dev/null)"; then
  echo
  bold "  SETUP CODE: $CODE"
  info "Open the Portal and enter this code to run the setup wizard."
  info "It is also in the Portal API log: docker compose logs portal-api"
fi
echo
info "Updates: docker compose pull && docker compose up -d"
info "Settings: sudo ./install.sh firewall|auto-update on|off|status"
