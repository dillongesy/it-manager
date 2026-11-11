#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# IT Manager installer for a Debian or Ubuntu server.
#
#   sudo ./install.sh                              stage 1 of a new installation, or
#                                                  repair an existing one
#   sudo ./install.sh firewall    on|off|status    firewall hardening of the app's ports
#   sudo ./install.sh auto-update on|off|status    scheduled updates
#   sudo ./install.sh backup ...                   backups (see scripts/backup.sh), e.g.
#                                                  backup run | list | restore <name>
#   sudo ./install.sh proxy-version <major>        move Nginx Proxy Manager to another
#                                                  major version (e.g. 3)
#
# A new installation has three stages:
#   1. This script: installs Docker, generates the secrets and the Portal's certificate,
#      installs the host helper and starts the setup wizard. Nothing is asked here.
#   2. The setup wizard at https://<server>: network, firewall, certificate validation
#      and update settings.
#   3. The wizard asks the host helper to install; the browser shows the live log
#      (image downloads, container start-up), then continues with the Portal setup.
#
# Updating afterwards is the same as for any compose project, and is what the
# scheduled update runs:  docker compose pull && docker compose up -d
#
# Host helper: the setup wizard and the Portal cannot run anything on the host. They
# write a small request file (key=value lines) into the host_control volume; a systemd
# path unit runs `install.sh host-apply` as root, which accepts only:
#   updates=off | daily:HH | weekly:DAY:HH    the update schedule (any time)
#   update=now                                start an update (any time)
#   check-prefix=A.B                          check a subnet prefix (during setup only)
#   install=start + lan, names, prefix,       install with the wizard's settings
#     firewall, acme, updates                 (during setup only)
#   network=apply + lan, names                change the office network and the Portal's
#                                             DNS names (once installed); re-issues the
#                                             certificates and restarts the web containers
#   backup-settings=save + backup-*           backup schedule, retention, storage and
#                                             options (once installed; tested before saving;
#                                             with backup-test=1, only tested)
#   backup=now | backup-verify=NAME |         backup tasks (once installed)
#     backup-delete=NAME | backup-protect=NAME:on|off |
#     backup-restore=NAME | backup-list=refresh
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$(pwd)"
PROJECT=itmanager
CONF_DIR=/etc/it-manager
CONF="$CONF_DIR/install.conf"
LAST_UPDATE="$CONF_DIR/last-update"
LAST_BACKUP="$CONF_DIR/last-backup"
SMB_CRED="$CONF_DIR/backup-smb.cred"
PASS_DIR="$CONF_DIR/backup-passphrases"
PROXY_LATEST="$CONF_DIR/proxy-latest"
UPDATE_UNIT=it-manager-update
BACKUP_UNIT=it-manager-backup
BACKUP_JOB=it-manager-backup-task
HOST_UNIT=it-manager-host
FIREWALL_UNIT=it-manager-firewall
DEFAULT_PRESET="weekly:sun:02"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  %s\033[0m\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo ./install.sh"

# Saved settings from an earlier run. Written by this script only.
[ -f "$CONF" ] && . "$CONF"
STATE="${STATE:-new}"
PORTAL_PORT="${PORTAL_PORT:-443}"
PROXY_HTTPS_PORT="${PROXY_HTTPS_PORT:-4443}"
PROXY_ADMIN_PORT="${PROXY_ADMIN_PORT:-81}"
FIELD_LAN_PORT="${FIELD_LAN_PORT:-4433}"
PROXY_TAG="${PROXY_TAG:-2}"
# Backups (scripts/backup.sh). On by default: daily at 01:00, before the default update
# time, to a folder on this server until a network share is chosen in Admin → Backups.
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-daily:01:00}"
BACKUP_STORAGE="${BACKUP_STORAGE:-local}"
BACKUP_PATH="${BACKUP_PATH:-/var/backups/it-manager}"
BACKUP_SHARE="${BACKUP_SHARE:-}"
BACKUP_USER="${BACKUP_USER:-}"
BACKUP_DOMAIN="${BACKUP_DOMAIN:-}"
BACKUP_KEEP="${BACKUP_KEEP:-3,0,0,0,0}"
BACKUP_COMPRESS="${BACKUP_COMPRESS:-zstd}"
BACKUP_SECRETS="${BACKUP_SECRETS:-off}"
BACKUP_VERIFY="${BACKUP_VERIFY:-on}"

save_conf() {
  mkdir -p "$CONF_DIR"
  umask 077
  {
  cat <<EOF
# Written by install.sh.
STATE=$STATE
ROOT=$ROOT
EXT_IF=$EXT_IF
HOST_IP=$HOST_IP
HOST_CIDR=$HOST_CIDR
LAN_CIDR=$LAN_CIDR
NET_PREFIX=$NET_PREFIX
PORTAL_HOSTNAMES=$PORTAL_HOSTNAMES
PORTAL_PORT=$PORTAL_PORT
PROXY_HTTPS_PORT=$PROXY_HTTPS_PORT
PROXY_ADMIN_PORT=$PROXY_ADMIN_PORT
FIELD_LAN_PORT=$FIELD_LAN_PORT
FIREWALL=$FIREWALL
ACME=$ACME
UPDATE_PRESET=$UPDATE_PRESET
PROXY_TAG=$PROXY_TAG
EOF
  # Values that may hold spaces (share names) are quoted for the shell.
  local v
  for v in BACKUP_SCHEDULE BACKUP_STORAGE BACKUP_PATH BACKUP_SHARE BACKUP_USER BACKUP_DOMAIN \
           BACKUP_KEEP BACKUP_COMPRESS BACKUP_SECRETS BACKUP_VERIFY; do
    printf '%s=%q\n' "$v" "${!v}"
  done
  } > "$CONF"
  umask 022
}

