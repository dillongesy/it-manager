// UniFi → Portal devices, firewall details and cameras. Pure functions only (no I/O),
// unit-tested. The shapes below are what api.ui.com returned on a live MSP account
// (2026-10-26).
//
//   Site Manager  GET /v1/hosts    → consoles: { id, ipAddress, owner, reportedState: {
//                                    name, hostname, state, version, mac, wans[],
//                                    hardware: { name, shortname, mac }, controllers[] } }
//                 GET /v1/devices  → [{ hostId, hostName, devices: [{ id, mac, name, model,
//                                    shortname, ip, productLine, status, version, isConsole }] }]
//   Through the connector, on consoles the account OWNS:
//     Network integration API  /proxy/network/integration/v1/sites/{site}/…
//       networks (+ /{id} for subnet & DHCP), wifi/broadcasts, firewall/zones, firewall/policies
//     Classic Network API      /proxy/network/api/s/{site}/rest/…
//       networkconf (WAN static IP / mask / gateway / DNS), portforward, firewallrule
//       (the pre-zone firewall)

import { randomUUID } from 'crypto';
import { formatMac, macKey, norm, cleanManufacturer } from './connectwise.js';
import { brandType } from './device-type.js';
import { addMacs, addressFor, deviceMacKeys } from './device-macs.js';
import { planner } from './sync-merge.js';

const str = (v) => (v == null ? '' : String(v).trim());
const compact = (v) => norm(v).replace(/\s+/g, '');
const list = (v) => (Array.isArray(v) ? v : []);

// ─── Consoles ─────────────────────────────────────────────────────────────────

export function hostOf(h) {
  const rs = h?.reportedState ?? {};
  const hw = rs.hardware ?? {};
  const app = (name) => list(rs.controllers).find(c => c?.name === name && c?.state === 'active');
  return {
    id:        str(h?.id),
    name:      str(rs.name || rs.hostname) || 'UniFi console',
    model:     str(hw.name),
    shortname: str(hw.shortname),
    public_ip: str(h?.ipAddress || rs.ip),
    mac:       macKey(rs.mac || hw.mac),
    firmware:  str(rs.version || hw.firmwareVersion),
    // The connector (WAN, VLANs, firewall rules) only answers on consoles the account owns.
    owner:     Boolean(h?.owner),
    online:    rs.state === 'connected',
    network:   app('network')?.version || null,
    protect:   app('protect')?.version || null,
    wans:      list(rs.wans),
  };
}

/** The console's page on unifi.ui.com — a handy management link for the gateway. */
// Console IDs are hex + ':' + digits; UniFi's own links keep the colon as-is.
export const consoleUrl = (hostId) => `https://unifi.ui.com/consoles/${encodeURIComponent(hostId).replace(/%3A/gi, ':')}/network/default/dashboard`;

// ─── Devices ──────────────────────────────────────────────────────────────────

const GATEWAY_SHORT = /^(UDM|UDR|UCG|UXG|USG|UGW|UDW|EFG|UX(MAX|\d)?$)/i;
const GATEWAY_MODEL = /\b(UDM|UDR|UCG|UXG|USG|Dream (Machine|Router|Wall)|Cloud Gateway|Gateway (Lite|Max|Pro|Ultra|Fiber)|Enterprise Fortress)\b/i;
const PROTECT_NOT_CAMERA = /viewport|chime|sensor|siren|superlink|bridge|ai ?port|ai ?key|\bhub\b|display|\block\b|reader|intercom viewer/i;

/**
 * What a UniFi device is:
 *   gateway (→ firewall) · switch · nas · console (Cloud Key) · other (APs, bridges… → network)
 *   nvr (Protect console → camera system) · camera · protect_other (Viewport, chime… skipped)
 */
export function classify(d) {
  const model = str(d?.model);
  const short = str(d?.shortname);
  if (norm(d?.productLine) === 'protect') {
    if (d?.isConsole) return 'nvr';
    return PROTECT_NOT_CAMERA.test(model) ? 'protect_other' : 'camera';
  }
  if (GATEWAY_SHORT.test(short) || GATEWAY_MODEL.test(model)) return 'gateway';
  if (/^UNAS/i.test(short) || /\b(UNAS|NAS)\b/i.test(model)) return 'nas';
  if (/^(USW|US)\b/i.test(model) || /^(USW|USL|USM|USP|USF|US\d)/i.test(short)) return 'switch';
  if (/^UCK/i.test(short) || /\b(cloud ?key|UCK)\b/i.test(model)) return 'console';
  return 'other';
}

export const PORTAL_TYPE = { gateway: 'firewall', switch: 'switch', nas: 'nas', console: 'network', other: 'network' };

export function deviceOf(d, host) {
  const kind = classify(d);
  return {
    key:       str(d?.id) || macKey(d?.mac),      // UniFi's device ID is its MAC, as hex
    name:      str(d?.name) || str(d?.model) || 'UniFi device',
    model:     str(d?.model),
    ip:        str(d?.ip),
    mac:       formatMac(d?.mac),
    serial:    macKey(d?.mac),                    // UniFi prints the MAC as the serial number
    firmware:  str(d?.version),
    online:    norm(d?.status) === 'online',
    console:   Boolean(d?.isConsole),
    kind,
    portal_type: PORTAL_TYPE[kind] ?? null,       // null = not a Devices-tab record (cameras, NVRs…)
    host_id:   str(host?.id ?? d?.hostId),
  };
}

// "USW Pro 48 PoE" → 48.
export function portCountFrom(model) {
  const m = str(model).match(/\b(5|8|10|16|24|48)\b/);
  return m ? Number(m[1]) : null;
}

/** Devices-tab columns for one UniFi device. Blanks are never written. */
export function deviceFields(dev, extras = {}) {
  const type = dev.portal_type;
  // ip_assignment: the device's own network setting (DHCP / static), when UniFi reported it.
  const base = { device_type: type, label: dev.name, model: dev.model, mac_address: dev.mac, ip_assignment: dev.ip_assignment ?? '' };
  if (type === 'firewall') {
    return {
      ...base,
      manufacturer: 'Ubiquiti',
      firmware_version: dev.firmware,
      serial_number: dev.serial,
      driver_url: dev.host_id ? consoleUrl(dev.host_id) : '',
      external_ips: extras.external_ips ?? [],
      internal_ips: extras.internal_ips ?? [],
      wan_subnet_mask: extras.wan_subnet_mask ?? '',
      wan_gateway: extras.wan_gateway ?? '',
      wan_dns: extras.wan_dns ?? '',
      vlans: extras.vlans ?? [],
      firewall_rules: extras.firewall_rules ?? [],
      vpns: extras.vpns ?? [],
    };
  }
  if (type === 'switch') {
    return {
      ...base,
      manufacturer: 'Ubiquiti',
      ip_address: dev.ip,
      firmware_version: dev.firmware,
      serial_number: dev.serial,
      port_count: portCountFrom(dev.model),
      managed_switch: true,
    };
  }
  return { ...base, ip_address: dev.ip };
}

