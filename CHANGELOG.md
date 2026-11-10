# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Admin → Billing: configurable default hourly rates for new customers, with an option
  to move existing customers who are still on the old price.
- Admin → System → Storage: disk capacity, database and file sizes, growth rate and a
  forecast of when the disk fills up, plus an admin banner when space runs low.
  Usage is recorded every 6 hours in `storage_snapshots` (migration 066).
- Field API: `GET /api/service/storage` for the Portal's storage report.

### Changed
- Printed work orders and customer exports use the primary brand color instead of a
  fixed red.
- A new work order's default rate is the customer's rate named like the first default
  rate, falling back to the customer's first rate, rather than a rate labelled "Standard".
- Source comments describe current behavior only.

### Fixed
- LAN mode: browsing to `https://<server-ip>` failed with `ERR_SSL_PROTOCOL_ERROR`,
  because browsers send no SNI for IP addresses. Caddy now uses `DEFAULT_SNI`.
- Re-running `install.sh` crashed ufw on a non-ASCII character in `after.rules`.
- The arm64 web image build could hang under QEMU emulation. The frontend build stage
  now runs on the build host's native platform, and build jobs time out after 45 minutes.

## [1.0.0]

### Added
- Docker Compose stack: edge (Caddy), Portal web/API/database, Field web/API/database,
  and a secret-generating `init` service, published to GHCR for amd64 and arm64.
- `install.sh` (Docker install, settings, internal subnet check, firewall, start) and
  `update.sh`.
- Setup wizard gated by a one-time setup code, and a one-time reveal of the recovery
  secrets.
- Admin area: users and roles, integrations (encrypted, applied without a restart),
  branding (pushed to the Field App), security, and system status.
- Lazy-loaded Portal pages and on-demand PDF rendering.
- Integration credential changes discard cached OAuth tokens and data immediately.
