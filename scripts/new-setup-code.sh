#!/usr/bin/env bash
# Issue a fresh setup code. Only useful before the first admin exists — the
# wizard closes for good once setup is complete.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
docker compose run --rm --no-deps -T init new-setup-code
