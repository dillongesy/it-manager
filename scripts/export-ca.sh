#!/usr/bin/env bash
# Copy the root certificate of the Portal's local certificate authority to
# ./it-manager-ca.crt. Install it once as a trusted root on each computer and phone
# (by hand, Group Policy or MDM) to remove the browser warning. The same file can be
# downloaded from https://<server>/ca.crt.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
docker compose exec -T portal-web cat /etc/nginx/tls/ca.crt > ./it-manager-ca.crt
chmod 644 ./it-manager-ca.crt
echo "Wrote $(pwd)/it-manager-ca.crt"
openssl x509 -in ./it-manager-ca.crt -noout -subject -fingerprint -sha256 2>/dev/null || true