// ─── WAN ──────────────────────────────────────────────────────────────────────

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|127\.)/;
const isIpv4 = (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(str(v));
export const isPublicIpv4 = (v) => isIpv4(v) && !PRIVATE.test(str(v));

/**
 * WAN details for the firewall record.
 * @param networkconf classic rest/networkconf rows (secret x_ fields already removed)
 * @param host        hostOf() record (live WAN addresses + the console's public IP)
 * @returns {{ external_ips: string[], wan_subnet_mask, wan_gateway, wan_dns, wans: [{name, type, ip}] }}
 */
export function wanFrom(networkconf, host) {
  const wans = list(networkconf).filter(n => n?.purpose === 'wan')
    .sort((a, b) => (a.wan_failover_priority ?? 9) - (b.wan_failover_priority ?? 9));
  const ips = [];
  for (const w of wans) {
    if (w.wan_type === 'static' && isIpv4(w.wan_ip)) ips.push(w.wan_ip);
    for (const a of list(w.wan_ip_aliases)) { const ip = str(a).split('/')[0]; if (isIpv4(ip)) ips.push(ip); }
  }
  for (const w of list(host?.wans)) if (w?.plugged !== false && isPublicIpv4(w?.ipv4)) ips.push(w.ipv4);
  if (isPublicIpv4(host?.public_ip)) ips.push(host.public_ip);

  const primary = wans.find(w => w.wan_type === 'static');
  const dns = primary && primary.wan_dns_preference !== 'auto'
    ? [primary.wan_dns1, primary.wan_dns2].map(str).filter(Boolean).join(', ') : '';
  return {
    external_ips: [...new Set(ips)],
    wan_subnet_mask: primary ? str(primary.wan_netmask) : '',
    wan_gateway: primary ? str(primary.wan_gateway) : '',
    wan_dns: dns,
    wans: wans.map(w => ({ name: str(w.name), type: str(w.wan_type), ip: str(w.wan_ip) })),
  };
}

// ─── VLANs ────────────────────────────────────────────────────────────────────

export function prefixToMask(prefix) {
  const p = Number(prefix);
  if (!Number.isInteger(p) || p < 0 || p > 32) return '';
  const bits = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  return [24, 16, 8, 0].map(s => (bits >>> s) & 255).join('.');
}

export function networkAddress(ip, prefix) {
  const mask = prefixToMask(prefix);
  if (!isIpv4(ip) || !mask) return '';
  const m = mask.split('.').map(Number);
  return str(ip).split('.').map((o, i) => Number(o) & m[i]).join('.');
}

/**
 * Network-integration networks (the detailed /networks/{id} records) → the Portal's
 * VLAN list. WiFi networks riding on each VLAN are noted. Tagged `source: 'unifi'` +
 * the UniFi network ID, so a re-import updates the same entry.
 */
export function vlansFrom(networks, wifi = []) {
  return list(networks)
    .slice().sort((a, b) => (a.vlanId ?? 0) - (b.vlanId ?? 0))
    .map(n => {
      const v4 = n.ipv4Configuration ?? {};
      const dhcp = v4.dhcpConfiguration ?? {};
      const host = str(v4.hostIpAddress);
      const prefix = v4.prefixLength;
      const range = dhcp.ipAddressRange;
      const ssids = list(wifi)
        .filter(w => (w.network?.type === 'SPECIFIC' && w.network.networkId === n.id) || (w.network?.type === 'NATIVE' && n.default))
        .map(w => `${str(w.name)}${w.securityConfiguration?.type === 'OPEN' ? ' (open)' : ''}${w.enabled === false ? ' (off)' : ''}`);
      const notes = [
        ssids.length ? `WiFi: ${ssids.join(', ')}` : '',
        n.enabled === false ? 'disabled' : '',
        n.internetAccessEnabled === false ? 'no internet access' : '',
      ].filter(Boolean).join(' · ');
      return {
        vlan_id: n.vlanId != null ? String(n.vlanId) : '',
        name: str(n.name),
        ip_group: host && prefix != null ? `${networkAddress(host, prefix)}/${prefix}` : '',
        gateway: n.management === 'GATEWAY' ? host : '',
        subnet_mask: prefix != null ? prefixToMask(prefix) : '',
        dhcp_range: dhcp.mode === 'SERVER' && range?.start ? `${range.start} - ${range.stop}` : dhcp.mode === 'RELAY' ? 'DHCP relay' : '',
        dns: list(dhcp.dnsServerIpAddressesOverride).join(', '),
        client_isolation: Boolean(n.isolationEnabled),
        notes,
        source: 'unifi',
        external_id: str(n.id),
      };
    });
}

/** The gateway's own address on each network it routes — the firewall's "Internal IPs". */
export const internalIpsFrom = (networks) =>
  [...new Set(list(networks).filter(n => n.management === 'GATEWAY').map(n => str(n.ipv4Configuration?.hostIpAddress)).filter(isIpv4))];

const VLAN_SYNCED = ['vlan_id', 'name', 'ip_group', 'gateway', 'subnet_mask', 'dhcp_range', 'dns', 'client_isolation'];

/**
 * Merge imported VLANs into what the Portal has. Matched by UniFi network ID, then VLAN
 * number. New VLANs are added and blank details filled; with `refresh`, network facts
 * that differ are replaced too. What people add by hand — static devices, static ranges,
 * notes — is always kept, and VLANs only in the Portal are never deleted.
 * @returns {{ vlans, added: string[], updated: string[] }}
 */
export function mergeVlans(existing, incoming, { refresh = true } = {}) {
  const out = list(existing).map(v => ({ ...v }));
  const added = [];
  const updated = [];
  for (const inc of list(incoming)) {
    let i = out.findIndex(v => inc.external_id && v.external_id === inc.external_id);
    if (i < 0 && inc.vlan_id) i = out.findIndex(v => !v.external_id && str(v.vlan_id) === inc.vlan_id);
    const label = `VLAN ${inc.vlan_id || '—'} ${inc.name}`.trim();
    if (i < 0) {
      out.push({ id: randomUUID(), ...inc, static_ranges: '', static_devices: [] });
      added.push(label);
      continue;
    }
    const cur = out[i];
    const next = { ...cur, source: 'unifi', external_id: inc.external_id };
    for (const k of VLAN_SYNCED) {
      if (k === 'client_isolation') { if (refresh || cur[k] == null) next[k] = inc[k]; }
      else if (str(inc[k]) && (refresh || !str(cur[k]))) next[k] = inc[k];   // a blank from UniFi never erases
    }
    if (!str(cur.notes) && inc.notes) next.notes = inc.notes;
    if (VLAN_SYNCED.some(k => str(cur[k]) !== str(next[k])) || next.notes !== cur.notes) updated.push(label);
    out[i] = next;
  }
  return { vlans: out, added, updated };
}

export const vlansText = (vlans) => list(vlans).map(v => `VLAN ${v.vlan_id || '—'} ${str(v.name)}${v.ip_group ? ` ${v.ip_group}` : ''}`.trim()).join(', ');

// ─── Firewall rules ───────────────────────────────────────────────────────────

const ACTION = { ALLOW: 'Allow', BLOCK: 'Block', REJECT: 'Reject', accept: 'Allow', drop: 'Block', reject: 'Reject' };

function portsText(pf) {
  if (!pf) return '';
  if (pf.type === 'TRAFFIC_MATCHING_LIST') return 'ports from a list';
  const ports = list(pf.items).map(p => (p.type === 'PORT_RANGE' || p.start != null ? `${p.start}-${p.stop}` : str(p.value))).filter(Boolean);
  return ports.length ? `${pf.matchOpposite ? 'not ' : ''}port${ports.length > 1 ? 's' : ''} ${ports.join(', ')}` : '';
}

function filterText(tf, netName) {
  if (!tf) return '';
  const not = (f) => (f?.matchOpposite ? 'not ' : '');
  let what = '';
  switch (tf.type) {
    case 'NETWORK':
      what = not(tf.networkFilter) + list(tf.networkFilter?.networkIds).map(netName).join(', ');
      break;
    case 'IP_ADDRESS': {
      const f = tf.ipAddressFilter;
      what = f?.type === 'TRAFFIC_MATCHING_LIST' ? 'an IP list'
        : not(f) + list(f?.items).map(i => (i.start ? `${i.start}-${i.stop}` : str(i.value))).filter(Boolean).join(', ');
      break;
    }
    case 'MAC_ADDRESS': what = not(tf.macAddressFilter) + list(tf.macAddressFilter?.macAddresses).join(', '); break;
    case 'DOMAIN': what = list(tf.domainFilter?.domains).join(', '); break;
    case 'REGION': what = `regions ${list(tf.regionFilter?.regions).join(', ')}`; break;
    case 'APPLICATION': what = `${list(tf.applicationFilter?.applicationIds).length || 'some'} app(s)`; break;
    case 'APPLICATION_CATEGORY': what = 'app categories'; break;
    case 'VPN_SERVER': case 'SITE_TO_SITE_VPN_TUNNEL': what = 'VPN'; break;
    case 'PORT': break;
    default: what = norm(tf.type).replace(/_/g, ' ');
  }
  return [what, portsText(tf.portFilter)].filter(Boolean).join(', ');
}

const protoText = (scope) => {
  const m = JSON.stringify(scope?.protocolFilter ?? '').match(/TCP_UDP|TCP|UDP|ICMPV6|ICMP/);
  return m ? ` · ${m[0].replace('_', '/')}` : '';
};

/**
 * Firewall rules in plain English, the way the Portal stores them ([{ number, text }]).
 * Only rules people created: zone policies marked USER_DEFINED (UniFi's own defaults and
 * the auto-made "(Return)" rules are left out), rules from the pre-zone firewall, and
 * port forwards. Each carries source 'unifi' + its UniFi ID.
 */
export function rulesFrom({ policies = [], zones = [], networks = [], legacy = [], forwards = [] } = {}) {
  const zoneName = (id) => str(list(zones).find(z => z.id === id)?.name) || 'zone';
  const netName = (id) => str(list(networks).find(n => n.id === id)?.name) || 'network';
  const side = (s) => {
    const f = filterText(s?.trafficFilter, netName);
    return f ? `${zoneName(s?.zoneId)} (${f})` : zoneName(s?.zoneId);
  };
  const off = (enabled) => (enabled === false ? ' (disabled)' : '');
  const out = [];

  for (const p of list(policies).filter(p => p?.metadata?.origin === 'USER_DEFINED').sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const action = ACTION[p.action?.type] ?? str(p.action?.type);
    out.push({ text: `${str(p.name)}: ${action} ${side(p.source)} → ${side(p.destination)}${protoText(p.ipProtocolScope)}${off(p.enabled)}`, external_id: str(p.id) });
  }
  for (const r of list(legacy).slice().sort((a, b) => (a.rule_index ?? 0) - (b.rule_index ?? 0))) {
    const src = [r.src_address, r.src_networkconf_id && netName(r.src_networkconf_id), r.src_firewallgroup_ids?.length && 'a group'].filter(Boolean).join(' ') || 'any';
    const dst = [r.dst_address, r.dst_networkconf_id && netName(r.dst_networkconf_id), r.dst_firewallgroup_ids?.length && 'a group'].filter(Boolean).join(' ') || 'any';
    const proto = r.protocol && r.protocol !== 'all' ? ` · ${String(r.protocol).toUpperCase()}` : '';
    const port = r.dst_port ? ` port ${r.dst_port}` : '';
    out.push({ text: `${str(r.name)}: ${ACTION[r.action] ?? str(r.action)} ${str(r.ruleset)} ${src} → ${dst}${port}${proto}${off(r.enabled)}`, external_id: str(r._id) });
  }
  for (const f of list(forwards)) {
    const from = f.src && f.src !== 'any' ? ` (from ${f.src})` : '';
    const proto = str(f.proto || 'tcp_udp').replace('_', '/').toUpperCase();
    out.push({ text: `Port forward ${str(f.name)}: WAN ${proto} ${str(f.dst_port)} → ${str(f.fwd)}:${str(f.fwd_port || f.dst_port)}${from}${off(f.enabled)}`, external_id: str(f._id) });
  }
  return out.map((r, i) => ({ number: String(i + 1), text: r.text.replace(/\s+/g, ' ').trim(), source: 'unifi', external_id: r.external_id }));
}

/**
 * Imported rules replace the previous import's rules; rules typed by hand (no
 * source) are kept, after the imported ones. (The "replace" form, used with take_newer.)
 */
export function mergeRules(existing, incoming) {
  const hand = list(existing).filter(r => r?.source !== 'unifi');
  return [...list(incoming), ...hand];
}

/** The additive form: every rule on file stays; rules UniFi has that aren't there yet are added. */
export function addRules(existing, incoming) {
  const have = list(existing);
  const known = (r) => have.some(h => (r.external_id && h.external_id === r.external_id) || compact(h.text) === compact(r.text));
  return [...have, ...list(incoming).filter(r => !known(r))];
}

export const rulesText = (rules) => list(rules).map(r => r.text).join('\n');

// ─── Merge: device ────────────────────────────────────────────────────────────
//
// The same rules as ConnectWise (lib/sync-merge.js), so the two never fight:
//   FILL     — written only when the Portal field is blank.
//   REPORTED — facts the gear reports about itself (IP, firmware, WAN…): filled when blank;
//              a different value is kept and listed, and only replaced with take_newer.
//   MAC      — added, never replaced: a new address fills a blank mac_address or joins
//              other_macs (a laptop has one for its port and one for Wi-Fi).
//   IP       — only compared when UniFi saw the device's own main MAC; an IP seen on the
//              other card (Wi-Fi vs the port) is just as right, so it's not a difference.
//   NOTES    — a line is added when the notes don't already say it.
//   LISTS    — VLANs, IPs, firewall rules and VPNs: new entries are added; refreshing or
//              removing what's there is a take_newer change.
export const FILL_ONLY = ['label', 'computer_name', 'manufacturer', 'model', 'serial_number', 'driver_url', 'port_count', 'managed_switch'];
export const REPORTED = ['ip_address', 'ip_assignment', 'firmware_version', 'wan_subnet_mask', 'wan_gateway', 'wan_dns'];

const emptyValue = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const textOf = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : str(v));
const same = (a, b) => compact(a) === compact(b);
const json = (v) => JSON.stringify(list(v));
// Same entries, in any order (an additive import appends; a refresh puts UniFi's first).
const sameSet = (a, b) => JSON.stringify(list(a).map(x => JSON.stringify(x)).sort()) === JSON.stringify(list(b).map(x => JSON.stringify(x)).sort());
const union =(a, b) => [...list(a), ...list(b).filter(x => !list(a).some(y => compact(y) === compact(x)))];

