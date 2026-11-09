#!/usr/bin/env bash
# Print the one-time setup code (only exists until the setup wizard is completed).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
docker compose run --rm --no-deps -T init show-setup-code
