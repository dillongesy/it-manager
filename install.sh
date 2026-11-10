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
#   3. Hardens the host firewall: ufw for the host itself, and DOCKER-USER rules for
#      the containers, because Docker-published ports bypass ufw. 80/443 (Nginx Proxy
#      Manager) are open; the Portal (8443) and the proxy's admin UI (81) accept the
#      LAN only. The setup wizard can keep or turn off this hardening once.
#   4. Schedules automatic updates (Sundays 02:00; change it in Admin > System).
#   5. Installs the host helper that applies those choices from the Portal, starts
#      the stack, and prints the Portal address and the setup code.
#
# Updating is the same as for any compose project, and is what the timer runs:
#   docker compose pull && docker compose up -d
# Re-running this script is safe: data, secrets and settings are kept.
#
# Host helper: the Portal API cannot run anything on the host. It writes a small
# request file (key=value lines) into the host_control volume; a systemd path unit
# runs `install.sh host-apply` as root, which accepts only the whitelisted settings
# below, applies them and writes status.json back for the Admin page:
#   updates=off | daily:HH | weekly:mon..sun:HH   (always accepted)
#   update=now                                     (always accepted)
#   firewall=on|off                                (accepted once, from the setup wizard)
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$(pwd)"
PROJECT=itmanager
CONF_DIR=/etc/it-manager
CONF="$CONF_DIR/install.conf"
FIREWALL_CHOICE="$CONF_DIR/firewall-choice-open"
LAST_UPDATE="$CONF_DIR/last-update"
UPDATE_UNIT=it-manager-update
HOST_UNIT=it-manager-host
DEFAULT_PRESET="weekly:sun:02"

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

# Saved answers (from an earlier run) become the defaults. Both files are written by
# this script only.
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
UPDATE_PRESET=$UPDATE_PRESET
EOF
  umask 022
}

# -- Firewall --------------------------------------------------------------------

AFTER=/etc/ufw/after.rules
MARK_BEGIN='# BEGIN IT-MANAGER DOCKER-USER'
MARK_END='# END IT-MANAGER DOCKER-USER'

remove_docker_user_block() {
  [ -f "$AFTER" ] && sed -i "/$MARK_BEGIN/,/$MARK_END/d" "$AFTER"
  return 0
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
  # Docker's FORWARD jump into DOCKER-USER; Docker recreates it when it restarts.
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
# Schedules are presets: off, daily:HH, weekly:DAY:HH (DAY = mon..sun, HH = 00..23).

PRESET_RE='^(off|daily:([01][0-9]|2[0-3])|weekly:(mon|tue|wed|thu|fri|sat|sun):([01][0-9]|2[0-3]))$'

preset_to_calendar() {
  local p="$1"
  case "$p" in
    daily:*)  echo "*-*-* ${p#daily:}:00:00" ;;
    weekly:*) local rest="${p#weekly:}"; local day="${rest%%:*}"; echo "${day^} *-*-* ${rest#*:}:00:00" ;;
  esac
}

# The update service is also what "Update now" in the Portal starts, so it exists even
# when the schedule is off.
write_update_service() {
  cat > "/etc/systemd/system/$UPDATE_UNIT.service" <<EOF
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
ExecStopPost=$ROOT/install.sh host-status update-finished
EOF
}

auto_update_on() {
  [[ "$UPDATE_PRESET" =~ $PRESET_RE ]] && [ "$UPDATE_PRESET" != off ] || die "Not a valid schedule: $UPDATE_PRESET"
  write_update_service
  cat > "/etc/systemd/system/$UPDATE_UNIT.timer" <<EOF
[Unit]
Description=Scheduled IT Manager updates

[Timer]
OnCalendar=$(preset_to_calendar "$UPDATE_PRESET")
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$UPDATE_UNIT.timer" >/dev/null 2>&1
  systemctl restart "$UPDATE_UNIT.timer"
  info "Automatic updates: $UPDATE_PRESET (next: $(next_update))."
}

auto_update_off() {
  systemctl disable --now "$UPDATE_UNIT.timer" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$UPDATE_UNIT.timer"
  systemctl daemon-reload
  UPDATE_PRESET=off
  info "Automatic updates are off. Update by hand with: docker compose pull && docker compose up -d"
}