write_env() {
  umask 077
  {
    echo "# Written by install.sh. No secrets in here. See .env.example."
    echo "PORTAL_HOSTNAMES=$PORTAL_HOSTNAMES"
    echo "NET_PREFIX=$NET_PREFIX"
    echo "PORTAL_ALLOWED_SOURCES=\"$(tr ',' ' ' <<<"$LAN_CIDR")\""
    [ "$PORTAL_PORT" != 443 ] && echo "PORTAL_PORT=$PORTAL_PORT"
    [ "$PROXY_HTTPS_PORT" != 4443 ] && echo "PROXY_HTTPS_PORT=$PROXY_HTTPS_PORT"
    [ "$PROXY_ADMIN_PORT" != 81 ] && echo "PROXY_ADMIN_PORT=$PROXY_ADMIN_PORT"
    [ "$FIELD_LAN_PORT" != 4433 ] && echo "FIELD_LAN_PORT=$FIELD_LAN_PORT"
    echo "PROXY_TAG=$PROXY_TAG"
    [ -n "${IMAGE_REGISTRY:-}" ] && echo "IMAGE_REGISTRY=$IMAGE_REGISTRY"
    [ -n "${IMAGE_TAG:-}" ] && echo "IMAGE_TAG=$IMAGE_TAG"
    true
  } > "$ROOT/.env"
  umask 022
}

# -- Firewall: the app's published ports (DOCKER-USER) ---------------------------------
# Docker-published ports bypass the host's INPUT rules, so these rules live in Docker's
# DOCKER-USER chain. They are re-applied by a systemd unit whenever Docker starts. Other
# services on the host (SSH, for example) are not affected.

firewall_apply() {
  : "${EXT_IF:?}" "${LAN_CIDR:?}" "${NET_PREFIX:?}"
  iptables -N DOCKER-USER 2>/dev/null || true
  iptables -F DOCKER-USER
  local rule="-i $EXT_IF -p tcp -m conntrack --ctdir ORIGINAL"
  # The networks of the Field App's entrances must never reach the Portal's network.
  iptables -A DOCKER-USER -s "$NET_PREFIX.0.0/24" -d "$NET_PREFIX.1.0/24" -j DROP
  iptables -A DOCKER-USER -s "$NET_PREFIX.9.0/24" -d "$NET_PREFIX.1.0/24" -j DROP
  iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  # Open to everyone (through the router): the Field App, and port 80 for HTTP validation.
  iptables -A DOCKER-USER $rule --ctorigdstport "$PROXY_HTTPS_PORT" -j RETURN
  [ "${ACME:-dns}" = http ] && iptables -A DOCKER-USER $rule --ctorigdstport 80 -j RETURN
  # Office network only: the Portal, the Field App's office port, the proxy admin page,
  # and port 80 otherwise.
  local lan
  for lan in $(tr ',' ' ' <<<"$LAN_CIDR"); do
    iptables -A DOCKER-USER $rule -s "$lan" --ctorigdstport "$PORTAL_PORT" -j RETURN
    iptables -A DOCKER-USER $rule -s "$lan" --ctorigdstport "$FIELD_LAN_PORT" -j RETURN
    iptables -A DOCKER-USER $rule -s "$lan" --ctorigdstport "$PROXY_ADMIN_PORT" -j RETURN
    [ "${ACME:-dns}" = http ] || iptables -A DOCKER-USER $rule -s "$lan" --ctorigdstport 80 -j RETURN
  done
  iptables -A DOCKER-USER -i "$EXT_IF" -m conntrack --ctstate NEW -j DROP
  iptables -A DOCKER-USER -j RETURN
  iptables -C FORWARD -j DOCKER-USER 2>/dev/null || iptables -I FORWARD -j DOCKER-USER
}

firewall_on() {
  cat > "/etc/systemd/system/$FIREWALL_UNIT.service" <<EOF
[Unit]
Description=IT Manager firewall rules for the app's published ports
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$ROOT/install.sh firewall-apply

[Install]
WantedBy=multi-user.target docker.service
EOF
  systemctl daemon-reload
  systemctl enable "$FIREWALL_UNIT.service" >/dev/null 2>&1
  systemctl restart "$FIREWALL_UNIT.service"
  FIREWALL=on
  info "Firewall on. Open to everyone: $PROXY_HTTPS_PORT (Field App)$( [ "${ACME:-dns}" = http ] && echo ', 80')."
  info "Office network ($LAN_CIDR) only: $PORTAL_PORT (Portal), $FIELD_LAN_PORT (Field App), $PROXY_ADMIN_PORT (proxy admin)$( [ "${ACME:-dns}" = http ] || echo ', 80')."
}

firewall_off() {
  systemctl disable --now "$FIREWALL_UNIT.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$FIREWALL_UNIT.service"
  systemctl daemon-reload
  iptables -F DOCKER-USER 2>/dev/null || true
  iptables -A DOCKER-USER -j RETURN 2>/dev/null || true
  FIREWALL=off
  warn "Firewall hardening is off. The Portal still refuses addresses outside the office network."
}

firewall_status() {
  echo "Hardening: ${FIREWALL:-unknown}"
  iptables -S DOCKER-USER 2>/dev/null | sed 's/^/  /'
}

# -- Automatic updates -------------------------------------------------------------------
# Schedules are presets: off, daily:HH, weekly:DAY:HH (DAY = mon..sun, HH = 00..23).

PRESET_RE='^(off|daily:([01][0-9]|2[0-3])|weekly:(mon|tue|wed|thu|fri|sat|sun):([01][0-9]|2[0-3]))$'

preset_to_calendar() {
  local p="$1"
  case "$p" in
    daily:*)  echo "*-*-* ${p#daily:}:00:00" ;;
    weekly:*) local rest="${p#weekly:}"; local day="${rest%%:*}"; echo "${day^} *-*-* ${rest#*:}:00:00" ;;
  esac
}