/**
 * What an import would do to an existing device.
 * @returns {{ updates, changes, newer, differs }} — see lib/sync-merge.js
 */
export function planDevice(device, fields) {
  const p = planner();
  // The address UniFi reports for this device's own main MAC (null = nothing comparable).
  const seen = addressFor(device, fields.addresses ?? [{ mac: fields.mac_address, ip: fields.ip_address, ip_assignment: fields.ip_assignment }]);
  for (const field of [...FILL_ONLY, ...REPORTED]) {
    const to = fields[field];
    if (emptyValue(to)) continue;                 // a blank from UniFi never erases
    const from = device?.[field];
    if (emptyValue(from)) { p.apply(field, to, null, textOf(to)); continue; }
    if (!REPORTED.includes(field)) continue;
    const reported = field === 'ip_address' ? seen?.ip : field === 'ip_assignment' ? seen?.ip_assignment : to;
    if (!emptyValue(reported) && !same(from, reported)) p.differ(field, reported, textOf(from), textOf(reported));
  }
  const macs = addMacs(device, [{ mac: fields.mac_address, note: fields.mac_note ?? '' }, ...list(fields.other_macs)]);
  if (macs.mac_address) p.apply('mac_address', macs.mac_address, null, macs.mac_address);
  if (macs.other_macs) {
    const added = macs.added.filter(a => !macs.mac_address || !a.startsWith(macs.mac_address));
    p.apply('other_macs', macs.other_macs, null, added.join(', '), 'add');
  }
  const line = str(fields.note_line);
  if (line && !notesSay(device?.notes, fields.note_key || line)) {
    const was = str(device?.notes);
    p.apply('notes', was ? `${was}\n${line}` : line, null, `"${line}"`, 'add');
  }
  // IP lists: new addresses are added. Old ones stay (one typed by hand is as likely as a stale one).
  for (const field of ['internal_ips', 'external_ips']) {
    if (!list(fields[field]).length) continue;
    const was = list(device?.[field]);
    const merged = union(was, fields[field]);
    if (json(merged) !== json(was)) p.apply(field, merged, null, textOf(merged.slice(was.length)), 'add');
  }
  if (list(fields.vlans).length) {
    const additive = mergeVlans(device?.vlans, fields.vlans, { refresh: false });
    if (additive.added.length || additive.updated.length) {
      const to = [additive.added.join(', '), additive.updated.length && `fill in ${additive.updated.join(', ')}`].filter(Boolean).join('; ');
      p.apply('vlans', additive.vlans, null, to, 'add');
    }
    // Refreshing from the additive result, so VLANs just added keep the same IDs.
    const refreshed = mergeVlans(additive.vlans, fields.vlans, { refresh: true });
    if (refreshed.updated.length) p.differ('vlans', refreshed.vlans, vlansText(additive.vlans), `refresh ${refreshed.updated.join(', ')}`);
  }
  if (list(fields.vpns).length) {
    const was = list(device?.vpns);
    const known = (v) => was.some(w => w.source === 'unifi' && w.external_id === v.external_id);
    const additive = [...was, ...list(fields.vpns).filter(v => !known(v))];
    if (json(additive) !== json(was)) p.apply('vpns', additive, null, vpnsText(additive.slice(was.length)), 'add');
    const refreshed = mergeVpns(additive, fields.vpns);
    if (!sameSet(refreshed, additive)) p.differ('vpns', refreshed, vpnsText(additive), vpnsText(refreshed));
  }
  if (fields.firewall_rules) {
    const was = list(device?.firewall_rules);
    const additive = addRules(was, fields.firewall_rules);
    if (additive.length > was.length) p.apply('firewall_rules', additive, null, rulesText(additive.slice(was.length)), 'add');
    // Replacing the earlier import's rules (UniFi changed or removed one) is a take_newer change.
    const replaced = mergeRules(was, fields.firewall_rules);
    if (!sameSet(replaced.map(r => r.text), additive.map(r => r.text))) p.differ('firewall_rules', replaced, rulesText(additive), rulesText(replaced));
  }
  return p.result();
}