next_update() {
  systemctl show "$UPDATE_UNIT.timer" -p NextElapseUSecRealtime --value 2>/dev/null || true
}

# -- Host helper --------------------------------------------------------------------

control_dir() { docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_host_control" 2>/dev/null; }

json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g' | tr -d '\000-\037')"; }

# Write a file into the control directory without following anything the Portal
# placed there: a new random file, then an atomic rename over the target.
write_control_file() { # write_control_file <dir> <name> <content>
  local tmp
  tmp="$(mktemp "$1/.tmp.XXXXXXXX")"
  printf '%s\n' "$3" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$1/$2"
}

# host-status [update-finished]: refresh status.json for the Admin page.
host_status() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  if [ "${1:-}" = "update-finished" ]; then
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SERVICE_RESULT:-unknown}" > "$LAST_UPDATE"
  fi
  local last_at="" last_result=""
  if [ -f "$LAST_UPDATE" ]; then read -r last_at last_result < "$LAST_UPDATE" || true; fi
  local open=false; [ -f "$FIREWALL_CHOICE" ] && open=true
  write_control_file "$dir" status.json "$(cat <<EOF
{
  "agent": true,
  "firewall": $(json_str "${FIREWALL:-unknown}"),
  "firewallChoiceOpen": $open,
  "updates": $(json_str "${UPDATE_PRESET:-off}"),
  "nextUpdate": $(json_str "$( [ "${UPDATE_PRESET:-off}" = off ] && echo "" || next_update )"),
  "lastUpdateAt": $(json_str "$last_at"),
  "lastUpdateResult": $(json_str "$last_result"),
  "updatedAt": $(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
}
EOF
)"
}

# host-apply: process one request from the Portal (run by the path unit as root).
host_apply() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || exit 0
  local req="$dir/request"
  [ -e "$req" ] || [ -L "$req" ] || exit 0

  # Copy the request (never following a link) into a private file, then check the
  # copy: the Portal can change the original at any moment.
  local copy; copy="$(mktemp)"
  rm -f "$copy"
  cp -P "$req" "$copy" 2>/dev/null || true
  rm -f "$req"
  if [ -L "$copy" ] || [ ! -f "$copy" ] || [ "$(stat -c %s "$copy")" -gt 512 ]; then
    rm -f "$copy"; exit 0
  fi

  local id="" firewall="" updates="" update="" error="" content
  content="$(cat "$copy")"
  rm -f "$copy"
  while IFS='=' read -r key value; do
    case "$key" in
      id)       [[ "$value" =~ ^[A-Za-z0-9-]{1,64}$ ]] && id="$value" ;;
      firewall) [[ "$value" =~ ^(on|off)$ ]] && firewall="$value" || error="Invalid firewall setting." ;;
      updates)  [[ "$value" =~ $PRESET_RE ]] && updates="$value" || error="Invalid update schedule." ;;
      update)   [ "$value" = now ] && update=now || error="Invalid update request." ;;
      '') ;;
      *) error="Unknown setting in request." ;;
    esac
  done <<<"$content"

  if [ -z "$error" ] && [ -n "$firewall" ]; then
    if [ -f "$FIREWALL_CHOICE" ]; then
      if [ "$firewall" = on ]; then firewall_on >/dev/null; else firewall_off >/dev/null; fi
      rm -f "$FIREWALL_CHOICE"
    else
      error="The firewall can only be changed during setup, or on the server with: sudo ./install.sh firewall on|off"
    fi
  fi
  if [ -z "$error" ] && [ -n "$updates" ]; then
    UPDATE_PRESET="$updates"
    if [ "$updates" = off ]; then auto_update_off >/dev/null; else auto_update_on >/dev/null; fi
  fi
  save_conf
  if [ -z "$error" ] && [ "$update" = now ]; then
    systemctl start --no-block "$UPDATE_UNIT.service" 2>/dev/null || error="Could not start the update."
  fi

  local ok=true; [ -n "$error" ] && ok=false
  write_control_file "$dir" result.json "{ \"id\": $(json_str "$id"), \"ok\": $ok, \"error\": $(json_str "$error") }"
  host_status
}

install_host_helper() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] || die "The host_control volume does not exist yet."
  write_update_service
  cat > "/etc/systemd/system/$HOST_UNIT.service" <<EOF
