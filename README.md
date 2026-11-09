# IT Manager

A white-label IT service management portal (customers, credentials vault, devices,
work orders, billing, tasks) plus a mobile **Field App** for on-site job capture and
shared inventory. The whole stack runs on one Linux host in Docker. It configures
itself on first boot, and you update it with a single command.

```
sudo ./install.sh     # once, on a fresh server
./update.sh           # every update after that (= git pull + docker compose pull + up -d)
```

---

## Contents
1. [Install](#1-install)
2. [First-run setup and the one-time secrets](#2-first-run-setup)
3. [Updating](#3-updating)
4. [Admin area](#4-admin-area)
5. [Security model](#5-security-model)
6. [Backups and disaster recovery](#6-backups--disaster-recovery)
7. [Importing existing data](#7-importing-existing-data)
8. [Publishing images (CI)](#8-publishing-images-ci)
9. [Local development](#9-local-development)
10. [Repository layout](#10-repository-layout)

---

## 1. Install

**Requirements:** a Debian or Ubuntu server (amd64 or arm64), 2 vCPU, 4 GB RAM, 20 GB
disk, and a static LAN IP.

```bash
sudo apt-get install -y git
git clone <this repo> /opt/it-manager
cd /opt/it-manager
sudo ./install.sh
```

The installer:

1. Installs Docker Engine and the compose plugin.
2. Asks whether you want **LAN mode** (default: self-signed HTTPS on the server's IP,
   Portal on `https://<ip>`, Field App on `https://<ip>:8443`) or **domain mode** (real
   hostnames, automatic Let's Encrypt certificates). It then writes `.env`. That file holds
   **no secrets**, only addresses and the image registry.
   It also asks for the **internal subnet prefix** (default `172.29`). The containers
   use `<prefix>.0.0`–`<prefix>.8.255`, and the installer refuses any prefix that overlaps
   a route on the host (LAN, VPN) or another Docker network, unless you confirm. Check
   one by hand with `scripts/check-net-prefix.sh 172.29`.
3. Logs in to GHCR if the images are private. Use a GitHub token with only the
   `read:packages` scope.
4. Locks down the firewall (see [§5](#5-security-model)).
5. Pulls the images, starts everything, and prints the **setup code**.

LAN mode serves a certificate from the server's own private CA. Run `./scripts/export-ca.sh`
and install `server-root-ca.crt` as a trusted root on each PC or phone (by hand, GPO
or MDM), and the browser warning goes away for good.

## 2. First-run setup

Open the Portal. A brand-new install sends you to the **setup wizard**:

1. **Setup code.** The installer printed it. Lost it? Run `./scripts/show-setup-code.sh`.
   The code proves you have shell access to the server, so nobody else on the network can
   claim the install first.
2. **Company and first admin.** The same login is created on the Field App.
3. **Recovery secrets.** On first boot the `init` container generated the master
   encryption key (it protects every stored password), both database passwords, and the
   signing secrets. You can reveal them **exactly once**:
   - You must re-enter your password, and you see them on screen once, with download
     and copy buttons.
   - The moment they're sent, the server **shreds** its copy of the bundle. The reveal
     endpoint then returns `410 Gone` forever, for every user, including admins.
   - The app has no other code path that can show them. The only remaining copies are
     the read-only secret files mounted into each container. Reading those requires
     **root on the host**. No script or tool is provided on purpose: root access is
     the only backdoor. See [Recovering secrets as root](#recovering-secrets-as-root).

   Skip it now and it stays available, once, under **Admin → Security**.

Store the secrets offline. You need `ENCRYPTION_KEY` to restore a backup onto a new
server.

## 3. Updating

```bash
./update.sh
```

This pulls the latest compose file and scripts (`git pull`), pulls the newest images,
and recreates whatever changed. Database migrations run automatically when the API
containers start. If a migration fails, that container stops rather than serving a
half-migrated database. To pin a version, set `IMAGE_TAG=1.4.0` in `.env`.

## 4. Admin area

**Admin** is visible to admins only:

| Tab | What's there |
|---|---|
| **Users & roles** | Create, edit and deactivate users. Roles: Admin, Technician, Biller. You can't demote or deactivate the last active admin, or deactivate yourself. |
| **Integrations** | ConnectWise RMM, Dell TechDirect, ScreenConnect, UniFi, TD SYNNEX, Auvik, Outlook and ThreatLocker. Each has an on/off switch and its settings. Secrets are encrypted with the master key and never sent back to the browser. Changes apply immediately, with no restart. Integrations that are off are hidden from everyone. |
| **Billing** | The default hourly rates (initially Standard $90 and Tech $70) that every new customer starts with. Each customer's rates can still be changed on its Overview tab. Saving can also update existing customers who are still on the old price; negotiated prices are left alone. The first rate is the default for new work orders. |
| **Branding** | Company name, app name, Field App name, primary and accent colors (live preview, contrast warning), print/PDF header (address, phone, email, website, footer), plus image uploads: square logo, full logo, browser-tab icon, login background. Changes push to the Field App automatically. |
| **Security** | The one-time recovery-secrets reveal, and its status (who revealed them and when). |
| **System** | Version, Field App bridge health, storage (see below), and "Create my Field App login" if the wizard couldn't. |

**Storage monitoring.** Admin → System shows disk capacity, the size of each database and of the uploaded files, the growth rate over the last 30 days, and the estimated date the disk fills up. Usage is recorded every 6 hours. Admins see a banner on every page when the disk is 80% full or expected to fill within 60 days, and a critical banner at 90% or 14 days.

## 5. Security model

Full detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

```
internet/LAN ─▶ edge (Caddy :80/:443/:8443)          the ONLY container with published ports
                 ├─ portal_edge ─▶ portal-web ─ portal_app ─▶ portal-api ─ portal_db ─▶ portal-db
                 │                                             │  └─ portal_egress ─▶ internet (integrations only)
                 │                                             └─ bridge ─▶ field-api   (/api/service/* only)
                 └─ field_edge  ─▶ field-web  ─ field_app  ─▶ field-api  ─ field_db  ─▶ field-db
```

- **Network segmentation.** Nine Docker networks. Every one except `public` (edge)
  and `portal_egress` is `internal`, so it has no route on or off the host.
- **The Field database is reachable only by the Field API.** Nothing on the Portal side
  (portal-web, portal-api, portal-db) shares a network with it.
- **The bridge is one-way.** portal-api listens only on its `portal_app` address, so
  field-api can't open a connection back to it. field-api answers callers from the
  bridge network only on `/api/service/*`, with a service token, and only if the source
  address is on the bridge subnet. The edge and field-web both refuse `/api/service`
  from outside.
- **Least privilege per container.** Every container drops all Linux capabilities (the
  Postgres and edge containers add back only the few they need), sets
  `no-new-privileges`, and the app containers run read-only, as non-root users.
- **Secrets.** `init` writes each service only its own secrets, into its own volume,
  mounted read-only. No secret appears in compose, `.env`, environment variables or
  `docker inspect`.
- **Host firewall.** `ufw` denies inbound to the host, and SSH is allowed from the LAN
  only. Docker-published ports bypass `ufw`, so `scripts/firewall.sh` also writes
  **DOCKER-USER** rules (kept in `/etc/ufw/after.rules`) that admit only the LAN to the
  Portal, and the LAN (or, if you choose, the internet) to the Field App. Caddy enforces
  LAN-only for the Portal a second time (`PORTAL_ALLOWED_RANGES`).

## 6. Backups and disaster recovery

```bash
./scripts/backup.sh               # both databases + uploads  → backups/<timestamp>/
sudo ./scripts/backup.sh --secrets  # …plus the secret volumes (guard it like the keys)
```

To restore onto a new server: install, then use `scripts/import-existing.sh` with your
dumps, upload archives and the **ENCRYPTION_KEY** (from the one-time reveal, a
`--secrets` backup, or the root backdoor below). Without the encryption key, stored
credentials can't be recovered. That's by design.

### Recovering secrets as root

The secrets are plain files in Docker volumes, readable only by root:

```bash
sudo ls /var/lib/docker/volumes/itmanager_secrets_portal_api/_data/
sudo cat /var/lib/docker/volumes/itmanager_secrets_portal_api/_data/encryption_key
```

The volumes are `itmanager_secrets_portal_api`, `itmanager_secrets_field_api`,
`itmanager_secrets_portal_db` and `itmanager_secrets_field_db`. Protect root and SSH
access on the host accordingly.

## 7. Importing existing data

[`scripts/import-existing.sh`](scripts/import-existing.sh) loads an existing
installation into this stack. That can be this stack's own backup, or a legacy
(non-Docker) install of the app. Its header lists the exact `pg_dump` / `tar`
commands to run on the old servers. Then:

```bash
sudo ./scripts/import-existing.sh --portal-dump portal.dump --field-dump field.dump \
  --encryption-key <old ENCRYPTION_KEY> \
  --portal-uploads portal-uploads.tgz --field-uploads field-uploads.tgz \
  --portal-env old-portal.env        # optional: copies integration credentials
```

Existing users and logins keep working, the migrations bring the schema up to date, and
the setup wizard is skipped.

## 8. Publishing images (CI)

[`.github/workflows/images.yml`](.github/workflows/images.yml) runs the unit tests, then
builds all six images (`init`, `edge`, `portal-api`, `portal-web`, `field-api`,
`field-web`) for **amd64 and arm64**, and pushes them to
`ghcr.io/<owner>/<repo>/<image>`:

- On every push to `main` → `:latest`
- On every push → `:sha-<short>`
- On tags like `v1.2.3` → `:1.2.3` and `:1.2`

Set `IMAGE_REGISTRY=ghcr.io/<owner>/<repo>` (lowercase) in `.env`. install.sh suggests it
from the git remote.

To build locally instead of pulling:
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`

## 9. Local development

Without Docker: run Postgres, then in each of `portal/backend`, `field/backend`:
`node scripts/gen-env.js && npm install && npm run migrate && npm run dev`, and in each
frontend: `npm install && npm run dev` (Portal on :5173, Field on :5174). With no
`REVEAL_DIR` set, the setup wizard doesn't ask for a setup code.

Tests: `npm test` in `portal/backend`, and `npm run test:unit` in `field/backend`.

## 10. Repository layout

```
docker-compose.yml          the stack (pulls images)
docker-compose.build.yml    override: build images from source
install.sh / update.sh      first install / update
.env.example                non-secret settings (install.sh writes .env)
deploy/init/                secret generator (runs before every start)
deploy/edge/                Caddy reverse proxy + Caddyfile
portal/{backend,frontend}   Portal API + web (each with its own Dockerfile)
field/{backend,frontend}    Field API + web
scripts/                    firewall, setup code, CA export, backup, import-existing
docs/                       architecture and security, Field public-hosting plan, roadmap
```
