#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# IT Manager backups. Run as root, normally through install.sh (the schedule, the
# backup before each update, and Admin → Backups), but usable by hand:
#
#   sudo ./scripts/backup.sh run [reason]          back up now to the configured storage
#   sudo ./scripts/backup.sh list                  list the backups (writes backups.json)
#   sudo ./scripts/backup.sh verify <name>         check a backup's checksums and dumps
#   sudo ./scripts/backup.sh protect <name> on|off protected backups are never pruned
#   sudo ./scripts/backup.sh delete <name>
#   sudo ./scripts/backup.sh prune                 apply the retention settings
#   sudo ./scripts/backup.sh test                  check that the storage is writable
#   sudo ./scripts/backup.sh restore <name | /path/to/file>
#        [--encryption-key HEX] [--field-encryption-key HEX] [--passphrase-file FILE] [--yes]
#
# A backup is one file, itm-YYYY_MM_DD-HH_MM_SS.tar[.zst|.gz][.gpg], holding:
#   portal.dump, field.dump        pg_dump custom-format dumps of both databases
#   <volume>.tar                   portal_uploads, field_uploads, proxy_data,
#                                  proxy_letsencrypt (Nginx Proxy Manager's settings
#                                  and certificates)
#   keys.env                       the Portal and Field encryption keys; only in
#                                  encrypted backups, and only if enabled
#   manifest.json, SHA256SUMS
#
# Storage (settings in /etc/it-manager/install.conf, chosen in Admin → Backups):
#   local  a folder on this server, or on a disk mounted on it
#   smb    a Windows or NAS share (//server/share), mounted only while in use
#   nfs    an NFS export (server:/path), mounted only while in use
# Backups go into <storage>/it-manager/<hostname>/.
#
# Retention works like Proxmox VE's: keep-last, then keep-daily / weekly / monthly /
# yearly each keep the newest backup of that many periods not already covered. All
# zero keeps everything. Protected backups are always kept.
#
# Encryption: GnuPG symmetric AES-256 with the passphrase stored on this server (root
# only). Earlier passphrases are kept so older backups stay readable. Without the
# passphrase an encrypted backup cannot be restored anywhere else: keep a copy of it
# with the recovery secrets.
# ------------------------------------------------------------------------------
set -Eeuo pipefail
umask 077
# Never fail silently: name the step that stopped the script in the log.
# (Deliberate refusals, `return 1` / `exit 1` after a message, are not reported again.)
trap '[[ "$BASH_COMMAND" == return* || "$BASH_COMMAND" == exit* ]] || echo "Error: \"$BASH_COMMAND\" failed (line $LINENO)." >&2' ERR