# The update service is also what "Update now" starts, so it exists even when the
# schedule is off.
write_update_service() {
  cat > "/etc/systemd/system/$UPDATE_UNIT.service" <<EOF
[Unit]
Description=Update IT Manager (pull new images and restart what changed)
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
TimeoutStartSec=1h
ExecStart=$ROOT/install.sh run-update
EOF
  systemctl daemon-reload
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
  write_update_service
  UPDATE_PRESET=off
  info "Automatic updates are off. Update by hand with: docker compose pull && docker compose up -d"
}

next_update() {
  systemctl show "$UPDATE_UNIT.timer" -p NextElapseUSecRealtime --value 2>/dev/null || true
}

# run-update: what the update service runs; the output is kept for Admin > System.
run_update() {
  local dir log result=success
  dir="$(control_dir)"
  log="${dir:-/tmp}/update.log"
  {
    echo "==> Update started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cd "$ROOT"
    # Every update starts from a fresh backup; without one, the update does not run.
    echo "Backing up before the update (log: Admin → Backups)…"
    if run_backup_logged pre-update; then
      echo "Backup done."
    else
      result=skipped
      echo "The backup before the update failed, so the update was not started."
      echo "See the backup log in Admin → Backups, fix the backup, then update again."
      echo "==> FAILED"
    fi
    if [ "$result" = success ]; then
      if docker compose --progress plain pull && docker compose --progress plain up -d --remove-orphans; then
        docker image prune -f
        echo "==> DONE"
      else
        result=failed
        echo "==> FAILED"
      fi
    fi
  } > "$log.tmp" 2>&1
  mv -f "$log.tmp" "$log"; chmod 0644 "$log"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$result" > "$LAST_UPDATE"
  host_status
  [ "$result" = success ]
}

# -- Backups ------------------------------------------------------------------------------
# Schedules: off, daily:HH:MM, weekly:DAY[,DAY…]:HH:MM (DAY = mon..sun).

BACKUP_RE='^(off|daily:([01][0-9]|2[0-3]):[0-5][0-9]|weekly:(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun)){0,6}:([01][0-9]|2[0-3]):[0-5][0-9])$'

backup_calendar() {
  local p="$1"
  case "$p" in
    daily:*)  echo "*-*-* ${p#daily:}:00" ;;
    weekly:*)
      local rest="${p#weekly:}" days out="" d
      days="${rest%%:*}"
      for d in ${days//,/ }; do out="$out${out:+,}${d^}"; done
      echo "$out *-*-* ${rest#*:}:00" ;;
  esac
}

backup_units() {
  cat > "/etc/systemd/system/$BACKUP_UNIT.service" <<EOF
[Unit]
Description=Back up IT Manager (databases, files and proxy settings)
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
TimeoutStartSec=6h
ExecStart=$ROOT/install.sh run-backup scheduled
EOF
  if [ "$BACKUP_SCHEDULE" = off ]; then
    systemctl disable --now "$BACKUP_UNIT.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$BACKUP_UNIT.timer"
  else
    cat > "/etc/systemd/system/$BACKUP_UNIT.timer" <<EOF
[Unit]
Description=Scheduled IT Manager backups

[Timer]
OnCalendar=$(backup_calendar "$BACKUP_SCHEDULE")
Persistent=true

[Install]
WantedBy=timers.target
EOF
  fi
  systemctl daemon-reload
  if [ "$BACKUP_SCHEDULE" != off ]; then
    systemctl enable "$BACKUP_UNIT.timer" >/dev/null 2>&1
    systemctl restart "$BACKUP_UNIT.timer"
  fi
}

next_backup() {
  [ "$BACKUP_SCHEDULE" = off ] && return 0
  systemctl show "$BACKUP_UNIT.timer" -p NextElapseUSecRealtime --value 2>/dev/null || true
}

# Run a backup, keeping its output as the backup log for Admin → Backups.
run_backup_logged() {
  local dir log rc=0
  dir="$(control_dir)"; log="${dir:-/tmp}/backup.log"
  bash "$ROOT/scripts/backup.sh" run "${1:-manual}" > "$log.tmp" 2>&1 || rc=$?
  mv -f "$log.tmp" "$log"; chmod 0644 "$log"
  BACKUP_TASK_DONE=1 host_status
  return "$rc"
}

# A long backup task started from the Portal: run in the background as its own unit,
# so that only one runs at a time and the request is answered at once.
start_backup_task() { # start_backup_task <log name> <backup.sh arguments…>
  local name="$1"; shift
  if systemctl is-active --quiet "$BACKUP_JOB.service" || systemctl is-active --quiet "$BACKUP_UNIT.service"; then
    echo "A backup task is already running."; return 1
  fi
  systemctl reset-failed "$BACKUP_JOB.service" >/dev/null 2>&1 || true
  systemd-run --quiet --no-block --unit="$BACKUP_JOB" --collect \
    "$ROOT/install.sh" backup-task "$name" "$@" >/dev/null 2>&1 \
    || { echo "Could not start the backup task."; return 1; }
}

