#!/usr/bin/env bash
# Update everything: newest compose file / scripts from git, newest images, restart.
# Database migrations run automatically when the API containers start.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if [ -d .git ]; then
  git pull --ff-only
fi
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
docker compose ps
