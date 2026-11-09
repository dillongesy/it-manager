# Backlog

Planned work, roughly in priority order. Move an item to "Done" with the date when it
ships.

## Next

- [ ] **First real Docker run.** The stack has never been built or started under Docker,
  only checked with unit tests, frontend builds, and the APIs run against a local
  Postgres. On a fresh Debian/Ubuntu box: `sudo ./install.sh`, then fix whatever comes
  up. Most likely spots: the Postgres container capabilities and secret-file permissions,
  Caddy site addresses with `tls internal`, and the DOCKER-USER rules in
  `/etc/ufw/after.rules`. Also check in a browser that the lazy-loaded Portal pages
  load, and that a tab left open across `./update.sh` reloads itself once.

## Later

- [ ] **Field App on its own host.** Stage 2 of
  [FIELD-PUBLIC-HOSTING.md](FIELD-PUBLIC-HOSTING.md): mTLS bridge, `install.sh --role`,
  and pairing from Admin → System.
- [ ] **Public-exposure hardening for Field.** Stage 3 of the same doc: TOTP,
  fail2ban, and a scheduled purge of imported captures.

## Done

- 2026-11-05: Initial Docker stack, setup wizard, one-time secrets, Admin area,
  white-label branding.
- 2026-11-05: Removed `recover-secrets.sh`, so root file access is the only backdoor.
  Renamed `import-acs.sh` → `import-existing.sh`.
- 2026-11-08: **Removed leftover ACS references and real data.** Comments, migration
  headers, package names, the ConnectWise User-Agent, and autofill keys are now generic.
  Test fixtures no longer carry real staff names, customer names, Auvik tenant and device
  IDs, LAN addresses, or MAC-derived hostnames. The replacement names keep the same
  initials, so the DG/RM fixtures still line up. `grep -rnwi acs` outside node_modules
  now matches only this file and CLAUDE.md.
- 2026-11-08: **Internal subnet choice.** `install.sh` asks for `NET_PREFIX` and runs
  `scripts/check-net-prefix.sh`, which refuses non-private prefixes and lists overlaps
  with host routes (all tables) and other Docker networks. The stack's own networks
  don't count. Changing the prefix on a re-run recreates the networks; volumes are kept.
- 2026-11-08: **Integration token caches.** `makeBearer` and `onIntegrationChange` in
  `lib/integration-util.js`. Saving an integration drops its OAuth token and its cached
  lists, and a sign-in or load already in flight with the old credentials is discarded.
  `makeCache` also has that guard.
- 2026-11-08: **Code-split the Portal bundle.** Every page except Login is lazy, and
  pdf.js loads on demand. The entry chunk went from 1.8 MB to 253 kB (80 kB gzipped).
  `lib/lazyPage.js` reloads once if a chunk is missing after an update.