# Requests from Admin → Backups (variables set by host_apply). Each prints an error
# message on failure and nothing on success; they run in a subshell.
backup_save() {
  [ -n "$bsched" ] && [ -n "$bstorage" ] && [ -n "$bkeep" ] && [ -n "$bcompress" ] && [ -n "$bencrypt" ] \
    && [ -n "$bsecrets" ] && [ -n "$bverify" ] || { echo "Incomplete backup settings."; return 1; }
  case "$bstorage" in
    local) [ -n "$bpath" ] || { echo "Choose a folder for the backups."; return 1; } ;;
    smb)   [[ "$bshare" == //* ]] || { echo "Enter the share as //server/share."; return 1; } ;;
    nfs)   [[ "$bshare" =~ ^[A-Za-z0-9.-]+:/ ]] || { echo "Enter the export as server:/path."; return 1; } ;;
  esac
  local phrase="" has_pass=false
  ls "$PASS_DIR"/pass-* >/dev/null 2>&1 && has_pass=true
  if [ "$bencrypt" = set ]; then
    phrase="$(printf '%s' "$bphrase" | base64 -d 2>/dev/null)" || { echo "Invalid passphrase."; return 1; }
    [ "${#phrase}" -ge 12 ] || { echo "The passphrase must be at least 12 characters."; return 1; }
    [[ "$phrase" != *$'\n'* ]] || { echo "The passphrase cannot contain line breaks."; return 1; }
    has_pass=true
  fi
  [ "$bencrypt" = off ] && has_pass=false
  if [ "$bsecrets" = on ] && [ "$has_pass" = false ]; then
    echo "The encryption keys can be included only in encrypted backups. Set a passphrase first."; return 1
  fi

  # Keep the current settings, to roll back if the new storage does not work.
  cp -p "$CONF" "$CONF.prev"
  if [ -f "$SMB_CRED" ]; then cp -p "$SMB_CRED" "$SMB_CRED.prev"; else rm -f "$SMB_CRED.prev"; fi
  rollback() {
    mv -f "$CONF.prev" "$CONF"
    if [ -f "$SMB_CRED.prev" ]; then mv -f "$SMB_CRED.prev" "$SMB_CRED"; else rm -f "$SMB_CRED"; fi
  }

  BACKUP_SCHEDULE="$bsched"; BACKUP_STORAGE="$bstorage"; BACKUP_KEEP="$bkeep"; BACKUP_COMPRESS="$bcompress"
  BACKUP_SECRETS="$bsecrets"; BACKUP_VERIFY="$bverify"
  [ "$bstorage" = local ] && BACKUP_PATH="$bpath"
  if [ "$bstorage" != local ]; then BACKUP_SHARE="$bshare"; fi
  if [ "$bstorage" = smb ]; then
    local password=""
    if [ -n "$bpass" ]; then
      password="$(printf '%s' "$bpass" | base64 -d 2>/dev/null)" || { rollback; echo "Invalid share password."; return 1; }
      [[ "$password" != *$'\n'* ]] || { rollback; echo "The password cannot contain line breaks."; return 1; }
    elif [ -s "$SMB_CRED" ] && [ "$buser" = "$BACKUP_USER" ]; then
      password="$(sed -n 's/^password=//p' "$SMB_CRED")"
    else
      rollback; echo "Enter the share password."; return 1
    fi
    BACKUP_USER="$buser"; BACKUP_DOMAIN="$bdomain"
    umask 077
    { echo "username=${buser:-guest}"; echo "password=$password"; [ -n "$bdomain" ] && echo "domain=$bdomain"; true; } > "$SMB_CRED"
    chmod 0600 "$SMB_CRED"; umask 022
  fi
  save_conf

  local out
  if ! out="$(bash "$ROOT/scripts/backup.sh" test 2>&1)"; then
    rollback; printf '%s\n' "$out" | grep -v '^Installing' | tail -n 1; return 1
  fi
  # A test (backup-test=1) checks the storage only and keeps the saved settings.
  if [ -n "$btest" ]; then rollback; return 0; fi
  rm -f "$CONF.prev" "$SMB_CRED.prev"
  [ "$bstorage" = smb ] || rm -f "$SMB_CRED"

  mkdir -p "$PASS_DIR"; chmod 0700 "$PASS_DIR"
  if [ "$bencrypt" = set ]; then
    umask 077; printf '%s' "$phrase" > "$PASS_DIR/pass-$(date +%Y%m%d%H%M%S)"; umask 022
  elif [ "$bencrypt" = off ]; then
    # Earlier passphrases stay available for restoring the backups made with them.
    local f; for f in "$PASS_DIR"/pass-*; do [ -e "$f" ] && mv -f "$f" "$PASS_DIR/old-$(basename "$f")"; done
  fi
  backup_units >/dev/null 2>&1
  bash "$ROOT/scripts/backup.sh" list >/dev/null 2>&1 || true
}

backup_task_request() {
  local out
  case "$btask" in
    now)     start_backup_task backup run manual ;;
    refresh) bash "$ROOT/scripts/backup.sh" list >/dev/null 2>&1 || echo "Could not read the backup storage." ;;
    *)
      [ -n "$bname" ] || { echo "Choose a backup."; return 1; }
      case "$btask" in
        verify)    start_backup_task verify verify "$bname" ;;
        restore)   start_backup_task restore restore "$bname" --yes ;;
        delete)    out="$(bash "$ROOT/scripts/backup.sh" delete "$bname" 2>&1)" || { printf '%s\n' "$out" | tail -n 1; return 1; } ;;
        protect)   out="$(bash "$ROOT/scripts/backup.sh" protect "$bname" on 2>&1)" || { printf '%s\n' "$out" | tail -n 1; return 1; } ;;
        unprotect) out="$(bash "$ROOT/scripts/backup.sh" protect "$bname" off 2>&1)" || { printf '%s\n' "$out" | tail -n 1; return 1; } ;;
      esac ;;
  esac
}

# Nginx Proxy Manager: the running version, and the newest release (checked once a day).
proxy_running_version() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${PROJECT}-proxy-1" 2>/dev/null \
    | sed -n 's/^NPM_BUILD_VERSION=//p' | head -n 1
}
proxy_latest_version() {
  if [ ! -f "$PROXY_LATEST" ] || [ -n "$(find "$PROXY_LATEST" -mmin +1440 2>/dev/null)" ]; then
    local v
    v="$(curl -fsS --max-time 5 https://api.github.com/repos/NginxProxyManager/nginx-proxy-manager/releases/latest 2>/dev/null \
         | sed -n 's/.*"tag_name": *"v\{0,1\}\([0-9][0-9.]*\)".*/\1/p' | head -n 1 || true)"
    if [ -n "$v" ]; then echo "$v" > "$PROXY_LATEST"; else touch "$PROXY_LATEST"; fi
  fi
  cat "$PROXY_LATEST" 2>/dev/null || true
}

