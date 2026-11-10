# IT Manager

A white-label IT service management portal (customers, credentials vault, devices,
work orders, billing, tasks) plus a mobile **Field App** for on-site job capture and
shared inventory. The whole stack runs in Docker on one Linux host and is set up in the
browser.

```bash
sudo ./install.sh                              # once, on a new server; then open https://<server>
docker compose pull && docker compose up -d    # update (also scheduled automatically)
```

---

## Contents
1. [Install](#1-install)
2. [Setup wizard](#2-setup-wizard)
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

**Requirements:** a Debian or Ubuntu server (amd64 or arm64) with 2 vCPU, 4 GB RAM,
20 GB disk and a static IP address on the office network.

```bash
sudo apt-get install -y git
git clone https://github.com/dillongesy/it-manager.git /opt/it-manager
cd /opt/it-manager
sudo ./install.sh
```

The script asks nothing. It installs Docker, generates the secrets and the Portal's
certificate, installs the host helper (see [Security model](#6-security-model)), starts
the setup wizard, and prints:

```
Open https://192.168.1.10 in a browser to continue.
SETUP CODE: 4F2A-91C0-7BDE
```

Everything else happens in the browser. Running `sudo ./install.sh` again on an installed
server repairs it: it re-applies the settings and starts everything, keeping all data.

## 2. Setup wizard

Open `https://<server-ip>`. The browser warns about the certificate the first time;
continue to the site (see [Trusting the certificate](#trusting-the-certificate)).

1. **Verify.** Enter the setup code. It proves you manage the server, so nobody else on
   the network can set it up first. Lost it? `docker compose logs installer`.
2. **Network.**
   - *Office network allowed to use the Portal*: the address range of your office
     computers (for example `192.168.1.0/24`), detected for you. Add a VPN range if
     staff connect remotely. Everything outside these ranges is refused.
   - *Local DNS names for the Portal* (optional): only if your office DNS has a name for
     the server, so the certificate matches it. The IP address always works.
   - *Internal network for the containers*: nine small private networks inside the
     server. The wizard suggests a free prefix and checks it live against the server's
     networks.
3. **Security and updates.** Firewall hardening (recommended: on), how the Field App's
   certificate is validated (DNS: only port 443 open; or HTTP: ports 443 and 80), and the
   automatic update schedule.
4. **Review**, then **Install**. The page shows each stage and the live log: downloading
   the images, starting the containers.
5. The page then continues with the Portal's own setup at the same address: company,
   first admin (also created on the Field App), and the one-time **recovery secrets**:
   - You re-enter your password and see them once, with download and copy buttons.
   - The server then **shreds** its copy. The reveal endpoint returns `410 Gone` forever,
     for every user, including admins.
   - No other code path can show them. The only remaining copies are the read-only
     secret files mounted into each container, which require **root on the host** to
     read. See [Recovering secrets as root](#recovering-secrets-as-root).

   Store the secrets offline. You need `ENCRYPTION_KEY` to restore a backup onto a new
   server.

The installation log stays available in Admin → System.

### Trusting the certificate

The Portal's certificate comes from a certificate authority created on the server. Admin
→ Certificate (and `/certificate`, open to every signed-in user) has step-by-step
instructions for Windows (by hand, PowerShell, Group Policy, Intune), iPhone, Android and
macOS. The certificate is at `https://<server>/ca.crt`, or run `./scripts/export-ca.sh`.

## 3. Publishing the Field App

The Field App is published through the bundled **Nginx Proxy Manager**, which is
attached only to the Field App's network and cannot reach the Portal. On the server it
listens on port **4443**; the router maps the public port 443 to it, so the Portal keeps
port 443 on the office network.

1. Point a DNS name (for example `field.example.com`) at your public IP address.
2. On the router, forward external TCP **443 to the server's port 4443**. With HTTP
   certificate validation, also forward external **80 to the server's port 80**.
   Forward nothing else.
3. Open `http://<server-ip>:81` and create the Nginx Proxy Manager admin account.
4. **Hosts → Proxy Hosts → Add Proxy Host**: the domain, scheme `http`, forward hostname
   `field-web`, port `8080`, and turn on **Block Common Exploits**.
5. On the **SSL** tab: request a Let's Encrypt certificate. With DNS validation, turn on
   **Use a DNS Challenge**, choose your DNS provider and paste its API token. Turn on
   **Force SSL** and **HTTP/2 Support**.

The Field App requires HTTPS, because its sign-in cookies are marked secure. It keeps
its own copy of the branding and security settings, pushed by the Portal, and never
contacts the Portal. Inside the office, phones reach the Field App's public name through
the router (NAT loopback). If your router doesn't support that, use mobile data, or add
a local DNS entry pointing the Field App's name at the server and open it on port 4443.

## 4. Updating

```bash
cd /opt/it-manager
docker compose pull && docker compose up -d
```

This pulls new images for every service, including Nginx Proxy Manager, and recreates
whatever changed. Database migrations run automatically when the API containers start;
if one fails, that container stops rather than serving a half-migrated database. The
scheduled update (Admin → System, or `sudo ./install.sh auto-update on|off`) runs the
same commands, and its output is kept in Admin → System. To pin a version, set
`IMAGE_TAG=1.4.0` in `.env`.

`docker-compose.yml` itself changes rarely. When a release notes that it changed,
`git pull` before updating.

## 5. Admin area

**Admin** is visible to admins only:

| Tab | What's there |
|---|---|
| **Users & roles** | Create, edit and deactivate users. Roles: Admin, Technician, Biller. You can't demote or deactivate the last active admin, or deactivate yourself. |
| **Integrations** | ConnectWise RMM, Dell TechDirect, ScreenConnect, UniFi, TD SYNNEX, Auvik, Outlook and ThreatLocker. Each has an on/off switch and its settings. Secrets are encrypted with the master key and never sent back to the browser. Changes apply immediately, with no restart. Integrations that are off are hidden from everyone. |
| **Billing** | The default hourly rates (initially Standard $90 and Tech $70) that every new customer starts with. Each customer's rates can still be changed on its Overview tab. Saving can also update existing customers who are still on the old price; negotiated prices are left alone. The first rate is the default for new work orders. |
| **Branding** | Company name, app name, Field App name, primary and accent colors (live preview, contrast warning), print/PDF header (address, phone, email, website, footer), plus image uploads: square logo, full logo, browser-tab icon, login background. Changes push to the Field App automatically. |
| **Security** | The one-time recovery-secrets reveal and its status, and the **two-factor authentication** policy, set separately for the Portal and the Field App (see below). |
| **System** | Version, Field App connection, **automatic updates** (schedule, next and last run, "Update now", the last update's log), the firewall status (read-only), the installation log, storage (see below), and "Create my Field App login" if the wizard couldn't. |
| **Certificate** | How to trust the server's certificate on Windows (by hand, PowerShell, Group Policy, Intune), iPhone, Android and macOS. Also at `/certificate` for every signed-in user. |

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
office LAN ─▶ :443   portal-web ─ portal_app ─▶ portal-api ─ portal_db ─▶ portal-db
                                                  │  └─ portal_egress ─▶ internet (integrations)
                                                  └─ bridge ─▶ field-api (/api/service/* only)
internet ─▶ router :443 ─▶ :4443  proxy (Nginx Proxy Manager; admin :81, office only)
                 └─ field_edge ─▶ field-web ─ field_app ─▶ field-api ─ field_db ─▶ field-db
```

- **Two separate entrances.** Internet traffic arrives only at the proxy (through the
  router's 443 → 4443 mapping). The proxy shares no network with any Portal container, so
  it cannot reach the Portal even if it is misconfigured or compromised.
- **The Portal accepts the office network only, three times over.** portal-web allows
  only the ranges chosen in the wizard and always refuses the proxy's network; the Portal
  API repeats the proxy check; and the firewall admits only the office network to port 443.
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
- **Firewall** (on by default, chosen in the wizard; `sudo ./install.sh firewall on|off`).
  Docker-published ports bypass the host's own firewall, so the rules live in Docker's
  **DOCKER-USER** chain, re-applied by a systemd unit whenever Docker starts: port 4443
  from anywhere (and 80 with HTTP validation), 443 and 81 from the office network only,
  everything else dropped. Other services on the host, such as SSH, are not changed.
- **Host helper.** The setup wizard and the Portal can't run anything on the host. They
  drop a small request file that a root systemd service checks against a fixed list:
  the update schedule, "update now", and, during setup only, the subnet check and the
  installation itself.

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
builds the six images (`init`, `installer`, `portal-api`, `portal-web`, `field-api`, `field-web`) for
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
install.sh                  stage 1 of installation; firewall, updates, host helper
.env.example                optional settings
deploy/init/                secrets and Portal certificate generator (runs on every start)
deploy/installer/           setup wizard served before installation
portal/{backend,frontend}   Portal API + web (each with its own Dockerfile)
field/{backend,frontend}    Field API + web
scripts/                    backup, import, setup code, CA export, subnet check
docs/                       architecture and security, Field hosting, roadmap
```
