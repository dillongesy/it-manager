#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Check an internal subnet prefix (NET_PREFIX) before the stack uses it.
#
#   scripts/check-net-prefix.sh 172.29
#
# The stack's nine Docker networks are <prefix>.0.0/24 … <prefix>.8.0/24. This
# looks for anything on the host that already uses part of that range: routes in
# any table (the LAN, VPNs, WireGuard / Tailscale, static routes) and other Docker
# networks. This stack's own networks (compose project "itmanager") don't count,
# so re-running install.sh with the same prefix is clean.
#
# Exit codes: 0 = free, 1 = overlaps (listed on stdout), 2 = not a valid prefix.
# Called by install.sh; safe to run by hand (read-only).
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT=itmanager
prefix="${1:-}"

# ── Validate: two octets, inside a private (RFC 1918) block ───────────────────
if ! [[ "$prefix" =~ ^([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
  echo "Expected two numbers like 172.29 (got '${prefix}')."; exit 2
fi
a=$((10#${BASH_REMATCH[1]})); b=$((10#${BASH_REMATCH[2]}))
if [ "$a" -gt 255 ] || [ "$b" -gt 255 ]; then
  echo "Each number must be 0–255 (got '${prefix}')."; exit 2
fi
if ! { [ "$a" -eq 10 ] || { [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } \
       || { [ "$a" -eq 192 ] && [ "$b" -eq 168 ]; }; }; then
  echo "Use a private range: 10.x, 172.16–172.31, or 192.168 (got '${prefix}')."; exit 2
fi

ip2int() { local IFS=.; set -- $1; echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 )); }
LO=$(ip2int "$prefix.0.0")
HI=$(ip2int "$prefix.8.255")

# overlaps <cidr> → true when it shares any address with LO..HI
overlaps() {
  local net="${1%/*}" len="${1#*/}" start size
  [ "$len" = "$1" ] && len=32
  [[ "$net" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$len" =~ ^[0-9]+$ ]] || return 1
  [ "$len" -eq 0 ] && return 1                       # a default route isn't a conflict
  size=$(( 1 << (32 - len) ))
  start=$(( $(ip2int "$net") & ~(size - 1) & 0xFFFFFFFF ))
  [ $(( start + size - 1 )) -ge "$LO" ] && [ "$start" -le "$HI" ]
}

# ── This stack's own subnets (ignored) ────────────────────────────────────────
OWN=" "
if command -v docker >/dev/null 2>&1; then
  for id in $(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null); do
    OWN+="$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$id" 2>/dev/null) "
  done
fi
is_own() { [[ "$OWN" == *" $1 "* ]]; }

found=()

# ── Host routes, every table ──────────────────────────────────────────────────
if command -v ip >/dev/null 2>&1; then
  while read -r line; do
    set -- $line
    case "${1:-}" in
      local|broadcast|anycast|multicast) continue ;;    # host addresses; their subnet route is listed anyway
      unicast|blackhole|unreachable|prohibit|throw) shift ;;
    esac
    dst="${1:-}"; [ -n "$dst" ] && [ "$dst" != default ] || continue
    is_own "$dst" && continue
    dev=$(sed -nE 's/.* dev ([^ ]+).*/\1/p' <<<"$line")
    overlaps "$dst" && found+=("$dst  (route${dev:+ on $dev})")
  done < <(ip -4 -o route show table all 2>/dev/null)
fi

# ── Other Docker networks (they reserve their subnet even with nothing attached) ─
if command -v docker >/dev/null 2>&1; then
  while read -r name proj subnets; do
    [ "$proj" = "$PROJECT" ] && continue
    for s in $subnets; do
      overlaps "$s" && found+=("$s  (Docker network '$name')")
    done
  done < <(docker network ls -q 2>/dev/null | xargs -r docker network inspect \
             -f '{{.Name}} {{or (index .Labels "com.docker.compose.project") "-"}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)
fi

[ "${#found[@]}" -eq 0 ] && exit 0
printf '%s\n' "${found[@]}" | sort -u
exit 1