cd "$(dirname "$(readlink -f "$0")")/.."
ROOT="$(pwd)"
PROJECT=itmanager
CONF_DIR=/etc/it-manager
CONF="$CONF_DIR/install.conf"
SMB_CRED="$CONF_DIR/backup-smb.cred"
PASS_DIR="$CONF_DIR/backup-passphrases"
LAST_BACKUP="$CONF_DIR/last-backup"
MNT=/mnt/it-manager-backup
LOCK=/run/it-manager-backup.lock
VOLUMES="portal_uploads field_uploads proxy_data proxy_letsencrypt"
NAME_RE='^itm-[0-9]{4}_[0-9]{2}_[0-9]{2}-[0-9]{2}_[0-9]{2}_[0-9]{2}\.tar(\.zst|\.gz)?(\.gpg)?$'

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -f "$CONF" ] && . "$CONF"
BACKUP_STORAGE="${BACKUP_STORAGE:-local}"
BACKUP_PATH="${BACKUP_PATH:-/var/backups/it-manager}"
BACKUP_SHARE="${BACKUP_SHARE:-}"
BACKUP_KEEP="${BACKUP_KEEP:-3,7,4,6,0}"
BACKUP_COMPRESS="${BACKUP_COMPRESS:-zstd}"
BACKUP_SECRETS="${BACKUP_SECRETS:-off}"
BACKUP_VERIFY="${BACKUP_VERIFY:-on}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g' | tr -d '\000-\037')"; }
control_dir() { docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_host_control" 2>/dev/null || true; }
vol_dir() { docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_$1" 2>/dev/null || true; }
need() { # need <command> <package>
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "Installing $2…"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$2" >/dev/null 2>&1 \
    || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$2" >/dev/null; }
}
# The newest active passphrase file, or nothing when backups are not encrypted.
current_passphrase() {
  local f latest=""
  for f in "$PASS_DIR"/pass-*; do [ -f "$f" ] && latest="$f"; done   # glob order is sorted
  printf '%s' "$latest"
}

# -- Storage ---------------------------------------------------------------------------
MOUNTED=0
storage_open() {
  case "$BACKUP_STORAGE" in
    local)
      mkdir -p "$BACKUP_PATH"
      STORE="$BACKUP_PATH" ;;
    smb)
      need mount.cifs cifs-utils
      mkdir -p "$MNT"
      mountpoint -q "$MNT" && umount "$MNT" 2>/dev/null || true
      timeout 30 mount -t cifs "$BACKUP_SHARE" "$MNT" \
        -o "credentials=$SMB_CRED,uid=0,gid=0,file_mode=0600,dir_mode=0700,nobrl" \
        || { echo "Could not connect to the share $BACKUP_SHARE." >&2; return 1; }
      MOUNTED=1; STORE="$MNT" ;;
    nfs)
      need mount.nfs nfs-common
      mkdir -p "$MNT"
      mountpoint -q "$MNT" && umount "$MNT" 2>/dev/null || true
      timeout 30 mount -t nfs -o soft,timeo=150,retrans=3 "$BACKUP_SHARE" "$MNT" \
        || { echo "Could not connect to the NFS export $BACKUP_SHARE." >&2; return 1; }
      MOUNTED=1; STORE="$MNT" ;;
    *) echo "Unknown backup storage: $BACKUP_STORAGE" >&2; return 1 ;;
  esac
  DEST="$STORE/it-manager/$(hostname -s)"
  mkdir -p "$DEST" || { echo "Cannot create $DEST on the backup storage." >&2; return 1; }
}
storage_close() {
  if [ "$MOUNTED" = 1 ]; then sync; umount "$MNT" 2>/dev/null || umount -l "$MNT" 2>/dev/null || true; MOUNTED=0; fi
}
trap 'storage_close; [ -n "${WORK:-}" ] && rm -rf "$WORK"' EXIT

storage_test() {
  storage_open
  local probe="$DEST/.write-test-$$"
  echo ok > "$probe" && [ "$(cat "$probe")" = ok ] || { echo "The backup storage is not writable." >&2; return 1; }
  rm -f "$probe"
  echo "Storage OK: $(df -h --output=avail "$DEST" | tail -n 1 | tr -d ' ') free."
}

# -- Helpers ----------------------------------------------------------------------------
name_ok() { [[ "$1" =~ $NAME_RE ]] || { echo "Not a backup name: $1" >&2; return 1; }; }
name_time() { # itm-2026_11_10-01_00_03.tar.zst → "2026-11-10 01:00:03"
  local t="${1#itm-}"; t="${t%%.*}"
  printf '%s %s' "$(tr _ - <<<"${t%%-*}")" "$(tr _ : <<<"${t#*-}")"
}

# decode <file>: write the plain tar stream to stdout.
decode() {
  local f="$1" pf
  {
    if [[ "$f" == *.gpg ]]; then
      need gpg gnupg
      local ok=0 tmp; tmp="$(mktemp)"
      for pf in ${EXTRA_PASSFILE:-} "$PASS_DIR"/pass-* "$PASS_DIR"/old-pass-*; do
        [ -f "$pf" ] || continue
        if gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$pf" -d "$f" > "$tmp" 2>/dev/null; then ok=1; break; fi
      done
      [ "$ok" = 1 ] || { rm -f "$tmp"; echo "Could not decrypt the backup: the passphrase is wrong or the file is damaged. On another server, pass --passphrase-file." >&2; return 1; }
      cat "$tmp"; rm -f "$tmp"
    else
      cat "$f"
    fi
  } | case "$f" in
    *.zst|*.zst.gpg) need zstd zstd; zstd -dc ;;
    *.gz|*.gz.gpg)   gzip -dc ;;
    *)               cat ;;
  esac
}

