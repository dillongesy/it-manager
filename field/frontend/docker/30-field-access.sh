#!/bin/sh
# Writes the source-address rules for field-web's two listeners before nginx starts
# (see nginx.conf):
#   OFFICE_SOURCES  the office-network HTTPS port: space-separated CIDRs allowed;
#                   default: private and loopback
#   PROXY_SOURCES   the plain-HTTP proxy port, when an external reverse proxy is used:
#                   its addresses only (plus this container, for the health check).
#                   Empty: the bundled proxy, which reaches it over an internal network.
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

{
  if [ -n "${PROXY_SOURCES:-}" ]; then
    echo "allow 127.0.0.1;"
    for range in $PROXY_SOURCES; do
      printf '%s' "$range" | grep -Eq "$cidr" || { echo "Invalid PROXY_SOURCES entry: $range" >&2; exit 1; }
      echo "allow ${range};"
    done
    echo "deny all;"
  fi
} > /tmp/nginx/proxy-access.conf
