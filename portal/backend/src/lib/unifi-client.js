import { config } from '../config/index.js';
import { makeCache, mapLimit, saidBy, fetchWithRetry, onIntegrationChange } from './integration-util.js';

/**
 * READ-ONLY client for UniFi's cloud API (api.ui.com). One API key from unifi.ui.com →
 * Settings → API Keys.
 *
 *   Site Manager   GET /v1/hosts, GET /v1/devices                     (every console the account can see)
 *   Connector      GET /v1/connector/consoles/{hostId}/proxy/network/… (consoles the account OWNS)
 *
 * The key can also change settings through the connector (create/delete firewall
 * rules…). This client has no way to send anything but GET, so the Portal can't.
 *
 * The classic Network API returns secrets alongside settings (WiFi passphrases, PPPoE
 * and VPN keys - every one in an `x_…` field). Those are dropped the moment a response
 * arrives, before anything is cached.
 *
 * Connector limit: 100 requests a minute per console; one console's full read is ~20.
 */

const API = 'https://api.ui.com';

export function isUnifiConfigured() {
  return Boolean(config.unifi.apiKey);
}

export class UnifiError extends Error {
  constructor(message, status = 502, code = null) {
    super(message);
    this.status = status;
    this.code = code;          // 'not_owner' when the connector refuses a shared console
  }
}

const unreachable = () => new UnifiError('UniFi (api.ui.com) could not be reached. Check this server\'s internet access.');

// Strip secret fields (x_passphrase, x_ipsec_pre_shared_key, x_wan_password, …).
const scrub = (rows) => (Array.isArray(rows) ? rows : []).map(r =>
  (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('x_'))) : r));

