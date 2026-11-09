// Auvik → a "Web UI" button on a customer's network gear: Auvik's Remote Browser, which
// reaches a printer's / switch's own web page through the Auvik collector on site.
// Pure functions only (no I/O).
//
// The remote-browser address is stable and behind the Auvik login:
//   https://{tenant domainPrefix}-{device id}-{port}.{region}.my.auvik.com/
// e.g. https://example42-1234567890123456789-443.us6.my.auvik.com/. Without an Auvik
// session the address redirects through Auvik's sign-in and back, so a technician
// signed in to Auvik in that browser lands directly on the device.
//
// API (Basic auth: Auvik username + API key):
//   GET https://auvikapi.{region}.my.auvik.com/v1/tenants          → [{ id, attributes: { domainPrefix, tenantType } }]
//   GET …/v1/tenants/detail?tenantDomainPrefix=…                   → [{ id, attributes: { domainPrefix, displayName } }]
//   GET …/v1/inventory/device/info?tenants=…                        → [{ id, attributes: { deviceName, deviceType,
//         ipAddresses[], makeModel, vendorName, serialNumber, onlineStatus }, relationships: { tenant: { data: { id } } } }]

import { norm } from './connectwise.js';

const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);

export const apiBase = (region) => `https://auvikapi.${str(region) || 'us1'}.my.auvik.com/v1`;

export function tenantOf(raw) {
  const a = raw?.attributes ?? {};
  return {
    id: str(raw?.id),
    domainPrefix: str(a.domainPrefix),
    name: str(a.displayName || a.name || a.domainPrefix),
    type: str(a.tenantType),
  };
}

/**
 * The device number the remote-browser address uses. Auvik's API may hand IDs back as-is
 * (digits) or base64-wrapped ("<tenant>:<device>"); either way the address wants the
 * device's own number.
 */
export function remoteId(id) {
  const s = str(id);
  if (/^\d+$/.test(s)) return s;
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    const digits = decoded.split(/[:/,]/)   // live IDs are base64 "<tenantId>,<deviceId>".map(p => p.trim()).filter(p => /^\d+$/.test(p));
    if (digits.length) return digits[digits.length - 1];
  } catch { /* not base64 */ }
  return s;
}

/** The Remote Browser address for one device and port. */
export function remoteBrowserUrl({ domainPrefix, deviceId, port = 443, region }) {
  return `https://${str(domainPrefix)}-${remoteId(deviceId)}-${Number(port) || 443}.${str(region) || 'us1'}.my.auvik.com/`;
}

/** The customer site in Auvik (where Remote Management → Tunnel lives). */
export const tenantUrl = ({ domainPrefix, region }) => `https://${str(domainPrefix)}.${str(region) || 'us1'}.my.auvik.com/`;

export function deviceOf(raw, tenantsById = new Map()) {
  const a = raw?.attributes ?? {};
  const tenantId = str(raw?.relationships?.tenant?.data?.id);
  const tenant = tenantsById.get(tenantId);
  return {
    id: str(raw?.id),
    name: str(a.deviceName),
    type: str(a.deviceType),
    make: str(a.vendorName || a.make),
    model: str(a.makeModel || a.model),
    ips: list(a.ipAddresses).map(str).filter(Boolean),
    serial: str(a.serialNumber),
    online: /online/i.test(str(a.onlineStatus)),
    tenant_id: tenantId,
    tenant_name: tenant?.name ?? '',
    domain_prefix: tenant?.domainPrefix ?? '',
  };
}

const companyKey = (v) => norm(v).replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(inc|llc|ltd|co|corp|corporation|company|pc|pllc|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
const serialKey = (v) => norm(v).replace(/[^a-z0-9]/g, '');

// Network gear and the like - what a web interface is useful for. Computers are reached
// through ScreenConnect instead.
const WEB_TYPES = new Set(['printer', 'switch', 'firewall', 'nas', 'network', 'other']);

/**
 * Which Auvik device each Portal device is.
 *   1. serial number - unique across every Auvik device
 *   2. IP address, then name - only inside this customer's Auvik site(s): learned from the
 *      serial matches, or a site named like the customer (or like its linked ConnectWise
 *      company - Auvik sites come from ConnectWise). Private IPs repeat across customers, so
 *      an address alone is never trusted outside the customer's own site.
 * @param siteNames names the customer is known by (Portal name, ConnectWise company/site)
 * @returns Map deviceId → { device, reason }
 */
export function matchAuvik(devices, auvikDevices, siteNames = []) {
  const all = list(auvikDevices);
  const bySerial = new Map();
  for (const d of all) { const k = serialKey(d.serial); if (k.length >= 4) bySerial.set(k, bySerial.has(k) ? null : d); }

  const out = new Map();
  const tenants = new Set();
  const portal = list(devices).filter(d => WEB_TYPES.has(d.device_type));
  for (const d of portal) {
    const hit = bySerial.get(serialKey(d.serial_number || d.service_tag));
    if (hit) { out.set(d.id, { device: hit, reason: 'serial number' }); tenants.add(hit.tenant_id); }
  }
  const names = list(siteNames).map(companyKey).filter(Boolean);
  for (const d of all) {
    const t = companyKey(d.tenant_name);
    if (t && names.some(n => t === n || t.startsWith(`${n} `) || n.startsWith(`${t} `))) tenants.add(d.tenant_id);
  }
  const scoped = all.filter(d => tenants.has(d.tenant_id));
  for (const d of portal) {
    if (out.has(d.id)) continue;
    const ip = str(d.ip_address);
    let hits = ip ? scoped.filter(a => a.ips.includes(ip)) : [];
    let reason = 'IP address';
    if (hits.length !== 1) {
      const name = norm(d.label || d.computer_name);
      hits = name ? scoped.filter(a => norm(a.name) === name) : [];
      reason = 'name';
    }
    if (hits.length === 1) out.set(d.id, { device: hits[0], reason });
  }
  return out;
}