// Do the device's notes already mention this (case-insensitive)?
const notesSay = (notes, text) => norm(notes).includes(norm(text));

// "ZION-SEC2.local" → "zion-sec2": a hostname without its domain, for comparing with the
// computer name ConnectWise or a tech wrote down. IP addresses and anything with a space
// (a label like "Printer v2.1 front") are left alone.
export const shortName = (v) => {
  const n = norm(v);
  return /^\d+(\.\d+){3}$/.test(n) || /\s/.test(n) ? n : n.split('.')[0];
};

/**
 * The Portal device a UniFi device or client already is: an earlier import's link, then
 * any of its MACs (against every MAC the device is known by — ConnectWise may have
 * recorded the wired one while UniFi sees Wi-Fi), then serial (UniFi serial = MAC), then
 * name / hostname against the label or computer name. A name two devices share is never
 * guessed.
 * @param dev { key, mac, macs?: [{ mac }], name, names?: string[] } — names: real names only
 *            (an alias or hostname), never a made-up "Aiphone · 00:0B:…" label
 */
export function findDeviceMatch(dev, devices, claimed = new Set()) {
  const pool = list(devices).filter(d => !claimed.has(d.id));
  const one = (hits, reason) => (hits.length === 1 ? { device: hits[0], reason } : null);
  const keys = [...new Set([dev.key, macKey(dev.mac), ...list(dev.macs).map(m => macKey(m?.mac ?? m))].filter(Boolean))];
  const linked = pool.find(d => d.unifi_device_id && keys.includes(d.unifi_device_id));
  if (linked) return { device: linked, reason: 'previous import' };
  if (keys.length) {
    const r = one(pool.filter(d => { const known = deviceMacKeys(d); return keys.some(k => known.has(k)); }), 'MAC address')
      ?? one(pool.filter(d => keys.some(k => compact(d.serial_number) === k.toLowerCase() || compact(d.service_tag) === k.toLowerCase())), 'serial number');
    if (r) return r;
  }
  const names = [...new Set(list(dev.names ?? [dev.name]).map(shortName).filter(Boolean))];
  if (names.length) {
    const hits = pool.filter(d => names.includes(shortName(d.label)) || names.includes(shortName(d.computer_name)));
    if (hits.length === 1) return { device: hits[0], reason: 'name' };
    if (hits.length > 1) return { device: null, ambiguous: hits };
  }
  return { device: null };
}

