#!/usr/bin/env bash
# LAN mode: copy the root certificate of this server's private CA (Caddy "tls
# internal") to ./server-root-ca.crt. Install it once as a trusted root on each
# PC / phone (GPO, MDM, or by hand) and the browser warning disappears for good.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
docker compose cp edge:/data/caddy/pki/authorities/local/root.crt ./server-root-ca.crt
chmod 644 ./server-root-ca.crt
echo "Wrote $(pwd)/server-root-ca.crt"
openssl x509 -in ./server-root-ca.crt -noout -subject -fingerprint -sha256 2>/dev/null || true