# unpack <file> <dir>: extract and check the checksums.
unpack() {
  decode "$1" | tar -C "$2" -xf -
  [ -f "$2/SHA256SUMS" ] || { echo "Not an IT Manager backup (no SHA256SUMS)." >&2; return 1; }
  (cd "$2" && sha256sum --quiet -c SHA256SUMS) || { echo "Checksum mismatch: the backup is damaged." >&2; return 1; }
}

write_list() {
  local dir; dir="$(control_dir)"
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  local items="" f n size created enc prot ver meta avail total
  for f in $(ls -1 "$DEST" 2>/dev/null | grep -E "$NAME_RE" | sort -r || true); do
    n="$f"; size="$(stat -c %s "$DEST/$n")"
    created="$(date -u -d "$(name_time "$n")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
    [[ "$n" == *.gpg ]] && enc=true || enc=false
    [ -e "$DEST/$n.protected" ] && prot=true || prot=false
    ver="$(cat "$DEST/$n.verified" 2>/dev/null || true)"
    meta="$(cat "$DEST/$n.meta" 2>/dev/null || true)"
    items="$items${items:+,}
    { \"name\": $(json_str "$n"), \"size\": $size, \"created\": $(json_str "$created"), \"encrypted\": $enc, \"protected\": $prot, \"verified\": $(json_str "$ver"), \"meta\": $(json_str "$meta") }"
  done
  avail="$(df -B1 --output=avail "$DEST" 2>/dev/null | tail -n 1 | tr -d ' ' || echo 0)"
  total="$(df -B1 --output=size "$DEST" 2>/dev/null | tail -n 1 | tr -d ' ' || echo 0)"
  local tmp; tmp="$(mktemp "$dir/.tmp.XXXXXXXX")"
  printf '{ "updatedAt": %s, "location": %s, "free": %s, "total": %s, "backups": [%s\n] }\n' \
    "$(json_str "$(now)")" "$(json_str "$DEST")" "${avail:-0}" "${total:-0}" "$items" > "$tmp"
  chmod 0644 "$tmp"; mv -f "$tmp" "$dir/backups.json"
}

# -- Retention (Proxmox VE's algorithm) ------------------------------------------------
prune() {
  local last daily weekly monthly yearly
  IFS=, read -r last daily weekly monthly yearly <<<"$BACKUP_KEEP"
  local -a names=()
  mapfile -t names < <(ls -1 "$DEST" 2>/dev/null | grep -E "$NAME_RE" | sort -r)
  [ "${#names[@]}" -gt 0 ] || return 0
  if [ $((last + daily + weekly + monthly + yearly)) -eq 0 ]; then echo "Retention keeps all backups."; return 0; fi

  declare -A mark=()
  local n
  for n in "${names[@]}"; do [ -e "$DEST/$n.protected" ] && mark[$n]=protected; done

  local i=0
  for n in "${names[@]}"; do
    [ -n "${mark[$n]:-}" ] && continue
    [ "$i" -lt "$last" ] && { mark[$n]=keep; i=$((i + 1)); }
  done

  local rule fmt count
  for rule in "daily:%Y-%m-%d:$daily" "weekly:%G-%V:$weekly" "monthly:%Y-%m:$monthly" "yearly:%Y:$yearly"; do
    IFS=: read -r _ fmt count <<<"$rule"
    [ "$count" -gt 0 ] || continue
    declare -A seen=() fresh=()
    for n in "${names[@]}"; do
      [ "${mark[$n]:-}" = keep ] && seen[$(date -d "$(name_time "$n")" +"$fmt")]=1
    done
    local nfresh=0 id
    for n in "${names[@]}"; do
      [ -n "${mark[$n]:-}" ] && continue
      id="$(date -d "$(name_time "$n")" +"$fmt")"
      [ -n "${seen[$id]:-}" ] && continue
      if [ -z "${fresh[$id]:-}" ]; then
        [ "$nfresh" -ge "$count" ] && break
        fresh[$id]=1; nfresh=$((nfresh + 1)); mark[$n]=keep
      fi
    done
    unset seen fresh
  done

  for n in "${names[@]}"; do
    if [ -z "${mark[$n]:-}" ]; then
      echo "Pruning $n"
      rm -f "$DEST/$n" "$DEST/$n.protected" "$DEST/$n.verified" "$DEST/$n.meta"
    fi
  done
}

# -- Verify -----------------------------------------------------------------------------
verify() {
  local n="$1" result=ok
  name_ok "$n" || return 1
  [ -f "$DEST/$n" ] || { echo "No such backup: $n" >&2; return 1; }
  WORK="$(mktemp -d /var/tmp/itm-verify.XXXXXX)"
  echo "Verifying $n…"
  if unpack "$DEST/$n" "$WORK"; then
    cd "$ROOT"
    local db
    for db in portal field; do
      if [ -f "$WORK/$db.dump" ]; then
        docker compose exec -T "$db-db" pg_restore -l < "$WORK/$db.dump" > /dev/null \
          || { echo "The $db database dump is unreadable." >&2; result=failed; }
      fi
    done
  else
    result=failed
  fi
  rm -rf "$WORK"; WORK=""
  printf '%s %s\n' "$(now)" "$result" > "$DEST/$n.verified"
  echo "Verification: $result"
  [ "$result" = ok ]
}

# -- Back up ----------------------------------------------------------------------------
run_backup() {
  local reason="${1:-manual}"
  cd "$ROOT"
  echo "==> Backup started $(now) ($reason)"
  storage_open

  local pass="" ext=""
  pass="$(current_passphrase)"
  case "$BACKUP_COMPRESS" in zstd) need zstd zstd; ext=".zst" ;; gzip) ext=".gz" ;; none) ext="" ;; esac
  [ -n "$pass" ] && need gpg gnupg

  # Space: the staging copy (on this server) and the archive (on the storage).
  local needed=0 v d size
  for v in $VOLUMES portal_db_data field_db_data; do
    d="$(vol_dir "$v")"
    # du reports an error when a file disappears mid-scan (Postgres temp files): an estimate is enough.
    if [ -n "$d" ]; then size="$(du -sb "$d" 2>/dev/null | cut -f1 || true)"; needed=$((needed + ${size:-0})); fi
  done
  local free_here free_dest
  free_here="$(df -B1 --output=avail /var/tmp | tail -n 1 | tr -d ' ')"
  free_dest="$(df -B1 --output=avail "$DEST" | tail -n 1 | tr -d ' ')"
  [ "$free_here" -gt "$needed" ] || { echo "Not enough free space on this server to stage the backup (need about $((needed / 1048576)) MB)." >&2; return 1; }
  [ "$free_dest" -gt $((needed / 2)) ] || { echo "Not enough free space on the backup storage." >&2; return 1; }

  WORK="$(mktemp -d /var/tmp/itm-backup.XXXXXX)"
  echo "Dumping the Portal database…"
  docker compose exec -T portal-db pg_dump -U portal -d portal -Fc > "$WORK/portal.dump"
  echo "Dumping the Field database…"
  docker compose exec -T field-db pg_dump -U field -d field -Fc > "$WORK/field.dump"
  for v in $VOLUMES; do
    d="$(vol_dir "$v")"
    [ -n "$d" ] && [ -d "$d" ] || continue
    echo "Archiving $v…"
    tar -C "$d" --numeric-owner -cf "$WORK/$v.tar" .
  done

  local keys=no
  if [ "$BACKUP_SECRETS" = on ] && [ -n "$pass" ]; then
    local pk fk
    pk="$(cat "$(vol_dir secrets_portal_api)/encryption_key")"
    fk="$(cat "$(vol_dir secrets_field_api)/encryption_key")"
    printf 'PORTAL_ENCRYPTION_KEY=%s\nFIELD_ENCRYPTION_KEY=%s\n' "$pk" "$fk" > "$WORK/keys.env"
    keys=yes
    echo "Including the encryption keys (the backup is encrypted)."
  fi

  local version
  version="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "${PROJECT}-portal-api-1" 2>/dev/null || true)"
  cat > "$WORK/manifest.json" <<EOF
{ "format": 1, "created": $(json_str "$(now)"), "host": $(json_str "$(hostname -s)"), "reason": $(json_str "$reason"),
  "version": $(json_str "${version:-${IMAGE_TAG:-latest}}"), "keys": $( [ "$keys" = yes ] && echo true || echo false ) }