[Unit]
Description=Apply IT Manager settings requested from the Portal

[Service]
Type=oneshot
ExecStart=$ROOT/install.sh host-apply
EOF
  cat > "/etc/systemd/system/$HOST_UNIT.path" <<EOF
[Unit]
Description=Watch for IT Manager settings requests from the Portal

[Path]
PathExists=$dir/request
Unit=$HOST_UNIT.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$HOST_UNIT.path" >/dev/null 2>&1
  systemctl restart "$HOST_UNIT.path"
  host_status
  info "Host helper installed (Admin > System can change the update schedule)."
}

# -- Subcommands --------------------------------------------------------------------

case "${1:-install}" in
  firewall)
    [ -f "$CONF" ] || die "Run sudo ./install.sh first."
    case "${2:-status}" in
      on) firewall_on; rm -f "$FIREWALL_CHOICE"; save_conf; host_status ;;
      off) firewall_off; rm -f "$FIREWALL_CHOICE"; save_conf; host_status ;;
      status) firewall_status ;;
      *) die "Usage: sudo ./install.sh firewall on|off|status" ;;
    esac
    exit 0 ;;
  auto-update)
    [ -f "$CONF" ] || die "Run sudo ./install.sh first."
    case "${2:-status}" in
      on) [ "${UPDATE_PRESET:-off}" = off ] && UPDATE_PRESET="$DEFAULT_PRESET"; auto_update_on; save_conf; host_status ;;
      off) auto_update_off; save_conf; host_status ;;
      status) echo "Schedule: ${UPDATE_PRESET:-off}"; systemctl list-timers "$UPDATE_UNIT.timer" --all --no-pager 2>/dev/null | head -n 2 ;;
      *) die "Usage: sudo ./install.sh auto-update on|off|status" ;;
    esac
    exit 0 ;;
  host-apply)
    [ -f "$CONF" ] || exit 0
    host_apply; exit 0 ;;
  host-status)
    [ -f "$CONF" ] || exit 0
    host_status "${2:-}"; exit 0 ;;
  install) ;;
  *) die "Usage: sudo ./install.sh [firewall on|off|status | auto-update on|off|status]" ;;
esac

# -- Install ------------------------------------------------------------------------

command -v apt-get >/dev/null || die "This installer supports Debian and Ubuntu. See README.md for other systems."
FIRST_INSTALL=no; [ -f "$CONF" ] || FIRST_INSTALL=yes

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
   && [ -n "$(docker network ls -q --filter label=com.docker.compose.project=$PROJECT)" ]; then
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
if [ "$FIRST_INSTALL" = yes ]; then
  # Hardened by default; the setup wizard may keep it or turn it off, once.
  firewall_on
  mkdir -p "$CONF_DIR"; touch "$FIREWALL_CHOICE"
elif [ "${FIREWALL:-on}" = on ]; then
  firewall_on
else
  FIREWALL=off
  info "Firewall hardening stays off (sudo ./install.sh firewall on to enable)."
fi
# Docker recreates its FORWARD jump into DOCKER-USER when it restarts.
systemctl restart docker

bold "4/5  Automatic updates"
UPDATE_PRESET="${UPDATE_PRESET:-$DEFAULT_PRESET}"
if [ "$UPDATE_PRESET" = off ]; then auto_update_off; else auto_update_on; fi
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
for id in $(docker ps -aq --filter label=com.docker.compose.project=$PROJECT); do
  svc="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
  [[ "$SERVICES" == *" $svc "* ]] || docker rm -f "$id" >/dev/null
done
docker compose up -d --remove-orphans
install_host_helper
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
info "Portal:            https://$HOST_IP:$PORTAL_PORT"
info "Proxy admin (NPM): http://$HOST_IP:$PROXY_ADMIN_PORT"
if CODE="$(docker compose run --rm --no-deps -T init show-setup-code 2>/dev/null)"; then
  echo
  bold "  SETUP CODE: $CODE"
  info "Open the Portal and enter this code to run the setup wizard."
  info "It is also in the Portal API log: docker compose logs portal-api"
fi
echo
info "Updates: docker compose pull && docker compose up -d (scheduled: $UPDATE_PRESET)"
info "Settings: sudo ./install.sh firewall|auto-update on|off|status"