proxy_version() { # proxy_version <major>
  [[ "${1:-}" =~ ^[0-9]{1,2}$ ]] || die "Usage: sudo ./install.sh proxy-version <major version, e.g. 3>"
  bold "Moving Nginx Proxy Manager to version $1.x"
  info "Its settings and certificates are kept. Back up first if you have not: sudo ./install.sh backup run"
  PROXY_TAG="$1"; save_conf; write_env
  cd "$ROOT"
  docker compose pull proxy
  docker compose up -d proxy
  host_status
  info "Running: $(proxy_running_version). To go back: sudo ./install.sh proxy-version <previous major>"
}

# -- Host helper ---------------------------------------------------------------------------

control_dir() { docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_host_control" 2>/dev/null; }

json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g' | tr -d '\000-\037')"; }

# Write a file into the control directory without following anything placed there:
# a new random file, then an atomic rename over the target.
write_control_file() { # write_control_file <dir> <name> <content>
  local tmp
  tmp="$(mktemp "$1/.tmp.XXXXXXXX")"
  printf '%s\n' "$3" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$1/$2"
}

host_status() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  local last_at="" last_result=""
  if [ -f "$LAST_UPDATE" ]; then read -r last_at last_result < "$LAST_UPDATE" || true; fi
  local b_at="" b_result="" b_size=0 b_name="" running=false
  if [ -f "$LAST_BACKUP" ]; then read -r b_at b_result b_size b_name < "$LAST_BACKUP" || true; fi
  # A task reporting its own end (BACKUP_TASK_DONE) is still an active unit at this point.
  if [ -z "${BACKUP_TASK_DONE:-}" ] && { systemctl is-active --quiet "$BACKUP_JOB.service" 2>/dev/null        || systemctl is-active --quiet "$BACKUP_UNIT.service" 2>/dev/null; }; then running=true; fi
  local pass=false smb=false
  ls "$PASS_DIR"/pass-* >/dev/null 2>&1 && pass=true
  [ -s "$SMB_CRED" ] && smb=true
  write_control_file "$dir" status.json "$(cat <<EOF
{
  "agent": true,
  "state": $(json_str "$STATE"),
  "host": { "ip": $(json_str "${HOST_IP:-}"), "lanCidr": $(json_str "${LAN_CIDR:-}"), "prefix": $(json_str "${NET_PREFIX:-}") },
  "portalNames": $(json_str "${PORTAL_HOSTNAMES:-}"),
  "ports": { "portal": $PORTAL_PORT, "proxyHttps": $PROXY_HTTPS_PORT, "proxyAdmin": $PROXY_ADMIN_PORT, "fieldLan": $FIELD_LAN_PORT },
  "firewall": $(json_str "${FIREWALL:-unknown}"),
  "acme": $(json_str "${ACME:-dns}"),
  "updates": $(json_str "${UPDATE_PRESET:-off}"),
  "nextUpdate": $(json_str "$( [ "${UPDATE_PRESET:-off}" = off ] && echo "" || next_update )"),
  "lastUpdateAt": $(json_str "$last_at"),
  "lastUpdateResult": $(json_str "$last_result"),
  "backup": {
    "schedule": $(json_str "$BACKUP_SCHEDULE"),
    "next": $(json_str "$(next_backup)"),
    "storage": $(json_str "$BACKUP_STORAGE"),
    "path": $(json_str "$BACKUP_PATH"),
    "share": $(json_str "$BACKUP_SHARE"),
    "user": $(json_str "$BACKUP_USER"),
    "domain": $(json_str "$BACKUP_DOMAIN"),
    "passwordSet": $smb,
    "keep": $(json_str "$BACKUP_KEEP"),
    "compress": $(json_str "$BACKUP_COMPRESS"),
    "encrypted": $pass,
    "secrets": $(json_str "$BACKUP_SECRETS"),
    "verify": $(json_str "$BACKUP_VERIFY"),
    "running": $running,
    "lastAt": $(json_str "$b_at"),
    "lastResult": $(json_str "$b_result"),
    "lastSize": ${b_size:-0},
    "lastName": $(json_str "$b_name")
  },
  "proxy": { "tag": $(json_str "$PROXY_TAG"), "version": $(json_str "$(proxy_running_version)"), "latest": $(json_str "$(proxy_latest_version)") },
  "updatedAt": $(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
}
EOF
)"
}

# Choose a free internal subnet prefix.
suggest_prefix() {
  local p
  for p in ${NET_PREFIX:-} 172.29 172.30 172.31 172.28 10.29 10.129; do
    if bash "$ROOT/scripts/check-net-prefix.sh" "$p" >/dev/null 2>&1; then echo "$p"; return; fi
  done
  echo 172.29
}