EOF
  (cd "$WORK" && sha256sum -- * > SHA256SUMS)

  local name="itm-$(date +%Y_%m_%d-%H_%M_%S).tar$ext${pass:+.gpg}"
  echo "Writing $name…"
  tar -C "$WORK" -cf - . \
    | case "$BACKUP_COMPRESS" in zstd) zstd -q -T0 -3 ;; gzip) gzip -6 ;; *) cat ;; esac \
    | if [ -n "$pass" ]; then
        gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$pass" \
          --symmetric --cipher-algo AES256 --compress-algo none -o - ;
      else cat; fi \
    > "$DEST/.$name.partial"
  mv -f "$DEST/.$name.partial" "$DEST/$name"
  printf 'reason=%s keys=%s version=%s\n' "$reason" "$keys" "${version:-${IMAGE_TAG:-latest}}" > "$DEST/$name.meta"
  rm -rf "$WORK"; WORK=""
  local size; size="$(stat -c %s "$DEST/$name")"
  echo "Backup written: $name ($((size / 1048576)) MB)"
  LAST_NAME="$name"; LAST_SIZE="$size"

  if [ "$BACKUP_VERIFY" = on ]; then verify "$name"; fi
  prune
}

# -- Restore ----------------------------------------------------------------------------
restore() {
  local src="$1"; shift
  local key="" fkey="" yes=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --encryption-key) key="$2"; shift 2 ;;
      --field-encryption-key) fkey="$2"; shift 2 ;;
      --passphrase-file) EXTRA_PASSFILE="$2"; shift 2 ;;
      --yes) yes=1; shift ;;
      *) echo "Unknown option $1" >&2; return 2 ;;
    esac
  done
  local file
  if [[ "$src" == /* ]]; then
    file="$src"; [ -f "$file" ] || { echo "No such file: $file" >&2; return 1; }
  else
    name_ok "$src"; storage_open; file="$DEST/$src"
    [ -f "$file" ] || { echo "No such backup: $src" >&2; return 1; }
  fi
  if [ "$yes" != 1 ]; then
    echo "This REPLACES all Portal and Field data on this server with $(basename "$file")."
    read -r -p "Type RESTORE to continue: " ok
    [ "$ok" = RESTORE ] || return 1
  fi

  echo "==> Restore started $(now): $(basename "$file")"
  WORK="$(mktemp -d /var/tmp/itm-restore.XXXXXX)"
  echo "Unpacking and checking…"
  unpack "$file" "$WORK"
  if [ -f "$WORK/keys.env" ]; then
    key="${key:-$(sed -n 's/^PORTAL_ENCRYPTION_KEY=//p' "$WORK/keys.env")}"
    fkey="${fkey:-$(sed -n 's/^FIELD_ENCRYPTION_KEY=//p' "$WORK/keys.env")}"
    echo "Using the encryption keys stored in the backup."
  elif [ -z "$key" ]; then
    echo "The backup has no encryption keys; keeping this server's keys. That is right when restoring"
    echo "onto the server the backup came from. On a new server, pass --encryption-key (and"
    echo "--field-encryption-key) from the recovery secrets, or stored passwords cannot be read."
  fi

  cd "$ROOT"
  echo "Stopping the application…"
  docker compose stop proxy portal-web portal-api field-web field-api
  if [ -n "$key" ] || [ -n "$fkey" ]; then
    docker compose run --rm --no-deps -T -e SET_ENCRYPTION_KEY="$key" -e SET_FIELD_ENCRYPTION_KEY="$fkey" init set-encryption-key
  fi

  local db
  for db in portal field; do
    [ -f "$WORK/$db.dump" ] || continue
    echo "Restoring the $db database…"
    docker compose up -d "$db-db"
    until docker compose exec -T "$db-db" pg_isready -U "$db" -d "$db" >/dev/null 2>&1; do sleep 2; done
    docker compose exec -T "$db-db" psql -q -v ON_ERROR_STOP=1 -U "$db" -d "$db" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    docker compose exec -T "$db-db" pg_restore --no-owner --no-acl --role="$db" -U "$db" -d "$db" < "$WORK/$db.dump"
  done
  local v d
  for v in $VOLUMES; do
    [ -f "$WORK/$v.tar" ] || continue
    d="$(vol_dir "$v")"
    [ -n "$d" ] || { docker volume create "${PROJECT}_$v" >/dev/null; d="$(vol_dir "$v")"; }
    echo "Restoring $v…"
    find "$d" -mindepth 1 -delete
    tar -C "$d" --numeric-owner -xf "$WORK/$v.tar"
  done
  rm -rf "$WORK"; WORK=""

  # The restored data has users, so the setup wizard must not run.
  docker compose run --rm --no-deps -T init clear-setup-code || true
  echo "Starting the application…"
  docker compose up -d
  echo "==> DONE"
}

# -- Dispatch ---------------------------------------------------------------------------
cmd="${1:-}"; shift || true
case "$cmd" in
  run)
    exec 9>"$LOCK"; flock -n 9 || { echo "Another backup task is running." >&2; exit 1; }
    # A separate process, so that any failing step stops the backup (set -e does not
    # apply inside a function whose status is tested).
    rc=0; bash "$0" _run "${1:-manual}" || rc=$?
    if [ "$rc" != 0 ]; then printf '%s failed 0 -\n' "$(now)" > "$LAST_BACKUP"; echo "==> FAILED"; fi
    exit "$rc" ;;
  _run)
    LAST_NAME=""; LAST_SIZE=0
    run_backup "${1:-manual}"
    printf '%s success %s %s\n' "$(now)" "$LAST_SIZE" "$LAST_NAME" > "$LAST_BACKUP"
    write_list
    echo "==> DONE" ;;
  list)     storage_open; write_list; ls -lh "$DEST" | grep -E 'itm-' || echo "No backups yet." ;;
  verify)   exec 9>"$LOCK"; flock -n 9 || { echo "Another backup task is running." >&2; exit 1; }
            echo "==> Verify started $(now)"
            storage_open; rc=0; verify "${1:-}" || rc=$?; write_list
            [ "$rc" = 0 ] && echo "==> DONE" || echo "==> FAILED"; exit "$rc" ;;
  protect)  storage_open; name_ok "${1:-}"; [ -f "$DEST/$1" ] || { echo "No such backup." >&2; exit 1; }
            if [ "${2:-on}" = on ]; then : > "$DEST/$1.protected"; else rm -f "$DEST/$1.protected"; fi; write_list ;;
  delete)   storage_open; name_ok "${1:-}"; [ -f "$DEST/$1" ] || { echo "No such backup." >&2; exit 1; }
            [ -e "$DEST/$1.protected" ] && { echo "This backup is protected. Remove the protection first." >&2; exit 1; }
            rm -f "$DEST/$1" "$DEST/$1.verified" "$DEST/$1.meta"; write_list; echo "Deleted $1." ;;
  prune)    storage_open; prune; write_list ;;
  test)     storage_test ;;
  restore)  exec 9>"$LOCK"; flock -n 9 || { echo "Another backup task is running." >&2; exit 1; }
            [ -n "${1:-}" ] || { echo "Usage: restore <name | /path/to/file> [options]" >&2; exit 2; }
            rc=0; bash "$0" _restore "$@" || rc=$?
            if [ "$rc" != 0 ]; then
              echo "==> FAILED"
              echo "Starting the application again with whatever data it has."
              (cd "$ROOT" && docker compose up -d) || true
            fi
            exit "$rc" ;;
  _restore) restore "$@" ;;
  *) sed -n '3,14p' "$0"; exit 2 ;;
esac
