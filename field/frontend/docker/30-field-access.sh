#!/bin/sh
# Writes the source-address rules for the Field App's office-network port before nginx
# starts (see nginx.conf). The internet reaches the Field App only through the reverse
# proxy, on the other listener.
#   OFFICE_SOURCES  space-separated CIDRs allowed; default: private and loopback
set -eu

allowed="${OFFICE_SOURCES:-10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8}"
cidr='^[0-9a-fA-F:.]+(/[0-9]{1,3})?$'

mkdir -p /tmp/nginx
{
  for range in $allowed; do
    printf '%s' "$range" | grep -Eq "$cidr" || { echo "Invalid OFFICE_SOURCES entry: $range" >&2; exit 1; }
    echo "allow ${range};"
  done
  echo "deny all;"
} > /tmp/nginx/office-access.conf