// ─── Cameras ──────────────────────────────────────────────────────────────────

const UBIQUITI_CAMERA = /^(G\d|AI\b|UVC|Doorbell|Flex|Instant|Dome|Bullet|Turret|PTZ|Theta|Pro\b|Ultra|Mini)/i;
const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function cameraTypeFrom(model) {
  const m = str(model);
  if (/turret/i.test(m)) return 'Turret';
  if (/bullet/i.test(m)) return 'Bullet';
  if (/dome/i.test(m)) return 'Dome';
  if (/\bptz\b/i.test(m)) return 'PTZ';
  if (/fisheye|360|theta/i.test(m)) return 'Fisheye';
  return '';
}

/** A Protect camera → customer_cameras columns. Third-party (ONVIF) cameras keep their own make. */
export function cameraFields(dev) {
  const model = str(dev.model);
  const words = model.split(/\s+/);
  let manufacturer = 'Ubiquiti';
  let m = model;
  if (/^onvif$/i.test(words[0])) { manufacturer = ''; m = words.slice(1).join(' ') || model; }
  else if (!UBIQUITI_CAMERA.test(model) && words.length > 1 && /^[A-Za-z]{3,}$/.test(words[0])) {
    manufacturer = titleCase(words[0]);
    m = words.slice(1).join(' ');
  }
  return {
    name: dev.name,
    ip_address: dev.ip,
    mac_address: dev.mac,
    manufacturer,
    model: m,
    serial_number: manufacturer === 'Ubiquiti' ? dev.serial : '',
    camera_type: cameraTypeFrom(model),
    firmware: dev.firmware,
  };
}

export const CAMERA_FILL = ['name', 'manufacturer', 'model', 'serial_number', 'camera_type'];
export const CAMERA_UPDATE = ['ip_address', 'mac_address', 'firmware'];

export function planCamera(cam, fields) {
  const p = planner();
  for (const field of [...CAMERA_FILL, ...CAMERA_UPDATE]) {
    const to = str(fields[field]);
    if (!to) continue;
    const from = str(cam?.[field]);
    if (!from) p.apply(field, to, null, to);
    else if (CAMERA_UPDATE.includes(field) && (field === 'mac_address' ? macKey(from) !== macKey(to) : !same(from, to))) p.differ(field, to, from, to);
  }
  return p.result();
}

export function findCameraMatch(dev, cameras, claimed = new Set()) {
  const pool = list(cameras).filter(c => !claimed.has(c.id));
  const linked = pool.find(c => c.unifi_device_id && c.unifi_device_id === dev.key);
  if (linked) return { camera: linked, reason: 'previous import' };
  const mac = macKey(dev.mac);
  if (mac) {
    const hits = pool.filter(c => macKey(c.mac_address) === mac || compact(c.serial_number) === compact(mac));
    if (hits.length === 1) return { camera: hits[0], reason: 'MAC address' };
  }
  const name = norm(dev.name);
  if (name) {
    const hits = pool.filter(c => norm(c.name) === name);
    if (hits.length === 1) return { camera: hits[0], reason: 'name' };
    if (hits.length > 1) return { camera: null, ambiguous: hits };
  }
  return { camera: null };
}

/** The Protect console → customer_camera_systems columns. */
export function systemFields(host, consoleDevice) {
  return {
    label: host.name,
    system_type: 'NVR',
    model: host.model || consoleDevice?.model || '',
    serial_number: host.mac,
    ip_address: consoleDevice?.ip && !isPublicIpv4(consoleDevice.ip) ? consoleDevice.ip : '',
  };
}

export const SYSTEM_FILL = ['label', 'system_type', 'model', 'serial_number'];
export const SYSTEM_UPDATE = ['ip_address'];

export function planSystem(system, fields) {
  const p = planner();
  for (const field of [...SYSTEM_FILL, ...SYSTEM_UPDATE]) {
    const to = str(fields[field]);
    if (!to) continue;
    const from = str(system?.[field]);
    if (!from) p.apply(field, to, null, to);
    else if (SYSTEM_UPDATE.includes(field) && !same(from, to)) p.differ(field, to, from, to);
  }
  return p.result();
}

/** The camera system a Protect console already is: linked, then its serial (MAC). */
export function findSystemMatch(host, systems) {
  const linked = list(systems).find(s => s.unifi_host_id && s.unifi_host_id === host.id);
  if (linked) return { system: linked, reason: 'previous import' };
  const hits = list(systems).filter(s => host.mac && compact(s.serial_number) === compact(host.mac));
  if (hits.length === 1) return { system: hits[0], reason: 'serial number' };
  return { system: null };
}

// ─── WiFi → Credentials ───────────────────────────────────────────────────────
//
// Each SSID becomes an entry in the customer's Credentials tab ("WiFi" section) with
// its password. These functions never see a stored password: matching works on the
// SSID / link, and whether a stored password differs is decided by the route (which
// decrypts to compare) and passed in.

export const WIFI_SECTION = 'WiFi';

function securityText(w) {
  if (w.security === 'open') return 'Open — no password';
  if (w.security === 'wpaeap') return 'WPA Enterprise (RADIUS logins)';
  if (w.security === 'wpapsk') return w.wpa_mode === 'wpa3' ? 'WPA3 Personal' : w.wpa3 ? 'WPA2/WPA3 Personal' : 'WPA2 Personal';
  return str(w.security);
}

/**
 * One UniFi WLAN (from wifiWithPasswords) → a credential.
 * @param networkconf classic networkconf rows — names the network (VLAN) the SSID rides on
 * @returns {{ key, label, password, notes, security, ppsk: [{ label, value }] }}
 */