# host-apply: process one request (run by the path unit as root).
host_apply() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || exit 0
  local req="$dir/request"
  [ -e "$req" ] || [ -L "$req" ] || exit 0

  # Copy the request (never following a link) into a private file, then check the
  # copy: the requester can change the original at any moment.
  local copy; copy="$(mktemp)"
  rm -f "$copy"
  cp -P "$req" "$copy" 2>/dev/null || true
  rm -f "$req"
  if [ -L "$copy" ] || [ ! -f "$copy" ] || [ "$(stat -c %s "$copy")" -gt 4096 ]; then
    rm -f "$copy"; exit 0
  fi

  local id="" updates="" update="" check="" install="" network="" lan="" names="" prefix="" firewall="" acme="" error="" content
  local bsave="" btask="" bname="" bsched="" bstorage="" bpath="" bshare="" buser="" bdomain="" bpass="" bkeep="" bcompress=""
  local bencrypt="" bphrase="" bsecrets="" bverify="" btest=""
  content="$(cat "$copy")"
  rm -f "$copy"
  local cidr='(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}/([0-9]|[12][0-9]|3[0-2])'
  local host='[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*'
  local pfx='(10\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])|172\.(1[6-9]|2[0-9]|3[01])|192\.168)'
  local b64='^[A-Za-z0-9+/]+={0,2}$'
  local bk='^itm-[0-9]{4}_[0-9]{2}_[0-9]{2}-[0-9]{2}_[0-9]{2}_[0-9]{2}\.tar(\.zst|\.gz)?(\.gpg)?$'
  local line key value
  while IFS= read -r line; do
    key="${line%%=*}"; value=""; [ "$key" != "$line" ] && value="${line#*=}"
    case "$key" in
      backup-settings) [ "$value" = save ] && bsave=1 || error="Invalid backup request." ;;
      backup-task)     [[ "$value" =~ ^(now|verify|delete|protect|unprotect|restore|refresh)$ ]] && btask="$value" || error="Invalid backup task." ;;
      backup-name)     [[ "$value" =~ $bk ]] && bname="$value" || error="Invalid backup name." ;;
      backup-schedule) [[ "$value" =~ $BACKUP_RE ]] && bsched="$value" || error="Invalid backup schedule." ;;
      backup-storage)  [[ "$value" =~ ^(local|smb|nfs)$ ]] && bstorage="$value" || error="Invalid backup storage." ;;
      backup-path)     [[ "$value" =~ ^/[A-Za-z0-9._/-]{1,200}$ && "$value" != *..* ]] \
                         && ! [[ "$value" =~ ^/(proc|sys|dev|etc|usr|bin|sbin|lib|lib64|boot|run)(/|$) ]] \
                         && bpath="${value%/}" || error="Choose a folder such as /var/backups/it-manager or a mounted disk (/mnt/backup)." ;;
      backup-share)    [[ "$value" =~ ^//[A-Za-z0-9.-]+(/[A-Za-z0-9._\$\ -]+)+$ || "$value" =~ ^[A-Za-z0-9.-]+:/[A-Za-z0-9._/-]*$ || -z "$value" ]] \
                         && bshare="$value" || error="Invalid share address." ;;
      backup-user)     [[ "$value" =~ ^[A-Za-z0-9._@-]{0,64}$ ]] && buser="$value" || error="Invalid share user name." ;;
      backup-domain)   [[ "$value" =~ ^[A-Za-z0-9.-]{0,64}$ ]] && bdomain="$value" || error="Invalid share domain." ;;
      backup-pass)     [[ -z "$value" || ( "$value" =~ $b64 && ${#value} -le 700 ) ]] && bpass="$value" || error="Invalid share password." ;;
      backup-keep)     [[ "$value" =~ ^[0-9]{1,3}(,[0-9]{1,3}){4}$ ]] && bkeep="$value" || error="Invalid retention." ;;
      backup-compress) [[ "$value" =~ ^(zstd|gzip|none)$ ]] && bcompress="$value" || error="Invalid compression." ;;
      backup-encrypt)  [[ "$value" =~ ^(keep|set|off)$ ]] && bencrypt="$value" || error="Invalid encryption setting." ;;
      backup-passphrase) [[ "$value" =~ $b64 && ${#value} -le 700 ]] && bphrase="$value" || error="Invalid passphrase." ;;
      backup-secrets)  [[ "$value" =~ ^(on|off)$ ]] && bsecrets="$value" || error="Invalid setting." ;;
      backup-before-update) ;;   # always on; accepted for older Portal versions
      backup-test)     [ "$value" = 1 ] && btest=1 || error="Invalid backup request." ;;
      backup-verify)   [[ "$value" =~ ^(on|off)$ ]] && bverify="$value" || error="Invalid setting." ;;
      id)           [[ "$value" =~ ^[A-Za-z0-9-]{1,64}$ ]] && id="$value" ;;
      updates)      [[ "$value" =~ $PRESET_RE ]] && updates="$value" || error="Invalid update schedule." ;;
      update)       [ "$value" = now ] && update=now || error="Invalid update request." ;;
      check-prefix) [[ "$value" =~ ^$pfx$ ]] && check="$value" || error="Use a private range: 10.x, 172.16 to 172.31, or 192.168." ;;
      install)      [ "$value" = start ] && install=start || error="Invalid install request." ;;
      network)      [ "$value" = apply ] && network=apply || error="Invalid network request." ;;
      lan)          [[ "$value" =~ ^$cidr(,$cidr){0,7}$ ]] && lan="$value" || error="Invalid office network." ;;
      names)        [[ -z "$value" || "$value" =~ ^$host(,$host){0,9}$ ]] && names="$value" || error="Invalid Portal names." ;;
      prefix)       [[ "$value" =~ ^$pfx$ ]] && prefix="$value" || error="Invalid subnet prefix." ;;
      firewall)     [[ "$value" =~ ^(on|off)$ ]] && firewall="$value" || error="Invalid firewall setting." ;;
      acme)         [[ "$value" =~ ^(dns|http)$ ]] && acme="$value" || error="Invalid certificate validation." ;;
      '') ;;
      *) error="Unknown setting in request." ;;
    esac
  done <<<"$content"

  local extra=""
  if [ -z "$error" ] && { [ -n "$check" ] || [ -n "$install" ]; } && [ "$STATE" != configure ] && [ "$STATE" != failed ]; then
    error="The server is already installed."
  fi
  if [ -z "$error" ] && [ -n "$network" ]; then
    if [ "$STATE" != installed ]; then error="The server is not installed yet."
    elif [ -z "$lan" ]; then error="Enter at least one office network."
    elif [ -n "$install" ] || [ -n "$check" ]; then error="Invalid request."
    fi
  fi
  if [ -z "$error" ] && [ -n "$check" ]; then
    local out rc=0 items="" line
    out="$(bash "$ROOT/scripts/check-net-prefix.sh" "$check" 2>&1)" || rc=$?
    if [ "$rc" = 2 ]; then error="$out"; fi
    if [ "$rc" = 1 ]; then
      while IFS= read -r line; do [ -n "$line" ] && items="$items${items:+, }$(json_str "$line")"; done <<<"$out"
    fi
    extra=", \"overlaps\": [${items}]"
  fi
  if [ -z "$error" ] && [ -n "$install" ]; then
    [ -n "$lan" ] && [ -n "$prefix" ] && [ -n "$firewall" ] && [ -n "$acme" ] && [ -n "$updates" ] || error="Incomplete settings."
  fi
  if [ -z "$error" ] && [ -n "$updates" ] && [ -z "$install" ]; then
    UPDATE_PRESET="$updates"
    if [ "$updates" = off ]; then auto_update_off >/dev/null; else auto_update_on >/dev/null; fi
    save_conf
  fi
  if [ -z "$error" ] && [ "$update" = now ]; then
    systemctl start --no-block "$UPDATE_UNIT.service" 2>/dev/null || error="Could not start the update."
  fi
  if [ -z "$error" ] && { [ -n "$bsave" ] || [ -n "$btask" ]; } && [ "$STATE" != installed ]; then
    error="The server is not installed yet."
  fi
  if [ -z "$error" ] && [ -n "$bsave" ]; then
    error="$(backup_save)" || true
    . "$CONF"
  fi
  if [ -z "$error" ] && [ -n "$btask" ]; then
    error="$(backup_task_request)" || true
  fi

  local ok=true; [ -n "$error" ] && ok=false
  write_control_file "$dir" result.json "{ \"id\": $(json_str "$id"), \"ok\": $ok, \"error\": $(json_str "$error")$extra }"

  if [ "$ok" = true ] && [ -n "$network" ]; then
    LAN_CIDR="$lan"
    PORTAL_HOSTNAMES="$HOST_IP${names:+,$names}"
    apply_network "$dir"
  elif [ "$ok" = true ] && [ -n "$install" ]; then
    LAN_CIDR="$lan"; NET_PREFIX="$prefix"; FIREWALL="$firewall"; ACME="$acme"; UPDATE_PRESET="$updates"
    PORTAL_HOSTNAMES="$HOST_IP${names:+,$names}"
    install_stack "$dir"
  else
    host_status
  fi
}

