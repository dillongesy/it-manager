# IT Manager

A white-label IT service management portal (customers, credentials vault, devices,
work orders, billing, tasks) plus a mobile **Field App** for on-site job capture and
shared inventory. The whole stack runs in Docker on one Linux host, configures itself
on first start, and is set up in the browser.

```bash
docker compose up -d                          # start (or: sudo ./install.sh on a fresh server)
docker compose pull && docker compose up -d   # update
```

---

## Contents
1. [Install](#1-install)
2. [First-run setup](#2-first-run-setup)
3. [Publishing the Field App](#3-publishing-the-field-app)
4. [Updating](#4-updating)
5. [Admin area](#5-admin-area)
6. [Security model](#6-security-model)
7. [Backups and disaster recovery](#7-backups-and-disaster-recovery)
8. [Importing existing data](#8-importing-existing-data)
9. [Publishing images (CI)](#9-publishing-images-ci)
10. [Local development](#10-local-development)
11. [Repository layout](#11-repository-layout)

---

## 1. Install

**Requirements:** a Linux server (amd64 or arm64) with 2 vCPU, 4 GB RAM, 20 GB disk and
a static LAN IP address.

### Recommended: the installer (Debian and Ubuntu)

```bash
sudo apt-get install -y git
git clone https://github.com/dillongesy/it-manager.git /opt/it-manager
cd /opt/it-manager
sudo ./install.sh
```

The installer:

1. Installs Docker Engine and the compose plugin.
2. Asks which LAN may use the Portal, the names and IPs staff use to reach it (for the
   HTTPS certificate), and the internal subnet prefix (default `172.29`; prefixes that
   overlap a route on the host or another Docker network are refused unless you
   confirm). It writes `.env`, which holds no secrets.
3. **Hardens the host firewall** (on by default). See [Security model](#6-security-model).
   The setup wizard lets you keep it or turn it off, once.
4. **Schedules automatic updates** (Sundays at 02:00 by default; change the schedule in the
   setup wizard or Admin → System).
5. Installs a small **host helper** that applies those two choices from the Portal, starts
   the stack, and prints the Portal address and the **setup code**.

On the server, root can always change them:

```bash
sudo ./install.sh firewall    on|off|status
sudo ./install.sh auto-update on|off|status
sudo ./install.sh                             # re-run to change settings; data is kept
```

The Portal itself cannot run anything on the host. It writes a small request file that the
host helper (a root systemd service) checks against a fixed list of allowed settings:
the update schedule, "update now", and the firewall choice, which is accepted only once,
during setup.

### Any Docker host

Copy `docker-compose.yml` (and optionally `.env.example` as `.env`) to a folder and run
`docker compose up -d`. Every setting has a working default. Without the installer, the
host firewall is not configured; the Portal still refuses non-LAN clients itself, and
only ports 80 and 443 should be forwarded from your router.

## 2. First-run setup

Open **`https://<server-ip>:8443`**. The browser warns about the certificate the first
time; continue to the site. The setup wizard then walks through:

1. **Start-up.** A live checklist while the Portal, its database and the Field App start.
2. **Verify.** Enter the setup code from the Portal API's log: in Portainer under
   Containers → `itmanager-portal-api-1` → Logs, or with `docker compose logs portal-api`.
   The installer prints it too. This proves you manage the server, so nobody else on the
   network can complete setup first.
3. **Company, first admin and server.** The same login is created on the Field App. On
   installations set up with `install.sh`, choose whether to keep the firewall hardening
   (this choice is made once) and the automatic update schedule. The progress of each step
   is shown.
4. **Recovery secrets.** On first start the `init` container generated the master
   encryption key (it protects every stored password), both database passwords and the
   signing secrets. You can reveal them **exactly once**:
   - You re-enter your password and see them once, with download and copy buttons.
   - The server then **shreds** its copy. The reveal endpoint returns `410 Gone` forever,
     for every user, including admins.
   - No other code path can show them. The only remaining copies are the read-only
     secret files mounted into each container, which require **root on the host** to
     read. See [Recovering secrets as root](#recovering-secrets-as-root).

   Skip it now and it stays available, once, under **Admin → Security**.
5. **Finish.** Download the server's certificate authority and the steps to publish the
   Field App.

Store the secrets offline. You need `ENCRYPTION_KEY` to restore a backup onto a new
server.

**Removing the certificate warning.** The Portal's certificate comes from a certificate
authority created on this server. Download it from `https://<server>:8443/ca.crt` (or run
`./scripts/export-ca.sh`) and install it as a trusted root on each computer and phone, by
hand, Group Policy or MDM.

## 3. Publishing the Field App

The Field App is published through the bundled **Nginx Proxy Manager**, which is
attached only to the Field App's network and cannot reach the Portal.

1. Point a DNS name (for example `field.example.com`) at your public IP address.
2. On the router, forward TCP **80 and 443** to the server. Never forward 8443 (Portal)
   or 81 (proxy admin).
3. Open `http://<server-ip>:81` and create the Nginx Proxy Manager admin account.
4. **Hosts → Proxy Hosts → Add Proxy Host**: the domain, scheme `http`, forward hostname
   `field-web`, port `8080`, and turn on **Block Common Exploits**.
5. On the **SSL** tab: request a Let's Encrypt certificate and turn on **Force SSL** and
   **HTTP/2 Support**.

The Field App requires HTTPS, because its sign-in cookies are marked secure. It keeps
its own copy of the branding, pushed by the Portal, and never contacts the Portal.

## 4. Updating

```bash
cd /opt/it-manager
docker compose pull && docker compose up -d
```

This pulls new images for every service, including Nginx Proxy Manager, and recreates
whatever changed. Database migrations run automatically when the API containers start;
if one fails, that container stops rather than serving a half-migrated database. The
installer's scheduled update runs the same commands (a systemd timer,
`it-manager-update.timer`). To pin a version, set `IMAGE_TAG=1.4.0` in `.env`.

`docker-compose.yml` itself changes rarely. When a release notes that it changed,
download the new file (or `git pull`) before updating.

## 5. Admin area

**Admin** is visible to admins only:

| Tab | What's there |
|---|---|
| **Users & roles** | Create, edit and deactivate users. Roles: Admin, Technician, Biller. You can't demote or deactivate the last active admin, or deactivate yourself. |
| **Integrations** | ConnectWise RMM, Dell TechDirect, ScreenConnect, UniFi, TD SYNNEX, Auvik, Outlook and ThreatLocker. Each has an on/off switch and its settings. Secrets are encrypted with the master key and never sent back to the browser. Changes apply immediately, with no restart. Integrations that are off are hidden from everyone. |
| **Billing** | The default hourly rates (initially Standard $90 and Tech $70) that every new customer starts with. Each customer's rates can still be changed on its Overview tab. Saving can also update existing customers who are still on the old price; negotiated prices are left alone. The first rate is the default for new work orders. |
| **Branding** | Company name, app name, Field App name, primary and accent colors (live preview, contrast warning), print/PDF header (address, phone, email, website, footer), plus image uploads: square logo, full logo, browser-tab icon, login background. Changes push to the Field App automatically. |
| **Security** | The one-time recovery-secrets reveal and its status, and the **two-factor authentication** policy, set separately for the Portal and the Field App (see below). |
| **System** | Version, Field App connection, **automatic updates** (schedule, next and last run, "Update now"), the host firewall status (read-only), storage (see below), and "Create my Field App login" if the wizard couldn't. |

**Two-factor authentication.** Users sign in with a password plus a 6-digit code from an
authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password and
similar). Each app has its own policy: **Off** (not used), **Optional** (users turn it on
from their account: the shield button in the Portal's sidebar, or Profile in the Field App),
or **Required** (everyone sets it up at their next sign-in). Setup shows a QR code and gives
ten single-use recovery codes. Admins can reset a user who lost their phone (Users & roles
in the Portal, Staff in the Field App). Codes are accepted once, secrets are encrypted at
rest, and a sign-in step locks after five wrong codes.

**Storage monitoring.** Admin → System shows disk capacity, the size of each database
and of the uploaded files, the growth rate over the last 30 days, and the estimated date
the disk fills up. Usage is recorded every 6 hours. Admins see a banner on every page
when the disk is 80% full or expected to fill within 60 days, and a critical banner at
90% or 14 days.

## 6. Security model

Full detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

```
LAN ──────▶ :8443  portal-web ─ portal_app ─▶ portal-api ─ portal_db ─▶ portal-db
                                                │  └─ portal_egress ─▶ internet (integrations)
                                                └─ bridge ─▶ field-api (/api/service/* only)
internet ─▶ :80/:443  proxy (Nginx Proxy Manager; admin UI :81, LAN only)
                   └─ field_edge ─▶ field-web ─ field_app ─▶ field-api ─ field_db ─▶ field-db
```

- **Two separate entrances.** The internet-facing proxy is attached only to the Field
  App's network. It shares no network with any Portal container, so it cannot reach
  the Portal even if it is misconfigured or compromised.
- **The Portal is LAN only, three times over.** portal-web accepts only private
  addresses and always refuses the proxy's network (which also covers a proxy host
  pointed at the server's own port 8443); the Portal API repeats that check; and the
  host firewall blocks the proxy's network from the Portal and admits only the LAN to 8443.
- **The Field database is reachable only by the Field API.**
- **The bridge is one-way.** portal-api listens only on its `portal_app` address, so
  field-api can't open a connection back to it. field-api answers callers from the
  bridge network only on `/api/service/*`, with a service token, and only if the source
  address is on the bridge subnet. field-web refuses `/api/service` outright.
- **Least privilege per container.** Every container drops all Linux capabilities and
  adds back only what it needs, sets `no-new-privileges`, and the app containers run
  read-only, as non-root users.
- **Secrets.** `init` writes each service only its own secrets, into its own volume,
  mounted read-only. No secret appears in compose, `.env`, environment variables or
  `docker inspect`.
- **Host firewall** (installer, on by default). `ufw` denies inbound to the host, with
  SSH from the LAN only. Docker-published ports bypass `ufw`, so the installer also
  writes **DOCKER-USER** rules (kept in `/etc/ufw/after.rules`): 80 and 443 from
  anywhere, 8443 and 81 from the LAN only, and everything else dropped.

## 7. Backups and disaster recovery

```bash
./scripts/backup.sh                 # both databases + uploads  → backups/<timestamp>/
sudo ./scripts/backup.sh --secrets  # also the secret, certificate and proxy volumes
```

To restore onto a new server: install, then use `scripts/import-existing.sh` with your
dumps, upload archives and the **ENCRYPTION_KEY** (from the one-time reveal, a
`--secrets` backup, or the root access described below). Without the encryption key,
stored credentials can't be recovered. That's by design.

### Recovering secrets as root

The secrets are plain files in Docker volumes, readable only by root:

```bash
sudo ls /var/lib/docker/volumes/itmanager_secrets_portal_api/_data/
sudo cat /var/lib/docker/volumes/itmanager_secrets_portal_api/_data/encryption_key
```

The volumes are `itmanager_secrets_portal_api`, `itmanager_secrets_field_api`,
`itmanager_secrets_portal_db` and `itmanager_secrets_field_db`. Protect root and SSH
access on the host accordingly.

## 8. Importing existing data

[`scripts/import-existing.sh`](scripts/import-existing.sh) loads an existing
installation into this stack. That can be this stack's own backup, or an older
installation of the application. Its header lists the exact `pg_dump` / `tar`
commands to run on the old servers. Then:

```bash
sudo ./scripts/import-existing.sh --portal-dump portal.dump --field-dump field.dump \
  --encryption-key <old ENCRYPTION_KEY> \
  --portal-uploads portal-uploads.tgz --field-uploads field-uploads.tgz \
  --portal-env old-portal.env        # optional: copies integration credentials
```

Existing users and logins keep working, the migrations bring the schema up to date, and
the setup wizard is skipped.

## 9. Publishing images (CI)

[`.github/workflows/images.yml`](.github/workflows/images.yml) runs the unit tests, then
builds the five images (`init`, `portal-api`, `portal-web`, `field-api`, `field-web`) for
**amd64 and arm64**, and pushes them to `ghcr.io/<owner>/<repo>/<image>`:

- On every push to `main` → `:latest`
- On every push → `:sha-<short>`
- On tags like `v1.2.3` → `:1.2.3` and `:1.2`

To use your own registry, set `IMAGE_REGISTRY=ghcr.io/<owner>/<repo>` (lowercase) in
`.env`. To build locally instead of pulling:
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`

## 10. Local development

Without Docker: run Postgres, then in each of `portal/backend`, `field/backend`:
`node scripts/gen-env.js && npm install && npm run migrate && npm run dev`, and in each
frontend: `npm install && npm run dev` (Portal on :5173, Field on :5174). With no
`REVEAL_DIR` set, the setup wizard doesn't ask for a setup code.

Tests: `npm test` in `portal/backend`, and `npm run test:unit` in `field/backend`.

## 11. Repository layout

```
docker-compose.yml          the stack (pulls images)
docker-compose.build.yml    override: build images from source
install.sh                  installer: Docker, settings, firewall, scheduled updates
.env.example                optional settings
deploy/init/                secrets and Portal certificate generator (runs on every start)
portal/{backend,frontend}   Portal API + web (each with its own Dockerfile)
field/{backend,frontend}    Field API + web
scripts/                    backup, import, setup code, CA export, subnet check
docs/                       architecture and security, Field hosting, roadmap
```