export function wifiCredential(w, networkconf = []) {
  const netName = (id) => {
    const n = list(networkconf).find(x => x._id === id);
    return n ? `${n.vlan ? `VLAN ${n.vlan} · ` : ''}${str(n.name)}` : '';
  };
  const net = netName(w.networkconf_id);
  return {
    key: str(w.external_id) || str(w.id),
    label: str(w.name),
    password: w.security === 'open' ? '' : str(w.passphrase),
    security: securityText(w),
    notes: [
      securityText(w),
      net && `Network: ${net}`,
      w.is_guest && 'Guest network',
      w.hidden && 'Hidden SSID',
      w.enabled === false && 'Turned off in UniFi',
    ].filter(Boolean).join(' · '),
    // Private pre-shared keys (one password per VLAN on the same SSID) → secret custom fields.
    ppsk: list(w.ppsk).filter(k => str(k.password)).map(k => ({ label: `Private key${netName(k.networkconf_id) ? ` (${netName(k.networkconf_id)})` : ''}`, value: str(k.password) })),
  };
}

/** The credential an SSID already is: linked by an earlier import, else the same label (unique). */
export function findWifiMatch(wifi, credentials, claimed = new Set()) {
  const pool = list(credentials).filter(c => !claimed.has(c.id));
  const linked = pool.find(c => c.unifi_wifi_id && c.unifi_wifi_id === wifi.key);
  if (linked) return { credential: linked, reason: 'previous import' };
  const name = norm(wifi.label);
  if (!name) return { credential: null };
  const hits = pool.filter(c => norm(c.label) === name);
  if (hits.length === 1) return { credential: hits[0], reason: 'SSID name' };
  if (hits.length > 1) return { credential: null, ambiguous: hits };
  return { credential: null };
}

/**
 * What an import would change on an existing WiFi credential. The label and notes are
 * people's to edit, so they're only filled when blank; the password follows UniFi
 * (it's the live value). Change text never contains a password.
 * @param passwordMatches true when the stored password equals UniFi's (decided by the caller)
 * @returns {{ updates: { password?, label?, extra_notes? }, changes: [{ field, from, to, mode }] }}
 */
export function planWifi(cred, wifi, { passwordMatches }) {
  const p = planner();
  if (!str(cred?.label) && wifi.label) p.apply('label', wifi.label, null, wifi.label);
  if (wifi.password) {
    if (!cred?.has_password) p.apply('password', wifi.password, null, 'password from UniFi (stored encrypted)');
    // A changed password is kept until asked — the stored one may be the one that works.
    else if (!passwordMatches) p.differ('password', wifi.password, 'the stored password', 'the current password in UniFi (stored encrypted)');
  }
  if (!str(cred?.extra_notes) && wifi.notes) p.apply('extra_notes', wifi.notes, null, wifi.notes);
  return p.result();
}

// ─── Clients (devices plugged into / on the WiFi of a UniFi network) ──────────
//
// From the classic API: stat/sta (who is connected now) and rest/user (every client the
// network has known, incl. offline ones with a reserved address). Each record carries a
// hostname, an alias someone typed in UniFi (name), the MAC vendor (oui), UniFi's own
// fingerprint category (dev_cat) and, for a DHCP reservation, use_fixedip + fixed_ip.

const ipToInt = (ip) => {
  const p = str(ip).split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
};

/**
 * How a client's address is assigned, judged against the network it sits on:
 *   reservation — UniFi hands it a fixed address over DHCP ("Fixed IP")
 *   dhcp        — inside the network's DHCP range, so it can change
 *   static      — outside the DHCP range (or DHCP is off), so it's set on the device itself
 * null when the address isn't on any network the gateway serves (can't tell).
 * @param networks Network-integration network details (ipv4Configuration.hostIpAddress/prefixLength/dhcpConfiguration)
 */
export function ipAssignment(ip, { fixed = false } = {}, networks = []) {
  if (fixed) return 'reservation';
  const addr = ipToInt(ip);
  if (addr == null) return null;
  for (const n of list(networks)) {
    const v4 = n.ipv4Configuration ?? {};
    const host = ipToInt(v4.hostIpAddress);
    const prefix = Number(v4.prefixLength);
    if (host == null || !Number.isInteger(prefix)) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((addr & mask) >>> 0) !== ((host & mask) >>> 0)) continue;
    const dhcp = v4.dhcpConfiguration ?? {};
    const start = ipToInt(dhcp.ipAddressRange?.start);
    const stop = ipToInt(dhcp.ipAddressRange?.stop);
    if (dhcp.mode === 'SERVER' && start != null && stop != null) return addr >= start && addr <= stop ? 'dhcp' : 'static';
    if (dhcp.mode === 'RELAY') return 'dhcp';
    return 'static';
  }
  return null;
}

export const IP_ASSIGNMENT_LABEL = { dhcp: 'DHCP', reservation: 'DHCP reservation', static: 'Static' };

// UniFi fingerprint categories (dev_cat) as seen on live consoles. Not an official
// list — only used when the hostname / vendor don't already say what something is.
const DEV_CAT = { 1: 'computer', 56: 'computer', 11: 'printer', 31: 'printer', 3: 'voip', 44: 'mobile', 45: 'mobile', 6: 'mobile',
  2: 'tv', 24: 'tv', 37: 'tv', 47: 'tv', 61: 'tv', 51: 'camera', 130: 'iot' };

// MAC vendors that say what a device is (checked against the oui text).
const VENDOR_KIND = [
  [/^(canon|brother|kyocera|ricoh|xerox|lexmark|seiko epson|epson|konica|zebra|oki ?data|sharp|toshiba tec|kcodes)/i, 'printer'],
  [/^(synology|qnap|buffalo|western digital|asustor|terramaster)/i, 'nas'],
  [/^(sanyo denki|american power conversion|schneider electric|eaton|cyberpower|tripp ?lite|vertiv|liebert)/i, 'power'],
  [/^(cisco|aruba|hewlett packard enterprise|netgear|tp-link|d-link|zyxel|mikrotik|fortinet|sonicwall|juniper|ruckus|extreme networks|meraki|engenius|cambium)/i, 'network'],
  [/^(hangzhou hikvision|hikvision|zhejiang dahua|dahua|axis communications|hanwha|ring llc|wyze)/i, 'camera'],
  [/^(vizio|roku|grandbeing|sonos|amazon technologies|lg electronics|tcl|hisense|arris|thomson|technicolor)/i, 'tv'],
  [/^toast/i, 'mobile'],
];
// Virtual machines (KVM/QEMU, Hyper-V, VMware, VirtualBox) — usually servers.
const VM_MAC = /^(525400|00155D|005056|000C29|080027)/;

const CLIENT_GROUP = {
  printer: 'Printers & scanners', server: 'Servers & storage', nas: 'Servers & storage', network: 'Network gear',
  power: 'Power & management', computer: 'Computers', voip: 'Phones', unknown: 'Unrecognized',
  mobile: 'Phones & tablets', tv: 'TVs & media', camera: 'Cameras', iot: 'Smart devices', unifi: 'UniFi gear',
};
const CLIENT_TYPE = { printer: 'printer', server: 'server', nas: 'nas', network: 'network', power: 'other', computer: 'workstation', voip: 'other', unknown: 'other' };