# Office network or Portal names changed from the Portal: save, re-apply the firewall,
# re-issue the certificates (init), and recreate the two web containers, which read the
# office network at start-up. Runs after the result is written, so the Portal answers
# before it restarts.
apply_network() {
  local log="$1/network.log"
  : > "$log"; chmod 0644 "$log"
  save_conf
  cd "$ROOT"
  write_env
  {
    echo "Office network: $LAN_CIDR"
    echo "Portal names: $PORTAL_HOSTNAMES"
    if [ "${FIREWALL:-off}" = on ]; then firewall_apply && echo "Firewall rules updated."; fi
    docker compose run --rm --no-deps init
    echo "The certificate authority is unchanged: devices that trust it need nothing new."
    docker compose --progress plain up -d --no-deps --force-recreate portal-web field-web
  } >> "$log" 2>&1 || echo "==> FAILED" >> "$log"
  host_status
}

# Stage 3: install the stack with the wizard's settings, logging for the browser.
install_stack() {
  local dir="$1" log="$1/install.log" total=5
  STATE=installing; save_conf; host_status
  : > "$log"; chmod 0644 "$log"
  step() { echo "==> STEP $1/$total: $2" >> "$log"; }
  fail() { echo "==> FAILED: $1" >> "$log"; STATE=failed; save_conf; host_status; exit 0; }
  cd "$ROOT"

  step 1 "Saving the settings"
  write_env
  { echo "Office network: $LAN_CIDR"; echo "Portal names: $PORTAL_HOSTNAMES"; echo "Container networks: $NET_PREFIX.0.0/24 - $NET_PREFIX.9.0/24"; } >> "$log"

  step 2 "Configuring the firewall"
  if [ "$FIREWALL" = on ]; then firewall_on >> "$log" 2>&1 || fail "Configuring the firewall"; else firewall_off >> "$log" 2>&1; fi

  step 3 "Scheduling automatic updates and backups"
  if [ "$UPDATE_PRESET" = off ]; then auto_update_off >> "$log" 2>&1; else auto_update_on >> "$log" 2>&1; fi
  backup_units >> "$log" 2>&1
  echo "Backups: $BACKUP_SCHEDULE to $BACKUP_PATH on this server (choose a network share in Admin → Backups)." >> "$log"
  save_conf

  step 4 "Downloading the application"
  docker compose --progress plain pull >> "$log" 2>&1 || fail "Downloading the application"

  step 5 "Starting the services"
  local services
  services="$(docker compose config --services | grep -vx 'portal-web' | tr '\n' ' ')"
  # shellcheck disable=SC2086
  docker compose --progress plain up -d $services >> "$log" 2>&1 || fail "Starting the services"
  local i
  for i in $(seq 1 90); do
    if docker compose ps --format '{{.Service}} {{.Health}}' | grep -E '^(portal-api|field-api) ' | grep -vq ' healthy$'; then sleep 2; else break; fi
  done
  echo "Handing over to the Portal; this page reconnects in a moment." >> "$log"
  docker compose --profile installer rm -sf installer >> "$log" 2>&1 || true
  docker compose --progress plain up -d portal-web >> "$log" 2>&1 || fail "Starting the Portal"
  for i in $(seq 1 60); do
    [ "$(docker compose ps --format '{{.Health}}' portal-web)" = healthy ] && break
    sleep 2
  done
  docker compose ps >> "$log" 2>&1 || true
  echo "==> DONE" >> "$log"
  STATE=installed; save_conf; host_status
}

install_host_helper() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] || die "The host_control volume does not exist."
  write_update_service
  cat > "/etc/systemd/system/$HOST_UNIT.service" <<EOF
