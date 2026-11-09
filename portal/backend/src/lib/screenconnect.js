// ScreenConnect sessions → the Remote button on Portal devices. Pure functions only
// (no I/O), unit-tested.
//
// Each machine with the ScreenConnect agent is an "Access" session. The RESTful API
// Manager returns sessions with the machine's own report in GuestInfo (MachineName,
// MachineSerialNumber, HardwareNetworkAddress, …). On the ConnectWise RMM-bundled
// instance, CustomProperty1/2 carry the RMM company and site names.

import { cleanSerial, formatMac, macKey, norm } from './connectwise.js';
import { deviceMacKeys } from './device-macs.js';

const str = (v) => (v == null ? '' : String(v).trim());

/** One raw session → the small record the Portal keeps (no keys, tokens or screenshots). */
export function sessionOf(raw) {
  const s = raw ?? {};
  const g = s.GuestInfo ?? {};
  const props = Array.isArray(s.CustomPropertyValues) ? s.CustomPropertyValues : [];
  const conns = Array.isArray(s.ActiveConnections) ? s.ActiveConnections : [];
  return {
    id:           str(s.SessionID),
    name:         str(s.Name),
    machine:      str(g.MachineName),
    serial:       cleanSerial(g.MachineSerialNumber),
    mac:          formatMac(g.HardwareNetworkAddress),
    manufacturer: str(g.MachineManufacturerName),
    model:        str(g.MachineModel),
    private_ip:   str(g.PrivateNetworkAddress),
    company:      str(props[0] ?? s.CustomProperties?.CustomProperty1),
    site:         str(props[1] ?? s.CustomProperties?.CustomProperty2),
    // ProcessType 2 = the guest (the machine itself) is connected right now.
    online:       conns.some(c => c?.ProcessType === 2),
    last_seen:    str(s.LastGuestConnectedEventTime || g.LastActivityTime) || null,
    ended:        Boolean(s.IsEnded || s.IsDeleted),
  };
}

/**
 * The link ScreenConnect's own Join button opens. With command 'JoinWithOptions' it opens
 * the Join-with-options dialog instead — the way into Backstage, which has no link of its own.
 */
export function joinUrl(baseUrl, group, sessionId, command = 'Join') {
  return `${str(baseUrl).replace(/\/+$/, '')}/Host#Access/${encodeURIComponent(group || 'All Machines')}//${encodeURIComponent(sessionId)}/${command}`;
}

// Company names compared loosely: "Smith Dental, LLC" ≈ "smith dental".
const companyKey = (v) => norm(v).replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(inc|llc|ltd|co|corp|corporation|company|pc|pllc|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

const COMPUTER_TYPES = new Set(['workstation', 'server', 'other']);

/**
 * Which ScreenConnect session each Portal device is.
 *   1. serial number / service tag — unique across every session
 *   2. MAC address                 — unique across every session
 *   3. computer name               — only among sessions of THIS customer's ScreenConnect
 *      company (learned from the serial/MAC matches, or a company whose name matches
 *      the customer's), and only when exactly one session has that name. A name like
 *      "FRONTDESK" exists at several customers; guessing would open another customer's PC.
 *
 * @param devices      Portal devices of one customer
 * @param sessions     sessionOf() records
 * @param customerName the Portal customer's name
 * @returns Map deviceId → { session, reason }
 */
export function matchSessions(devices, sessions, customerName = '') {
  const live = (sessions ?? []).filter(s => s.id && !s.ended);
  const unique = (key) => {
    const m = new Map();
    for (const s of live) { const k = key(s); if (k) m.set(k, m.has(k) ? null : s); }
    return m;
  };
  const bySerial = unique(s => norm(s.serial).replace(/\s+/g, ''));
  const byMac = unique(s => macKey(s.mac));

  const out = new Map();
  const companies = new Set();
  for (const d of devices ?? []) {
    const serial = norm(cleanSerial(d.service_tag || d.serial_number)).replace(/\s+/g, '');
    // Any of the device's MACs (its network port or Wi-Fi).
    const byAnyMac = [...deviceMacKeys(d)].map(k => byMac.get(k)).find(Boolean);
    const hit = (serial && bySerial.get(serial)) ? { session: bySerial.get(serial), reason: 'serial number' }
      : byAnyMac ? { session: byAnyMac, reason: 'MAC address' }
      : null;
    if (hit) { out.set(d.id, hit); if (hit.session.company) companies.add(companyKey(hit.session.company)); }
  }

  const customer = companyKey(customerName);
  const inScope = (s) => {
    const c = companyKey(s.company);
    return c && (companies.has(c) || (customer && (c === customer || c.startsWith(`${customer} `) || customer.startsWith(`${c} `))));
  };
  const scoped = live.filter(inScope);
  for (const d of devices ?? []) {
    if (out.has(d.id) || !COMPUTER_TYPES.has(d.device_type)) continue;
    const names = [...new Set([d.computer_name, d.label].map(norm).filter(Boolean))];
    if (!names.length) continue;
    const hits = scoped.filter(s => names.includes(norm(s.machine)) || names.includes(norm(s.name)));
    if (hits.length === 1) out.set(d.id, { session: hits[0], reason: 'computer name' });
  }
  return out;
}