/**
 * What a client is, and whether it's worth documenting.
 *   kind: printer · server · nas · network · power (UPS / out-of-band) · computer · voip ·
 *         mobile · tv · camera · iot · unifi · unknown
 *   group: the heading it's listed under
 *   hidden: bloat (phones, TVs, smart gadgets, cameras — Protect cameras come through the
 *           camera import — and UniFi's own gear), not offered unless asked for
 *   important: pre-ticked when new (printers, servers, NAS, network gear, UPS / out-of-band)
 */
export function classifyClient(c) {
  const host = str(c?.hostname);
  const label = `${str(c?.name)} ${host}`;
  const vendor = str(c?.oui);
  const text = norm(`${label} ${vendor}`);
  let kind = null;
  if (/^(uvc-|ufp-|uap-|usw-|unvr|uck|unifi-)/i.test(host) || /^ubiquiti/i.test(vendor)) kind = 'unifi';
  else if (/\b(iphone|ipad|ipod|galaxy|android|moto[-\s]?g|pixel|apple-?watch|watch|sm-[a-z]\d{3,})/i.test(label)) kind = 'mobile';
  else if (/(webos|lgwebostv|directv|roku|fire-?tv|chromecast|apple-?tv|bravia|vizio|shield|xbox|playstation|nintendo|sonos|alexa|\btv\b)/i.test(label)) kind = 'tv';
  else if (/(network-video-recorder|\bnvr\b|\bdvr\b|camera|\bcam\b|doorbell|\bring\b|ringspotlight|hikvision|dahua|axis|reolink|wyze|amcrest|lorex)/i.test(text)) kind = 'camera';
  else if (/(yealink|polycom|wildix|grandstream|sip-t\d|vvx|mitel|obihai|cisco-?ip-?phone|snom|fanvil)/i.test(text)) kind = 'voip';
  // Anything on a cameras / CCTV network is a camera (Protect cameras show up as plain clients there).
  else if (/(camera|cctv|surveillance|\bnvr\b|protect)/i.test(str(c?.last_connection_network_name || c?.network))) kind = 'camera';
  // A client with no hostname is often only known by its MAC vendor — usually enough.
  const byVendor = VENDOR_KIND.find(([re]) => re.test(vendor))?.[1]
    ?? (VM_MAC.test(macKey(c?.mac)) ? 'server' : null)
    ?? (!host && /^(hewlett|hp inc)/i.test(vendor) ? 'printer' : null);
  if (!kind && byVendor && !host) kind = byVendor;
  if (!kind) {
    const brand = brandType({ manufacturer: vendor, model: '', name: label });
    if (brand === 'printer' || brand === 'nas') kind = brand;
    else if (brand === 'switch' || brand === 'firewall') kind = 'network';
    else if (brand === 'other' && /\b(ups|apc|eaton|cyberpower|tripp|idrac|ilo|ipmi|pdu)\b/i.test(text)) kind = 'power';
    else if (brand === 'other') kind = 'tv';
    else if (/(^|[-_\s])(srv|server|dc\d*|hv\d*|hyperv|esxi|vmhost)([-_\s\d]|$)/i.test(host)) kind = 'server';
    else if (byVendor) kind = byVendor;
    else if (DEV_CAT[c?.dev_cat]) kind = DEV_CAT[c.dev_cat];
    else if (brand === 'network') kind = 'network';
    else if (/(intel|dell|lenovo|hewlett|hp inc|asustek|micro-star|gigabyte|microsoft|framework)/i.test(vendor) && host) kind = 'computer';
    else kind = 'unknown';
  }
  return {
    kind,
    group: CLIENT_GROUP[kind],
    portal_type: CLIENT_TYPE[kind] ?? null,               // null = never a Devices-tab record
    hidden: ['mobile', 'tv', 'camera', 'iot', 'unifi'].includes(kind),
    important: ['printer', 'server', 'nas', 'network', 'power'].includes(kind),
  };
}

/**
 * One client record (stat/sta or rest/user) → what the import works with.
 * @param networks Network-integration network details, for the DHCP / static check
 */
export function clientOf(c, networks = [], { online = false } = {}) {
  const fixed = Boolean(c?.use_fixedip && c?.fixed_ip);
  const ip = str(c?.ip) || (fixed ? str(c.fixed_ip) : '') || str(c?.last_ip);
  const maker = cleanManufacturer(c?.oui);
  return {
    key: macKey(c?.mac),
    // No alias or hostname → the maker and MAC, so "Aiphone · 00:0B:AA:2E:58:D9" says what it is.
    name: str(c?.name) || str(c?.hostname) || [maker, formatMac(c?.mac)].filter(Boolean).join(' · ') || 'Client',
    names: [str(c?.name), str(c?.hostname)].filter(Boolean),
    hostname: str(c?.hostname),
    vendor: str(c?.oui),
    ip,
    mac: formatMac(c?.mac),
    wired: c?.is_wired == null ? null : Boolean(c.is_wired),
    network: str(c?.last_connection_network_name || c?.network),
    online,
    last_seen: c?.last_seen ? new Date(Number(c.last_seen) * 1000).toISOString() : null,
    ip_assignment: ipAssignment(ip, { fixed }, networks),
    ...classifyClient(c),
  };
}

/**
 * Online clients plus offline ones worth knowing about (a reserved address or an alias
 * someone typed), one per MAC — the online record wins.
 */
