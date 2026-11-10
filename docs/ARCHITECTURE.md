# Architecture and security

## Services

| Service | Image | Runs as | Networks | Purpose |
|---|---|---|---|---|
| `init` | `init` | root, then exits | none | Generates secrets and the Portal certificate on first start; re-asserts permissions and renews the certificate on every start |
| `installer` | `installer` (Node) | node (1000), read-only | default bridge | Setup wizard on the Portal's port, before installation only; stopped by the host helper |
| `portal-web` | `portal-web` (nginx) | nginx (101), read-only | portal_ingress, portal_app | Portal HTTPS on host port 443 (office network only), serves the SPA, proxies `/api` |
| `portal-api` | `portal-api` (Node) | node (1000), read-only | portal_app (fixed .3.10), portal_db, bridge, portal_egress | Portal API; runs migrations on start |
| `portal-db` | `postgres:17-alpine` | postgres (70) | portal_db | Portal database |
| `proxy` | `jc21/nginx-proxy-manager` | root, 7 capabilities | proxy_public, field_edge | Internet entrance for the Field App: TLS (Let's Encrypt) on host port 4443 (the router maps public 443 to it), 80 for HTTP validation; admin UI on 81 |
| `field-web` | `field-web` (nginx) | nginx (101), read-only | field_edge, field_app | Serves the Field SPA and proxies `/api` (refuses `/api/service`) |
| `field-api` | `field-api` (Node) | node (1000), read-only | field_app, field_db, bridge | Field API |
| `field-db` | `postgres:17-alpine` | postgres (70) | field_db | Field database |

## Networks

Nine networks on `${NET_PREFIX}.0.0/24` … `${NET_PREFIX}.8.0/24` (default prefix `172.29`):

| Network | Subnet | Internal | Members |
|---|---|---|---|
| `proxy_public` | `.0` | no | proxy |
| `portal_ingress` | `.1` | no | portal-web |
| `field_edge` | `.2` | yes | proxy, field-web |
| `portal_app` | `.3` | yes | portal-web, portal-api |
| `field_app` | `.4` | yes | field-web, field-api |
| `portal_db` | `.5` | yes | portal-api, portal-db |
| `field_db` | `.6` | yes | field-api, field-db |
| `bridge` | `.7` | yes | portal-api, field-api |
| `portal_egress` | `.8` | no | portal-api (integrations) |

## Who can talk to whom

Docker lets two containers communicate only when they share a network. The full matrix:

| from \ to | portal-web | portal-api | portal-db | proxy | field-web | field-api | field-db | internet |
|---|---|---|---|---|---|---|---|---|
| **portal-web** | — | Yes | No | No | No | No | No | No |
| **portal-api** | No | — | Yes | No | No | Yes `/api/service/*` only | No | Yes (integrations) |
| **portal-db** | No | No | — | No | No | No | No | No |
| **proxy** | No (see below) | No | No | — | Yes | No | No | Yes (ACME) |
| **field-web** | No | No | No | No | — | Yes (refuses `/api/service`) | No | No |
| **field-api** | No | No (it binds only portal_app) | No | No | No | — | Yes | No |
| **field-db** | No | No | No | No | No | No | — | No |

A container can also reach a port the host publishes, which would give the proxy a
path to the Portal through the host's own Portal port. Three layers close it:

1. portal-web refuses the proxy's subnet (`PROXY_SUBNET`) before allowing private
   addresses (`deny` precedes `allow` in its access list).
2. portal-api refuses requests whose client address is in the proxy's subnet.
3. The installer's DOCKER-USER rules drop traffic from `proxy_public` to `portal_ingress`.

The three layers of bridge protection, applied in order:
1. **Network.** Only portal-api and field-api share the `bridge` network.
2. **Source address.** field-api accepts `/api/service/*` only from the bridge subnet
   (checked against the TCP peer address, never `X-Forwarded-For`). A bridge-subnet caller
   gets `404` on every other path, so the Portal can't reach Field logins or users.
3. **Token.** A static 256-bit service token, compared in constant time.

What crosses the bridge, always Portal → Field: shared inventory (read, checkout, return,
receive), field job captures (list, photos, mark imported), the branding push, the
first-admin bootstrap (only when the Field App has no users), and storage figures.

## Secrets and certificates

```
every `docker compose up`
  init ─┬─ secrets_portal_db  : db_password                       (uid 70, 0400, ro mount)
        ├─ secrets_portal_api : db_password, access/refresh secret,
        │                       encryption_key, bridge_token      (uid 1000, 0400, ro mount)
        ├─ secrets_portal_web : cert.pem, key.pem, ca.crt         (uid 101 / gid 1000, 0440, ro mount)
        ├─ secrets_field_db   : db_password                       (uid 70, 0400, ro mount)
        ├─ secrets_field_api  : db_password, access/refresh secret,
        │                       encryption_key, service_token     (uid 1000, 0400, ro mount)
        ├─ pki                : the local CA's key                (root, init only)
        ├─ host_control       : requests to the host helper, logs,
        │                       setup code copy                   (uid 1000, rw → portal-api, installer)
        └─ reveal             : setup_code, bundle.json           (uid 1000, 0600, rw → portal-api only)
```

- Apps read secrets with the `*_FILE` convention (`DB_PASSWORD_FILE=/run/secrets/app/db_password`).
- `setup_code` is printed in the Portal API log on every start while setup is pending
  (created there if missing), and destroyed when the wizard completes.
- `bundle.json` is destroyed the moment it's revealed. Destruction means: an atomic
  rename claims the file, so two concurrent requests can't both read it, then it's
  overwritten with random bytes three times, fsynced, truncated and unlinked. The
  database flag `system.secretsRevealedAt` makes the endpoint answer `410` permanently,
  even if a file were put back by hand. On copy-on-write or journaling filesystems,
  overwriting is best-effort. The hard guarantees are that the file is gone and the
  endpoint is closed.
- After the reveal, only root on the host can read the secrets
  (`/var/lib/docker/volumes/itmanager_secrets_*/_data/`). No helper script exists on
  purpose: root access to the host is the only way back to them.

**Portal HTTPS.** On first start `init` creates a local certificate authority (EC P-256,
10 years) and issues a server certificate (800 days, under Apple's 825-day limit) for
`localhost`, `127.0.0.1` and every entry of `PORTAL_HOSTNAMES`. It re-issues the
certificate when that list changes or less than 90 days remain. nginx presents the
certificate for every connection, with or without SNI, so the Portal works by IP
address. The CA certificate is served at `/ca.crt` for installing on staff devices.

## Integration settings

They're stored in `app_settings` under `integration:<id>` as `{ enabled, values }`. Secret
fields are encrypted with AES-256-GCM using the master `ENCRYPTION_KEY` (the same scheme
as the credentials vault). On start-up and after each save, the values are copied into
the in-memory `config` object that the integration clients already read at call time,
which is why a change takes effect without a restart. An integration that has never been
saved is seeded once from its legacy `.env` variable if one is present.

## Billing rates

The default hourly rates live in `app_settings` under `billing:default_rates`. A new
customer gets a copy in `customer_billing_rates`, in order. A new work order uses the
customer's rate named like the first default rate, falling back to the customer's first
rate. When an admin re-prices a default rate, existing customers can optionally be moved
to the new price, but only where their rate still has the old price.

## Storage monitoring

portal-api measures the filesystem behind its uploads volume with `statfs`. That is the
filesystem holding all Docker data, so its free space is what the whole stack runs on.
Database sizes come from `pg_database_size`, and file sizes from walking each uploads
directory. field-api reports its own figures over the bridge (`GET /api/service/storage`).
A snapshot goes into `storage_snapshots` every 6 hours (kept for 400 days). The
days-until-full forecast is a least-squares trend of used space over the last 30 days.

## Branding

Branding lives in `app_settings.branding` and `branding_assets` (images as `bytea`, with a
SHA-256 for cache-busting URLs). `/api/branding` and `/api/branding/assets/:kind` are
public, because the login page needs them. Uploaded images are identified by their bytes,
not the browser's claimed type. SVGs containing script, event handlers,
`javascript:` URLs or `foreignObject` are refused. All assets are served with
`Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`.

The Portal pushes a full copy to the Field App over the bridge after every change and at
start-up (with retries). The Field App never fetches anything from the Portal.

## Two-factor authentication

TOTP (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), implemented in `lib/totp.js`
(identical in both APIs) and checked against the RFC test vectors.

- **Policy** per app in `app_settings` (`security:mfa`): off, optional or required. The
  Portal stores both and pushes the Field App's value over the bridge
  (`PUT /api/service/security`), the same way as branding.
- **Sign-in.** After a correct password, a user who needs a second step gets a challenge
  token instead of a session: `verify` (enter a code) or `enroll` (required but not set
  up). Challenge tokens are signed with a key derived from the access-token secret
  (HMAC "mfa-challenge"), so `requireAuth` never accepts them; they expire after five
  minutes and lock after five wrong codes.
- **Storage.** `users.totp_secret` is encrypted with the app's `ENCRYPTION_KEY` (the Field
  API has its own, generated by `init`). `totp_last_step` records the last accepted step,
  so each code works once; the update is conditional, so concurrent use of one code
  succeeds once. Ten recovery codes are stored as SHA-256 hashes and removed atomically
  when used.
- **Reset.** Admins clear a user's 2FA (`POST /api/users/:id/mfa/reset`, in each app).

## Installation and the host helper

Installation has three stages:

1. `install.sh` (console) installs Docker, runs `init` (secrets, the Portal certificate,
   the setup code), applies the default firewall, installs the host helper, and starts the
   `installer` service on the Portal's port. It asks nothing.
2. The installer (the setup wizard) collects the office network, optional Portal DNS
   names, the internal subnet prefix, the firewall choice, the certificate validation mode
   and the update schedule.
3. The host helper installs: it writes `.env`, applies the firewall and the update timer,
   pulls the images and starts the stack, logging each stage to `install.log` for the
   browser. Once the Portal API is healthy it removes the installer and starts portal-web
   on the same port; the browser continues with the Portal's setup at `/setup`. The setup
   code verified by the installer is kept in the browser's session storage, so it is not
   asked twice.

The host helper is two systemd units installed by `install.sh`: `it-manager-host.path`
watches for a request file in the `host_control` volume and starts
`it-manager-host.service`, which runs `install.sh host-apply` as root. The installer and the
Portal API write requests; neither has any other way to affect the host.

- The request is copied without following links into a private file before it is read,
  and is limited to 1 KB. Accepted lines: `updates=off|daily:HH|weekly:DAY:HH` and
  `update=now` at any time; `check-prefix=` and `install=start` (with `lan`, `names`,
  `prefix`, `firewall`, `acme`, `updates`) only while setup is pending. Every value is
  matched against a strict pattern. Anything else is rejected with a generic error that
  never repeats the request's content.
- The helper writes `result.json` (per request id) and `status.json` (installation state,
  host facts, ports, firewall, validation mode, schedule, next and last update) back, by
  writing a new file and renaming it.
- Updates run as `it-manager-update.service` (`install.sh run-update`: `docker compose pull`,
  `up -d`, image prune, output to `update.log`), started by `it-manager-update.timer` or by
  "Update now".

## Firewall

Applied by the host helper (on by default, chosen in the setup wizard; afterwards
`sudo ./install.sh firewall on|off|status`). Docker-published ports bypass the host's INPUT
rules, so the rules live in Docker's `DOCKER-USER` chain and are re-applied by
`it-manager-firewall.service` whenever Docker starts. They match the *original*
destination port via conntrack:

- traffic from `proxy_public` to `portal_ingress`: dropped;
- 4443 (proxy, reached through the router's 443 mapping): from anywhere;
- 80 (proxy): from anywhere with HTTP validation, otherwise from the office network;
- 443 (Portal) and 81 (proxy admin): from the office network only;
- anything else new arriving on the external interface: dropped.

The host's own services (SSH, for example) are not changed. Ports are published on IPv4
only, because Docker's IPv6 userland proxy would hide client addresses from the
office-network checks. With the firewall off, the Portal's own address checks still apply.

Docker networks segment containers *inside* one host. If you also want 802.1Q VLAN
separation on the physical network (for example, the server on a management VLAN, phones on a
guest VLAN), do that on your switch or firewall. The stack doesn't need to know about it.
