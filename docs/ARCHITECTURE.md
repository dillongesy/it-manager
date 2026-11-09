# Architecture & security

## Services

| Service | Image | Runs as | Networks | Purpose |
|---|---|---|---|---|
| `init` | `init` | root, then exits | none | Generates secrets on first boot and re-asserts permissions on every start |
| `edge` | `edge` (Caddy) | root, only `NET_BIND_SERVICE` | public, portal_edge, field_edge | TLS, HTTP→HTTPS, LAN-only gate, security headers |
| `portal-web` | `portal-web` (nginx) | nginx (101), read-only | portal_edge, portal_app | Serves the Portal SPA and proxies `/api` |
| `portal-api` | `portal-api` (Node) | node (1000), read-only | portal_app (fixed .3.10), portal_db, bridge, portal_egress | Portal API; runs migrations on start |
| `portal-db` | `postgres:17-alpine` | postgres (70) | portal_db | Portal database |
| `field-web` | `field-web` (nginx) | nginx (101), read-only | field_edge, field_app | Serves the Field SPA and proxies `/api` (refuses `/api/service`) |
| `field-api` | `field-api` (Node) | node (1000), read-only | field_app, field_db, bridge | Field API |
| `field-db` | `postgres:17-alpine` | postgres (70) | field_db | Field database |

## Who can talk to whom

Docker puts two containers in contact only when they share a network. The full matrix:

| from \ to | edge | portal-web | portal-api | portal-db | field-web | field-api | field-db | internet |
|---|---|---|---|---|---|---|---|---|
| **edge** | — | Yes | No | No | Yes | No | No | Yes (ACME) |
| **portal-web** | — | — | Yes | No | No | No | No | No |
| **portal-api** | No | No | — | Yes | No | Yes `/api/service/*` only | No | Yes (integrations) |
| **portal-db** | No | No | No | — | No | No | No | No |
| **field-web** | No | No | No | No | — | Yes (refuses `/api/service`) | No | No |
| **field-api** | No | No | No (it binds only portal_app) | No | No | — | Yes | No |
| **field-db** | No | No | No | No | No | No | — | No |

The three layers of bridge protection, applied in order:
1. **Network.** Only portal-api and field-api share the `bridge` network.
2. **Source address.** field-api accepts `/api/service/*` only from the bridge subnet
   (checked against the TCP peer address, never `X-Forwarded-For`). A bridge-subnet caller
   gets `404` on every other path, so the Portal can't reach Field logins or users.
3. **Token.** A static 256-bit service token, compared in constant time.

What crosses the bridge, always Portal → Field: shared inventory (read, checkout, return,
receive), field job captures (list, photos, mark imported), the branding push, and the
first-admin bootstrap (only when the Field App has no users).

## Secrets lifecycle

```
first `docker compose up`
  init ─┬─ secrets_portal_db  : db_password                       (uid 70, 0400, ro mount)
        ├─ secrets_portal_api : db_password, access/refresh secret,
        │                       encryption_key, bridge_token      (uid 1000, 0400, ro mount)
        ├─ secrets_field_db   : db_password                       (uid 70, 0400, ro mount)
        ├─ secrets_field_api  : db_password, access/refresh secret,
        │                       service_token                     (uid 1000, 0400, ro mount)
        └─ reveal             : setup_code, bundle.json           (uid 1000, 0600, rw → portal-api only)
```

- Apps read secrets with the `*_FILE` convention (`DB_PASSWORD_FILE=/run/secrets/app/db_password`).
- `setup_code` is destroyed when the wizard completes.
- `bundle.json` is destroyed the moment it's revealed. Destruction means: an atomic
  rename claims the file, so two concurrent requests can't both read it, then it's
  overwritten with random bytes three times, fsynced, truncated and unlinked. The
  database flag `system.secretsRevealedAt` makes the endpoint answer `410` permanently,
  even if a file were put back by hand. On copy-on-write or journaling filesystems,
  overwriting is best-effort. The hard guarantees are that the file is gone and the
  endpoint is closed.
- After the reveal, only root on the host can read the secrets
  (`/var/lib/docker/volumes/itmanager_secrets_*/_data/`). No helper script exists on
  purpose: root access to the host is the only backdoor.

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

`scripts/firewall.sh` (run by install.sh):

- **ufw:** default deny incoming, allow outgoing. OpenSSH is allowed from the LAN CIDR only
  (`SSH_FROM=any` to override).
- **DOCKER-USER** (persisted in `/etc/ufw/after.rules`). Filters traffic forwarded to
  containers, matching the *original* destination port via conntrack:
  - 80/443: LAN only (LAN mode). Open in domain mode, because Let's Encrypt must reach
    them. Caddy still refuses non-LAN clients for the Portal hostname.
  - Field port: LAN, or anywhere when `FIELD_PUBLIC=yes`.
  - Anything else new arriving on the external interface: dropped.
- Ports are published on IPv4 only, because Docker's IPv6 userland proxy would hide
  client addresses from the LAN-only check.

Docker networks segment containers *inside* one host. If you also want 802.1Q VLAN
separation on the physical network (for example, the server on a management VLAN, phones on a
guest VLAN), do that on your switch or firewall. The stack doesn't need to know about it.