export function clientsFrom(online, known, networks = []) {
  const out = new Map();
  for (const c of list(online)) { const k = macKey(c?.mac); if (k) out.set(k, clientOf(c, networks, { online: true })); }
  for (const c of list(known)) {
    const k = macKey(c?.mac);
    if (!k || out.has(k) || !(c.use_fixedip || str(c.name) || c.noted)) continue;
    out.set(k, clientOf(c, networks, { online: false }));
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

const macNote = (wired) => (wired == null ? '' : wired ? 'Wired' : 'Wi-Fi');

/**
 * One machine can show up as several clients — a laptop on its network port and on
 * Wi-Fi has two MACs. Clients are folded together when they share a hostname, or when
 * their MACs belong to the same Portal device. The merged client keeps the online (wired
 * first) record's details and lists every MAC in `macs` [{ mac, note, ip, online }].
 * @param devices the customer's Portal devices
 */
export function groupClients(clients, devices = []) {
  const items = list(clients);
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const byHost = new Map();
  items.forEach((c, i) => {
    const h = shortName(c.hostname);
    if (!h) return;
    if (byHost.has(h)) join(i, byHost.get(h)); else byHost.set(h, i);
  });
  for (const d of list(devices)) {
    const known = deviceMacKeys(d);
    if (d.unifi_device_id) known.add(d.unifi_device_id);
    const hits = items.map((c, i) => (known.has(c.key) ? i : -1)).filter(i => i >= 0);
    for (const i of hits.slice(1)) join(i, hits[0]);
  }
  const groups = new Map();
  items.forEach((c, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), c]); });
  const rank = (c) => (c.online ? 0 : 2) + (c.wired === true ? 0 : 1);
  return [...groups.values()].map(members => {
    const sorted = [...members].sort((a, b) => rank(a) - rank(b));
    const primary = sorted[0];
    // The classification of a member that can be imported, when the primary can't.
    const kind = sorted.find(c => c.portal_type) ?? primary;
    return {
      ...primary,
      kind: kind.kind, group: kind.group, portal_type: kind.portal_type, hidden: kind.hidden, important: kind.important,
      macs: sorted.map(c => ({ mac: c.mac, note: macNote(c.wired), ip: c.ip, ip_assignment: c.ip_assignment, online: c.online })),
      names: [...new Set(sorted.flatMap(c => c.names ?? []))],
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * A client → Devices-tab columns. Computers keep their hostname as the computer name;
 * anything else gets the MAC's maker as its manufacturer and in its notes, so an
 * unrecognised gadget at least says who made it. mac_note / note_line / note_key only
 * steer the merge, as do addresses (clientInsertFields drops them for a new device).
 */
export function clientFields(c) {
  const computer = c.portal_type === 'workstation' || c.portal_type === 'server';
  const macs = list(c.macs).length ? c.macs : [{ mac: c.mac, note: macNote(c.wired) }];
  const maker = cleanManufacturer(c.vendor);
  return {
    device_type: c.portal_type,
    label: c.name,
    computer_name: computer ? c.hostname : '',
    manufacturer: computer ? '' : maker,
    ip_address: c.ip,
    ip_assignment: c.ip_assignment ?? '',
    mac_address: macs[0].mac,
    mac_note: macs[0].note,
    other_macs: macs.slice(1).map(m => ({ mac: m.mac, note: m.note })),
    // Each card's own address, so an IP is only compared with the one on the same card.
    addresses: list(c.macs).length ? c.macs.map(m => ({ mac: m.mac, ip: m.ip, ip_assignment: m.ip_assignment ?? null }))
      : [{ mac: c.mac, ip: c.ip, ip_assignment: c.ip_assignment ?? null }],
    note_line: !computer && c.vendor ? `Manufacturer: ${c.vendor} (from its MAC address)` : '',
    note_key: maker || c.vendor,
  };
}

/** The columns a brand-new device gets from clientFields. */
export function clientInsertFields(fields) {
  const { mac_note, note_line, note_key, addresses, ...cols } = fields;
  return { ...cols, notes: note_line || '' };
}

// ─── VPNs ─────────────────────────────────────────────────────────────────────

const VPN_TYPE = {
  'wireguard-server': 'WireGuard server', 'l2tp-server': 'L2TP server', 'openvpn-server': 'OpenVPN server',
  'ipsec-vpn': 'Site-to-site IPsec', 'openvpn-vpn': 'Site-to-site OpenVPN', 'wireguard-client': 'WireGuard client',
  'openvpn-client': 'OpenVPN client', 'pptp-client': 'PPTP client',
};
const subnetOf = (cidr) => { const [ip, p] = str(cidr).split('/'); return ip && p ? `${networkAddress(ip, p)}/${p}` : str(cidr); };

/**
 * A gateway's VPNs, for the firewall record — the settings, never a key.
 * @param networkconf classic networkconf rows (x_ fields already removed)
 * @param vpnUsers    { [networkconf _id]: [{ name, interface_ip }] } — WireGuard peers
 */
export function vpnsFrom(networkconf, vpnUsers = {}) {
  return list(networkconf).filter(n => /vpn/.test(str(n?.purpose))).map(n => {
    const users = list(vpnUsers[n._id]).map(u => `${str(u.name)}${u.interface_ip ? ` (${u.interface_ip})` : ''}`).filter(Boolean);
    const ipsec = n.vpn_type === 'ipsec-vpn';
    return {
      type: VPN_TYPE[n.vpn_type] ?? str(n.vpn_type || n.purpose),
      name: str(n.name),
      subnet: n.ip_subnet ? subnetOf(n.ip_subnet) : '',
      port: n.local_port ? String(n.local_port) : '',
      peer: str(n.ipsec_peer_ip || n.remote_host || n.openvpn_remote_host),
      local: str(n.ipsec_local_ip),
      remote_subnets: list(n.remote_vpn_subnets).join(', '),
      users: users.join(', '),
      details: ipsec
        ? `IKE${n.ipsec_key_exchange ? ` ${str(n.ipsec_key_exchange)}` : ''} ${str(n.ipsec_ike_encryption)}/${str(n.ipsec_ike_hash)} DH${str(n.ipsec_ike_dh_group)} · ESP ${str(n.ipsec_esp_encryption)}/${str(n.ipsec_esp_hash)}${n.ipsec_pfs ? ' PFS' : ''}`
        : '',
      enabled: n.enabled !== false,
      notes: '',
      source: 'unifi',
      external_id: str(n.external_id || n._id),
    };
  });
}

/** Imported VPNs replace the previous import's (keeping any notes typed on them); hand-entered ones stay. */
export function mergeVpns(existing, incoming) {
  const prev = list(existing);
  const imported = list(incoming).map(v => {
    const was = prev.find(p => p.source === 'unifi' && p.external_id === v.external_id);
    return was?.notes ? { ...v, notes: was.notes } : v;
  });
  return [...imported, ...prev.filter(p => p.source !== 'unifi')];
}

export const vpnsText = (vpns) => list(vpns).map(v => `${v.type}: ${v.name}${v.peer ? ` → ${v.peer}` : ''}${v.users ? ` (users: ${v.users})` : ''}`).join('\n');

/**
 * Site-to-site pre-shared keys → Credentials ("VPN" section), stored encrypted like WiFi.
 * @param secrets [{ external_id, _id, name, vpn_type, ipsec_peer_ip, psk }] — read fresh, never cached
 */
export const VPN_SECTION = 'VPN';
export function vpnCredentials(secrets) {
  return list(secrets).filter(s => str(s.psk)).map(s => ({
    key: str(s.external_id || s._id),
    label: `${str(s.name) || 'Site-to-site VPN'} — pre-shared key`,
    password: str(s.psk),
    security: VPN_TYPE[s.vpn_type] ?? 'VPN',
    notes: [VPN_TYPE[s.vpn_type] ?? 'VPN', s.ipsec_peer_ip && `peer ${s.ipsec_peer_ip}`].filter(Boolean).join(' · '),
    ppsk: [],
    section: VPN_SECTION,
  }));
}
