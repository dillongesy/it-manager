# Architecture and security

## Services

| Service | Image | Runs as | Networks | Purpose |
|---|---|---|---|---|
| `init` | `init` | root, then exits | none | Generates secrets and the Portal certificate on first start; re-asserts permissions and renews the certificate on every start |
| `portal-web` | `portal-web` (nginx) | nginx (101), read-only | portal_ingress, portal_app | Portal HTTPS on 8443 (LAN only), serves the SPA, proxies `/api` |
| `portal-api` | `portal-api` (Node) | node (1000), read-only | portal_app (fixed .3.10), portal_db, bridge, portal_egress | Portal API; runs migrations on start |
| `portal-db` | `postgres:17-alpine` | postgres (70) | portal_db | Portal database |
| `proxy` | `jc21/nginx-proxy-manager` | root, 7 capabilities | proxy_public, field_edge | Internet entrance for the Field App: TLS (Let's Encrypt), 80/443; admin UI on 81 |
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
path to the Portal through the host's own `:8443`. Three layers close it:

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
        ├─ secrets_portal_web : cert.pem, key.pem, ca.crt         (uid 101, 0400, ro mount)
        ├─ secrets_field_db   : db_password                       (uid 70, 0400, ro mount)
        ├─ secrets_field_api  : db_password, access/refresh secret,
        │                       service_token                     (uid 1000, 0400, ro mount)
        ├─ pki                : the local CA's key                (root, init only)
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

## Host firewall

Applied by `install.sh` (on by default; `sudo ./install.sh firewall on|off|status`):

- **ufw:** default deny incoming, allow outgoing. SSH is allowed from the LAN CIDR only
  (`SSH_FROM=any` in `/etc/it-manager/install.conf` to override).
- **DOCKER-USER** (persisted in `/etc/ufw/after.rules`). Filters traffic forwarded to
  containers, matching the *original* destination port via conntrack:
  - traffic from `proxy_public` to `portal_ingress`: dropped;
  - 80 and 443 (proxy): from anywhere;
  - 8443 (Portal) and 81 (proxy admin): LAN only;
  - anything else new arriving on the external interface: dropped.
- Ports are published on IPv4 only, because Docker's IPv6 userland proxy would hide
  client addresses from the LAN-only checks.

With the firewall off, the Portal's own address checks still apply; forward only 80
and 443 from the router.

Docker networks segment containers *inside* one host. If you also want 802.1Q VLAN
separation on the physical network (for example, the server on a management VLAN, phones on a
guest VLAN), do that on your switch or firewall. The stack doesn't need to know about it.