[Unit]
Description=Apply IT Manager settings requested from the setup wizard or the Portal

[Service]
Type=oneshot
TimeoutStartSec=1h
ExecStart=$ROOT/install.sh host-apply
EOF
  cat > "/etc/systemd/system/$HOST_UNIT.path" <<EOF
[Unit]
Description=Watch for IT Manager settings requests

[Path]
PathExists=$dir/request
Unit=$HOST_UNIT.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$HOST_UNIT.path" >/dev/null 2>&1
  systemctl restart "$HOST_UNIT.path"
}

# -- Subcommands ------------------------------------------------------------------------

case "${1:-install}" in
  firewall)
    [ -f "$CONF" ] || die "Run sudo ./install.sh first."
    case "${2:-status}" in
      on) firewall_on; save_conf; host_status ;;
      off) firewall_off; save_conf; host_status ;;
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
  firewall-apply) [ -f "$CONF" ] && firewall_apply; exit 0 ;;
  host-apply)     [ -f "$CONF" ] || exit 0; host_apply; exit 0 ;;
  host-status)    [ -f "$CONF" ] || exit 0; host_status; exit 0 ;;
  run-update)     [ -f "$CONF" ] || exit 0; run_update; exit $? ;;
  run-backup)     [ -f "$CONF" ] || exit 0; rc=0; run_backup_logged "${2:-scheduled}" || rc=$?; exit $rc ;;
  backup-task)    # backup-task <log name> <backup.sh arguments…> (started by start_backup_task)
    [ -f "$CONF" ] || exit 0
    name="$2"; shift 2
    dir="$(control_dir)"; log="${dir:-/tmp}/$name.log"; rc=0
    bash "$ROOT/scripts/backup.sh" "$@" > "$log.tmp" 2>&1 || rc=$?
    mv -f "$log.tmp" "$log"; chmod 0644 "$log"
    BACKUP_TASK_DONE=1 host_status; exit $rc ;;
  backup)
    [ "$STATE" = installed ] || die "IT Manager is not installed yet."
    shift; rc=0; bash "$ROOT/scripts/backup.sh" "$@" || rc=$?
    host_status; exit $rc ;;
  proxy-version)
    [ "$STATE" = installed ] || die "IT Manager is not installed yet."
    proxy_version "${2:-}"; exit 0 ;;
  install) ;;
  *) die "Usage: sudo ./install.sh [firewall on|off|status | auto-update on|off|status | backup … | proxy-version N]" ;;
esac

# -- Stage 1 ------------------------------------------------------------------------------

command -v apt-get >/dev/null || die "This installer supports Debian and Ubuntu. See README.md for other systems."

bold "1/4  Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
info "$(docker --version)"

bold "2/4  This server"
EXT_IF="$(ip route show default | awk '{print $5; exit}')"
HOST_IP="$(ip -4 -o addr show dev "$EXT_IF" | awk '{print $4}' | cut -d/ -f1 | head -n1)"
HOST_CIDR="$(ip -4 -o route show dev "$EXT_IF" proto kernel scope link | awk '{print $1}' | head -n1)"
info "Network interface $EXT_IF, address $HOST_IP, office network $HOST_CIDR"

if [ "$STATE" = installed ]; then
  # Repair an existing installation (also run after `git pull` when docker-compose.yml
  # changed): re-apply the settings, pull the current images and start everything.
  # The internal range may have grown since the installation (new networks), so check it
  # again; the stack's own networks are ignored.
  rc=0; out="$(bash "$ROOT/scripts/check-net-prefix.sh" "$NET_PREFIX" 2>&1)" || rc=$?
  if [ "$rc" = 1 ]; then
    warn "These networks overlap the app's internal range $NET_PREFIX.0.0 - $NET_PREFIX.9.255:"
    printf '%s\n' "$out" | sed 's/^/    /'
    die "Remove or move the overlapping network, then run sudo ./install.sh again. Nothing was changed."
  fi
  bold "3/4  Settings"
  save_conf
  write_env
  if [ "${FIREWALL:-on}" = on ]; then firewall_on; else info "Firewall hardening is off."; fi
  if [ "${UPDATE_PRESET:-off}" = off ]; then auto_update_off; else auto_update_on; fi
  backup_units
  info "Backups: $BACKUP_SCHEDULE (Admin → Backups)."
  bold "4/4  Start"
  docker compose pull
  docker compose up -d --remove-orphans
  install_host_helper
  host_status
  echo
  bold "IT Manager is running: https://$HOST_IP"
  exit 0
fi

# New installation (or one whose setup was not finished).
LAN_CIDR="${LAN_CIDR:-$HOST_CIDR}"
NET_PREFIX="$(suggest_prefix)"
PORTAL_HOSTNAMES="${PORTAL_HOSTNAMES:-$HOST_IP}"
FIREWALL=on
ACME="${ACME:-dns}"
UPDATE_PRESET="${UPDATE_PRESET:-$DEFAULT_PRESET}"
STATE=configure
info "Internal container networks: $NET_PREFIX.0.0/24 - $NET_PREFIX.9.0/24 (changeable in the setup wizard)"
write_env
save_conf

bold "3/4  Preparing"
docker compose --profile installer pull init installer
docker compose run --rm --no-deps init
firewall_on
install_host_helper
host_status

bold "4/4  Starting the setup wizard"
docker compose --profile installer up -d installer
for _ in $(seq 1 30); do
  curl -fsk -o /dev/null "https://127.0.0.1:$PORTAL_PORT/" && break
  sleep 1
done

CODE="$(cat "$(control_dir)/setup_code" 2>/dev/null || true)"
echo
bold "Open https://$HOST_IP in a browser to continue."
[ -n "$CODE" ] && bold "SETUP CODE: $CODE"
info "The browser warns about the certificate the first time; continue to the site."
