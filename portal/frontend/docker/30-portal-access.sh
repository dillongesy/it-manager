#!/bin/sh
# Writes the Portal's source-address rules before nginx starts (see nginx.conf).
#   PROXY_SUBNET            refused unconditionally (the reverse proxy's network)
#   PORTAL_ALLOWED_SOURCES  space-separated CIDRs allowed; default: private and loopback
set -eu

allowed="${PORTAL_ALLOWED_SOURCES:-10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8 fc00::/7 ::1}"
cidr='^[0-9a-fA-F:.]+(/[0-9]{1,3})?$'

mkdir -p /tmp/nginx
{
  if [ -n "${PROXY_SUBNET:-}" ]; then
    printf '%s' "$PROXY_SUBNET" | grep -Eq "$cidr" || { echo "Invalid PROXY_SUBNET: $PROXY_SUBNET" >&2; exit 1; }
    echo "deny ${PROXY_SUBNET};"
  fi
  for range in $allowed; do
    printf '%s' "$range" | grep -Eq "$cidr" || { echo "Invalid PORTAL_ALLOWED_SOURCES entry: $range" >&2; exit 1; }
    echo "allow ${range};"
  done
  echo "deny all;"
} > /tmp/nginx/portal-access.conf