async function get(url, where) {
  if (!isUnifiConfigured()) throw new UnifiError('UniFi is not configured. An admin can set it up in Admin → Integrations.', 503);
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { 'X-API-KEY': config.unifi.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  }, unreachable);
  if (res.status === 401) throw new UnifiError('UniFi rejected the API key (UNIFI_API_KEY). Create a new one at unifi.ui.com → Settings → API Keys.');
  if (res.status === 403) {
    const said = await saidBy(res, 'UniFi');
    if (/not the owner/i.test(said)) {
      throw new UnifiError('This console is shared with your UniFi account, not owned by it, so UniFi only provides its device list.', 403, 'not_owner');
    }
    throw new UnifiError(`UniFi refused ${where}.${said}`, 502);
  }
  if (!res.ok) {
    const err = new UnifiError(`UniFi returned ${res.status} for ${where}.${await saidBy(res, 'UniFi')}`, res.status === 404 ? 404 : 502);
    err.upstream = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Site Manager (every console) ---------------------------------------------

async function siteManagerAll(path) {
  const out = [];
  let next = '';
  for (let page = 0; page < 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await get(`${API}${path}${sep}pageSize=500${next ? `&nextToken=${encodeURIComponent(next)}` : ''}`, path);
    out.push(...(Array.isArray(body?.data) ? body.data : []));
    next = body?.nextToken;
    if (!next) break;
  }
  return out;
}

const cache = makeCache(2 * 60 * 1000);

/** Every console (host) the account can see - raw records (see lib/unifi.js hostOf). */
export const hosts = ({ refresh = false } = {}) => cache.get('hosts', refresh, () => siteManagerAll('/v1/hosts'));

/** Every device, grouped by console: [{ hostId, hostName, devices: [...] }]. */
export const deviceGroups = ({ refresh = false } = {}) => cache.get('devices', refresh, () => siteManagerAll('/v1/devices'));

// --- Connector (owned consoles) -----------------------------------------------

const connector = (hostId, path) =>
  get(`${API}/v1/connector/consoles/${encodeURIComponent(hostId)}/proxy${path}`, path.replace(/\/sites\/[^/]+/, '/sites/…'));

// Every row of a Network-integration list (offset-paged, 200 at a time).
async function integrationAll(hostId, path) {
  const out = [];
  for (let offset = 0, pages = 0; pages < 20; pages++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await connector(hostId, `/network/integration/v1${path}${sep}limit=200&offset=${offset}`);
    const rows = Array.isArray(body?.data) ? body.data : [];
    out.push(...rows);
    offset += rows.length;
    if (!rows.length || offset >= (body?.totalCount ?? 0)) break;
  }
  return out;
}

// Optional reads: a failure leaves that part blank and explains why, rather than
// failing the whole console.
async function optional(notes, label, load) {
  try {
    return await load();
  } catch (e) {
    if (!(e instanceof UnifiError)) throw e;
    if (/zone.based.firewall.not.configured/i.test(e.message)) return null;   // pre-zone firewall: use the legacy rules
    notes.push(`${label}: ${e.message}`);
    return null;
  }
}

/**
 * Everything the import reads from one owned console, for one of its Network sites.
 * @param siteId the Network integration site ID; defaults to the console's only/first site
 * @returns {{ sites, site, device_macs, networks, wifi, zones, policies, legacy, forwards, networkconf,
 *            clients_online, clients_known, device_ip_modes, vpn_users, notes }}
 * @throws UnifiError code 'not_owner' when the console is only shared with the account
 */
export const consoleNetwork = (hostId, siteId, { refresh = false } = {}) =>
  cache.get(`network:${hostId}:${siteId ?? ''}`, refresh, async () => {
    const notes = [];
    const sites = (await integrationAll(hostId, '/sites')).map(s => ({ id: s.id, ref: s.internalReference || 'default', name: s.name || s.internalReference }));
    const site = sites.find(s => s.id === siteId) ?? sites[0] ?? null;
    if (!site) return { sites, site: null, device_macs: [], networks: [], wifi: [], zones: [], policies: [], legacy: [], forwards: [], networkconf: [], clients_online: [], clients_known: [], device_ip_modes: {}, vpn_users: {}, notes };

    const s = `/sites/${site.id}`;
    const classic = (path) => connector(hostId, `/network/api/s/${encodeURIComponent(site.ref)}${path}`).then(b => scrub(b?.data));
    const [devices, networkList, wifi, zones, policies, networkconf, forwards, legacy, online, known, unifiDevices] = await Promise.all([
      optional(notes, 'Devices', () => integrationAll(hostId, `${s}/devices`)),
      optional(notes, 'Networks', () => integrationAll(hostId, `${s}/networks`)),
      optional(notes, 'WiFi', () => integrationAll(hostId, `${s}/wifi/broadcasts`)),
      optional(notes, 'Firewall zones', () => integrationAll(hostId, `${s}/firewall/zones`)),
      optional(notes, 'Firewall policies', () => integrationAll(hostId, `${s}/firewall/policies`)),
      optional(notes, 'WAN settings', () => classic('/rest/networkconf')),
      optional(notes, 'Port forwards', () => classic('/rest/portforward')),
      optional(notes, 'Firewall rules (legacy)', () => classic('/rest/firewallrule')),
      optional(notes, 'Connected clients', () => classic('/stat/sta')),
      optional(notes, 'Known clients', () => classic('/rest/user')),
      optional(notes, 'Device IP settings', () => classic('/stat/device')),
    ]);
    // WireGuard servers list their users (peer name + VPN address) separately.
    const vpnUsers = {};
    for (const n of (networkconf ?? []).filter(x => x.vpn_type === 'wireguard-server')) {
      const users = await optional(notes, `VPN users (${n.name})`, () =>
        connector(hostId, `/network/v2/api/site/${encodeURIComponent(site.ref)}/wireguard/${n._id}/users?networkId=${n._id}`));
      vpnUsers[n._id] = (Array.isArray(users) ? users : []).map(u => ({ name: u.name, interface_ip: u.interface_ip }));
    }
    // Each UniFi device's own network setting: DHCP or static.
    const ipModes = {};
    for (const d of unifiDevices ?? []) {
      const mac = String(d.mac ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
      const mode = d.config_network?.type;
      if (mac && (mode === 'dhcp' || mode === 'static')) ipModes[mac] = mode;
    }
    // Clients: only what the import uses (no traffic stats, no fingerprint internals).
    const slim = (rows) => (rows ?? []).map(c => ({
      mac: c.mac, name: c.name, hostname: c.hostname, oui: c.oui, ip: c.ip, last_ip: c.last_ip,
      use_fixedip: c.use_fixedip, fixed_ip: c.fixed_ip, noted: c.noted, dev_cat: c.dev_cat, is_wired: c.is_wired,
      last_connection_network_name: c.last_connection_network_name, network: c.network, last_seen: c.last_seen,
    }));
    // The list is a summary; each network's own record has its subnet and DHCP range.
    const networks = (await mapLimit(networkList ?? [], 4, (n) =>
      optional(notes, `Network ${n.name}`, () => connector(hostId, `/network/integration/v1${s}/networks/${n.id}`)).then(d => d ?? n)))
      .filter(Boolean);
    return {
      sites, site,
      device_macs: (devices ?? []).map(d => String(d.macAddress ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase()).filter(Boolean),
      networks,
      // Keep only what the VLAN notes use - never a passphrase.
      wifi: (wifi ?? []).map(w => ({
        id: w.id, name: w.name, enabled: w.enabled, network: w.network,
        securityConfiguration: { type: w.securityConfiguration?.type ?? null },
      })),
      zones: zones ?? [],
      policies: policies ?? [],
      legacy: legacy ?? [],
      forwards: forwards ?? [],
      networkconf: networkconf ?? [],
      clients_online: slim(online),
      clients_known: slim(known),
      device_ip_modes: ipModes,
      vpn_users: vpnUsers,
      notes,
    };
  });

/**
 * Site-to-site VPN pre-shared keys, for the Credentials import. Like wifiWithPasswords:
 * read fresh, never cached, handed straight to the importer (which encrypts them).
 * @returns [{ external_id, _id, name, vpn_type, ipsec_peer_ip, psk }]
 */
export async function vpnSecrets(hostId, siteRef) {
  const body = await connector(hostId, `/network/api/s/${encodeURIComponent(siteRef || 'default')}/rest/networkconf`);
  return (Array.isArray(body?.data) ? body.data : [])
    .filter(n => n.purpose === 'site-vpn' && typeof n.x_ipsec_pre_shared_key === 'string' && n.x_ipsec_pre_shared_key)
    .map(n => ({ external_id: n.external_id, _id: n._id, name: n.name, vpn_type: n.vpn_type, ipsec_peer_ip: n.ipsec_peer_ip, psk: n.x_ipsec_pre_shared_key }));
}

/**
 * The site's WiFi networks WITH their passwords, for the Credentials import. The one
 * place a secret is kept from a UniFi response - and so never cached: read fresh for the
 * request that needs it, passed straight to the importer (which encrypts it before it's
 * stored), then dropped. Only the fields the import uses come back.
 * @returns [{ id, external_id, name, security, wpa_mode, enabled, is_guest, hidden,
 *             networkconf_id, passphrase, ppsk: [{ networkconf_id, password }] }]
 */
export async function wifiWithPasswords(hostId, siteRef) {
  const body = await connector(hostId, `/network/api/s/${encodeURIComponent(siteRef || 'default')}/rest/wlanconf`);
  return (Array.isArray(body?.data) ? body.data : []).map(w => ({
    id: String(w._id ?? ''),
    external_id: String(w.external_id ?? ''),
    name: String(w.name ?? ''),
    security: String(w.security ?? ''),
    wpa_mode: String(w.wpa_mode ?? ''),
    wpa3: Boolean(w.wpa3_support),
    enabled: w.enabled !== false,
    is_guest: Boolean(w.is_guest),
    hidden: Boolean(w.hide_ssid),
    networkconf_id: String(w.networkconf_id ?? ''),
    passphrase: typeof w.x_passphrase === 'string' ? w.x_passphrase : '',
    ppsk: w.private_preshared_keys_enabled && Array.isArray(w.private_preshared_keys)
      ? w.private_preshared_keys.map(k => ({ networkconf_id: String(k?.networkconf_id ?? ''), password: String(k?.password ?? k?.x_password ?? '') }))
          .filter(k => k.password)
      : [],
  }));
}

onIntegrationChange('unifi', () => cache.clear());

export const _raw = { get, connector, reset: () => cache.clear() };
