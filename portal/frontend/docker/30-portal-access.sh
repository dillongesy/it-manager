#!/bin/sh
# Writes the Portal's source-address rules before nginx starts (see nginx.conf).
#   PORTAL_DENIED_SOURCES   space-separated CIDRs refused unconditionally (the networks of
#                           the Field App's entrances)
#   PORTAL_ALLOWED_SOURCES  space-separated CIDRs allowed; default: private and loopback
set -eu

allowed="${PORTAL_ALLOWED_SOURCES:-10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8 fc00::/7 ::1}"
cidr='^[0-9a-fA-F:.]+(/[0-9]{1,3})?$'

mkdir -p /tmp/nginx
{
  for range in ${PORTAL_DENIED_SOURCES:-}; do
    printf '%s' "$range" | grep -Eq "$cidr" || { echo "Invalid PORTAL_DENIED_SOURCES entry: $range" >&2; exit 1; }
    echo "deny ${range};"
  done
  for range in $allowed; do
    printf '%s' "$range" | grep -Eq "$cidr" || { echo "Invalid PORTAL_ALLOWED_SOURCES entry: $range" >&2; exit 1; }
    echo "allow ${range};"
  done
  echo "deny all;"
} > /tmp/nginx/portal-access.conf
