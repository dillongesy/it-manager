// ConnectWise RMM → Portal device mapping. Pure functions only (no I/O).
//
// ConnectWise publishes the platform API's response schemas only behind a partner
// login, and field names differ between endpoints and API versions (friendlyName vs
// name, os.name vs operatingSystem, …). So every value is read from the first of
// several known names that's present - the same approach other integrations with this
// API take. scripts/connectwise-probe.js prints a real response when a name needs adding.

import { coerceDate } from './dates.js';
import { classifyDevice, TYPE_LABEL } from './device-type.js';
import { addMacs, addressFor, deviceMacKeys } from './device-macs.js';
import { planner } from './sync-merge.js';

export const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const compact = (v) => norm(v).replace(/\s+/g, '');
const str = (v) => (v == null ? '' : String(v).trim());

// Read a dotted path; numeric segments index arrays ("networks.0.ipAddress").
function at(obj, path) {
  return path.split('.').reduce((v, k) => (v != null && typeof v === 'object' ? v[k] : undefined), obj);
}

// First present value among several candidate paths.
export function pick(obj, ...paths) {
  for (const p of paths) {
    const v = at(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// A string from the first present candidate. Arrays of strings are joined; an object
// with a name/value is unwrapped (e.g. os: { name: "Windows 11 Pro" }).
export function text(obj, ...paths) {
  const v = pick(obj, ...paths);
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map(x => (typeof x === 'object' && x ? str(x.name ?? x.value ?? x.address ?? '') : str(x))).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') return str(v.name ?? v.value ?? v.caption ?? '');
  return str(v);
}

// --- Value cleanup ------------------------------------------------------------

const JUNK = /^(to be filled.*|default string|system serial number|system product name|system manufacturer|none|n\/a|not (specified|available|applicable)|chassis serial number|o\.?e\.?m\.?|0+|x+|1234567890?|123456789|unknown)$/i;
const isJunk = (v) => !str(v) || JUNK.test(str(v));

export function cleanSerial(v) {
  const s = str(v);
  return isJunk(s) || s.length < 3 ? '' : s;
}

const MANUFACTURERS = [
  [/^dell/i, 'Dell'], [/^lenovo/i, 'Lenovo'], [/^(hp|hewlett[- ]?packard)\b/i, 'HP'],
  [/^asustek|^asus/i, 'ASUS'], [/^microsoft/i, 'Microsoft'], [/^acer/i, 'Acer'],
  [/^apple/i, 'Apple'], [/^vmware/i, 'VMware'], [/^gigabyte/i, 'Gigabyte'],
  [/^micro-star|^msi\b/i, 'MSI'], [/^intel/i, 'Intel'], [/^supermicro/i, 'Supermicro'],
  [/^samsung/i, 'Samsung'], [/^toshiba|^dynabook/i, 'Dynabook'], [/^qemu/i, 'QEMU'],
  // Printers, network gear and the like (MAC vendors read e.g. "KYOCERA Document Solutions Inc.").
  [/^kyocera/i, 'Kyocera'], [/^brother/i, 'Brother'], [/^canon/i, 'Canon'], [/^ricoh/i, 'Ricoh'], [/^sharp/i, 'Sharp'],
  [/^xerox/i, 'Xerox'], [/^lexmark/i, 'Lexmark'], [/^(seiko )?epson/i, 'Epson'], [/^konica/i, 'Konica Minolta'], [/^zebra/i, 'Zebra'],
  [/^synology/i, 'Synology'], [/^qnap/i, 'QNAP'], [/^buffalo/i, 'Buffalo'], [/^netgear/i, 'Netgear'], [/^cisco/i, 'Cisco'],
  [/^ubiquiti/i, 'Ubiquiti'], [/^tp-?link/i, 'TP-Link'], [/^(hangzhou )?hikvision/i, 'Hikvision'], [/^yealink/i, 'Yealink'],
  [/^american power conversion|^apc\b/i, 'APC'], [/^sanyo denki/i, 'Sanyo Denki'],
];
export function cleanManufacturer(v) {
  const s = str(v);
  if (isJunk(s)) return '';
  for (const [re, name] of MANUFACTURERS) if (re.test(s)) return name;
  return s.replace(/,?\s+(inc\.?|corp(oration)?\.?|co\.?,?\s*ltd\.?|ltd\.?|llc)$/i, '').trim();
}

// "Dell Inc." + "OptiPlex 7090" → "Dell OptiPlex 7090" (matches how techs type it).
export function modelLabel(manufacturer, model) {
  const make = cleanManufacturer(manufacturer);
  const m = isJunk(model) ? '' : str(model);
  if (!m) return '';
  if (!make || norm(m).startsWith(norm(make))) return m;
  return `${make} ${m}`;
}

// "12th Gen Intel(R) Core(TM) i7-12700   CPU @ 2.10GHz" → "12th Gen Intel Core i7-12700"
export function cleanProcessor(v) {
  return str(v)
    .replace(/\((r|tm|c)\)/gi, '')
    .replace(/\bCPU\b/g, '')
    .replace(/@\s*[\d.]+\s*GHz/i, '')
    .replace(/\s+Processor\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Microsoft Windows 11 Pro" → "Windows 11 Pro"
export function cleanOs(v) {
  return str(v).replace(/^Microsoft\s+/i, '').replace(/\s+/g, ' ').trim();
}

// Memory in unknown units → "16GB". The API doesn't document its unit, so it's
// inferred from size: bytes (≥ 64 MB worth), then MB, then GB. A string that already
// carries a unit ("16 GB") is kept, tidied.
export function formatRam(v) {
  if (typeof v === 'string' && /[a-z]/i.test(v)) {
    const m = v.match(/([\d.]+)\s*(tb|gb|mb)/i);
    return m ? `${Math.round(parseFloat(m[1]))}${m[2].toUpperCase()}` : str(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  let gb;
  if (n >= 64 * 1024 * 1024) gb = n / 1024 ** 3;       // bytes
  else if (n >= 256) gb = n / 1024;                     // MB
  else gb = n;                                          // GB
  if (gb < 1) return `${Math.round(gb * 1024)}MB`;
  return `${Math.round(gb)}GB`;
}

export function macKey(v) {
  const hex = str(v).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : '';
}
// "001122AABBCC" / "00-11-22-aa-bb-cc" → "00:11:22:AA:BB:CC". A list yields its first valid address.
export function formatMac(v) {
  const k = str(v).split(/[,;|]/).map(macKey).find(Boolean);
  return k ? k.match(/../g).join(':') : '';
}

// First private-looking IPv4 in a (possibly comma-separated) list, else the first IPv4.
export function firstIpv4(v) {
  const all = str(v).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  const usable = all.filter(ip => !ip.startsWith('127.') && !ip.startsWith('169.254.') && ip !== '0.0.0.0');
  const priv = usable.find(ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return priv ?? usable[0] ?? '';
}

// --- Company / site -----------------------------------------------------------

export const companyOf = (c) => ({
  id:   text(c, 'id', 'companyId', 'clientId', 'companyID'),
  name: text(c, 'name', 'companyName', 'friendlyName', 'clientName'),
});

export const siteOf = (s) => ({
  id:   text(s, 'id', 'siteId', 'siteID'),
  name: text(s, 'name', 'siteName', 'friendlyName') || 'Site',
  city: text(s, 'address.city', 'city'),
});

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
export const sortByName = (list) => [...list].sort(byName);

// --- Endpoint → normalized machine --------------------------------------------

// Where a device fact might live in a list row or a details response. Names confirmed
// on a real tenant: summary { endpointID, deviceName, friendlyName, resourceType,
// endpointType }; v2 details { companyID, siteID, endpointID, platform: { deviceName,
// friendlyName, ipAddress, macAddress, type, subResourceType, … } } (flattened first).
const F = {
  id:        ['endpointID', 'endpointId', 'endpoint_id', 'id', 'deviceID', 'deviceId', 'resourceId', 'agentId'],
  name:      ['friendlyName', 'deviceName', 'name', 'displayName', 'systemName', 'hostName', 'hostname'],
  host:      ['deviceName', 'system.systemName', 'systemName', 'hostName', 'hostname', 'computerName', 'machineName', 'system.hostName',
              'system.hostname', 'system.name', 'name'],
  type:      ['endpointType', 'subResourceType', 'deviceType', 'type', 'classification', 'category', 'deviceClass', 'os.type'],
  // ConnectWise's own classification of a device: Desktop / Server for agents, and for
  // discovered network gear PRINTER, SWITCH, LAYER_3_SWITCH, FIREWALL, NETWORK_STORAGE,
  // AUDIO/VISUAL, … (endpointType is just "NetworkDevice" for all of those).
  category:  ['resourceType', 'network.resourceType', 'platform.resourceType'],
  os:        ['os.name', 'os.product', 'os.caption', 'os.productName', 'operatingSystem.name', 'operatingSystem.caption',
              'operatingSystem', 'osName', 'osProduct', 'os'],
  make:      ['manufacturer', 'system.manufacturer', 'system.product', 'hardware.manufacturer', 'systemManufacturer', 'bios.manufacturer',
              'computerSystem.manufacturer'],
  model:     ['model', 'system.model', 'hardware.model', 'systemModel', 'computerSystem.model'],
  serial:    ['serialNumber', 'system.serialNumber', 'hardware.serialNumber', 'bios.serialNumber', 'serial',
              'systemSerialNumber', 'computerSystem.serialNumber'],
  cpu:       ['_processor', 'processor.name', 'processors.0.name', 'processor', 'cpu.name', 'cpus.0.name', 'cpu', 'hardware.processor',
              'system.processor', 'processorName'],
  ram:       ['_memoryTotalBytes', 'memory.total', 'memory.totalPhysical', 'memory.totalPhysicalMemory', 'totalMemory', 'totalPhysicalMemory',
              'physicalMemory', 'memoryTotal', 'system.totalPhysicalMemory', 'hardware.memory', 'ram', 'memory'],
  ip:        ['_primaryIp', 'localIpAddress', 'privateIpAddress', 'ipAddress', 'ipAddresses', 'network.ipAddress',
              'networks.0.ipAddress', 'networkAdapters.0.ipAddress', 'networkInterfaces.0.ipAddress', 'nics.0.ipAddress'],
  publicIp:  ['remoteAddress', 'publicIpAddress', 'externalIpAddress', 'wanIpAddress'],
  mac:       ['_primaryMac', 'macAddress', 'macAddresses', 'network.macAddress', 'networks.0.macAddress', 'networkAdapters.0.macAddress',
              'networkInterfaces.0.macAddress', 'nics.0.macAddress'],
  user:      ['lastLoggedInUser', 'lastLoggedOnUser', 'loggedInUser', 'loggedOnUser', 'currentUser', 'lastUser', 'userName'],
  domain:    ['domain', 'domainName', 'system.domain', 'workgroup'],
  lastSeen:  ['lastSeen', 'lastContact', 'lastHeartbeat', 'lastCheckIn', 'lastSeenAt', 'lastCommunication'],
  status:    ['availability', 'status', 'onlineStatus', 'connectivity', 'isOnline', 'online'],
  siteId:    ['siteID', 'siteId', 'site.id'],
  companyId: ['companyID', 'companyId', 'clientId', 'clientID', 'company.id'],
};

function onlineFrom(v) {
  if (v === true || v === false) return v;
  const s = norm(v);
  if (!s) return null;
  if (/^(online|up|connected|available|active|true)$/.test(s)) return true;
  if (/^(offline|down|disconnected|unavailable|inactive|false)$/.test(s)) return false;
  return null;
}

// Strip a "DOMAIN\user" prefix - the Portal's "assigned to" is a person, not an account.
const bareUser = (u) => str(u).split('\\').pop();

/**
 * @param raw     an endpoint from the list and/or its details response (details win)
 * @param context { companyId, companyName, siteId, siteName }
 */
export function normalizeEndpoint(raw, context = {}) {
  const e = raw ?? {};
  const host = text(e, ...F.host);
  const make = text(e, ...F.make);
  return {
    endpoint_id:  text(e, ...F.id),
    name:         text(e, ...F.name) || host,
    machine_name: host || text(e, ...F.name),
    company_id:   text(e, ...F.companyId) || str(context.companyId),
    company:      str(context.companyName),
    site_id:      text(e, ...F.siteId) || str(context.siteId),
    site:         str(context.siteName),
    type_hint:    text(e, ...F.type),
    category:     text(e, ...F.category),
    domain:       text(e, ...F.domain),
    os:           cleanOs(text(e, ...F.os)),
    manufacturer: cleanManufacturer(make),
    model:        modelLabel(make, text(e, ...F.model)),
    serial:       cleanSerial(text(e, ...F.serial)),
    processor:    cleanProcessor(text(e, ...F.cpu)),
    ram:          formatRam(pick(e, ...F.ram)),
    private_ip:   firstIpv4(text(e, ...F.ip)),
    public_ip:    firstIpv4(text(e, ...F.publicIp)),
    mac:          formatMac(text(e, ...F.mac)),
    // Every network card's MAC (v1 asset inventory) - only used to recognise a device
    // UniFi or a tech recorded by its other card (Wi-Fi vs the network port).
    macs:         [...new Set([formatMac(text(e, ...F.mac)), ...(Array.isArray(e.networks) ? e.networks.map(n => formatMac(n?.macAddress)) : [])].filter(Boolean))],
    logged_on_user: bareUser(text(e, ...F.user)),
    last_seen:    text(e, ...F.lastSeen) || null,
    online:       onlineFrom(pick(e, ...F.status)),
    drives:       (e._physicalDrives && physicalDrivesFrom(e._physicalDrives).length)
                    ? physicalDrivesFrom(e._physicalDrives) : drivesFrom(e._storages),
    local_accounts: localAccountsFrom(e._users),
    shares:       sharesFrom(e._shares, host || text(e, ...F.name)),
  };
}

// One response object, unwrapped from an envelope and with its category block
// ({ platform: {...} } / network / cloud) lifted to the top level.
export function flatten(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  let o = obj;
  for (const k of ['endpoint', 'device', 'data']) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { o = { ...o, ...o[k] }; }
  }
  for (const k of ['platform', 'network', 'cloud']) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) o = { ...o, ...o[k] };
  }
  return o;
}

/**
 * A device as the client returns it - { summary, v2, v1 } - flattened into one record.
 * Later sources win: the v1 details (hardware) over the summary, and the v2 details
 * (current IP / MAC) over both. A plain object is treated as a summary.
 */
export function flattenDevice(rec) {
  if (!rec || typeof rec !== 'object') return {};
  if (!('summary' in rec) && !('v2' in rec) && !('v1' in rec)) return flatten(rec);
  const v1 = flatten(rec.v1);
  const out = { ...flatten(rec.summary), ...v1, ...flatten(rec.v2) };

  // v1 asset inventory (the best source when present).
  if (rec.v1) {
    const cpus = Array.isArray(v1.processors) ? v1.processors.filter(p => str(p?.product)) : [];
    if (cpus.length) {
      const name = cleanProcessor(cpus[0].product);
      const sockets = cpus.length > 1 ? cpus.length : Number(cpus[0].numberOfProcessors) || 1;
      out._processor = sockets > 1 ? `${sockets} × ${name}` : name;
    }
    const sticks = Array.isArray(v1.physicalMemory) ? v1.physicalMemory : [];
    const installed = sticks.reduce((sum, s) => sum + (Number(s?.sizeBytes) || 0), 0);
    if (installed > 0) out._memoryTotalBytes = installed;          // installed, not "usable"
    if (Array.isArray(v1.drives)) out._physicalDrives = v1.drives;
    const nic = primaryNic(v1.networks);
    if (nic) { out._primaryIp = nic.ipv4; out._primaryMac = nic.macAddress; }
    if (Array.isArray(v1.users)) out._users = v1.users;
    if (Array.isArray(v1.shares)) out._shares = v1.shares;
    if (Array.isArray(v1.antiViruses)) out._antivirus = v1.antiViruses;
  }

  // Usage routes (fallback without the asset inventory): installed RAM and disk layout.
  const mem = Array.isArray(rec.memory) ? rec.memory[0] : rec.memory;
  if (out._memoryTotalBytes == null && mem?.physicalTotalBytes != null) out._memoryTotalBytes = mem.physicalTotalBytes;
  const disk = Array.isArray(rec.disks) ? rec.disks[0] : rec.disks;
  if (Array.isArray(disk?.storages)) out._storages = disk.storages;
  return out;
}

// The network card that actually talks to the LAN: IP enabled, a real IPv4 and a
// default gateway (a Hyper-V / VPN adapter usually has none). Falls back to the first
// enabled card with a usable IPv4.
export function primaryNic(networks) {
  if (!Array.isArray(networks)) return null;
  const usable = networks.filter(n => n?.ipEnabled !== false && firstIpv4(n?.ipv4 ?? n?.ipAddress));
  const withGw = usable.filter(n => {
    const gw = firstIpv4(n.defaultIPGateway ?? (n.defaultIPGateways ?? []).join(','));
    return gw && gw !== '0.0.0.0';
  });
  const nic = withGw[0] ?? usable[0];
  return nic ? { ipv4: firstIpv4(nic.ipv4 ?? nic.ipAddress), macAddress: nic.macAddress ?? '' } : null;
}

// Built-in Windows accounts nobody needs listed (disabled ones are skipped anyway).
const BUILTIN_ACCOUNTS = new Set(['defaultaccount', 'guest', 'wdagutilityaccount', 'defaultuser0']);

/** Enabled, non-built-in local accounts → [{ username, admin }], admins first then A–Z. */
export function localAccountsFrom(users) {
  if (!Array.isArray(users)) return [];
  return users
    .filter(u => str(u?.username) && !u.userDisabled && !BUILTIN_ACCOUNTS.has(norm(u.username)))
    .map(u => ({ username: str(u.username), admin: /admin/i.test(str(u.userType)) }))
    .sort((a, b) => (b.admin - a.admin) || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}
export const accountsText = (accounts) => (accounts ?? []).map(a => a.username + (a.admin ? ' (admin)' : '')).join(', ');

/**
 * Real file shares → the Portal's share_paths [{ path, note }]. Hidden/admin shares
 * (C$, ADMIN$, IPC$, print$ - anything ending in $, or typed Admin/IPC) are skipped.
 * path = the UNC path people type ("\\PC-NAME\Scans"); note = the local folder and who
 * can reach it.
 */
export function sharesFrom(shares, machineName) {
  if (!Array.isArray(shares)) return [];
  return shares
    .filter(s => {
      const name = str(s?.name);
      const types = [].concat(s?.type ?? []).join(' ');
      return name && !name.endsWith('$') && !/admin|ipc/i.test(types);
    })
    .map(s => {
      const access = [].concat(s.userAccess ?? []).map(str).filter(Boolean);
      const note = [str(s.path), access.length ? `access: ${access.join(', ')}` : ''].filter(Boolean).join(' — ');
      return { path: machineName ? `\\\\${machineName}\\${str(s.name)}` : str(s.name), note };
    });
}
export const sharesText = (shares) => (shares ?? []).map(s => s.path).join(', ');

// A physical disk's type as people say it: NVMe SSD / SSD / HDD.
function diskKind(d) {
  const t = `${str(d?.product)} ${str(d?.mediaType)} ${str(d?.interfaceType)}`;
  if (/nvme/i.test(t)) return 'NVMe SSD';
  if (/\bssd\b|solid state/i.test(t)) return 'SSD';
  if (/\bhdd\b|\b\d{4,5}\s?rpm\b/i.test(t)) return 'HDD';
  return '';
}

/**
 * v1 physical disks → storage_drives [{ label, size }]:
 *   { label: "C:", size: "500GB SSD (PNY CS900 500GB SSD)" }
 * USB/removable media are left out; label = the disk's drive letters.
 */
export function physicalDrivesFrom(drives) {
  if (!Array.isArray(drives)) return [];
  return drives
    .filter(d => !/removable|usb/i.test(`${str(d?.mediaType)} ${str(d?.interfaceType)}`))
    .map((d, i) => {
      const letters = (d.partitionData ?? [])
        .map(p => str(p?.name ?? p?.mountPoint).replace(/\\+$/, ''))
        .filter(n => /^[A-Z]:$/i.test(n));
      const product = str(d.product);
      const size = [formatDiskSize(d.sizeBytes), diskKind(d)].filter(Boolean).join(' ');
      return {
        label: letters.length ? [...new Set(letters)].join(' ') : `Disk ${i + 1}`,
        size: size ? (product ? `${size} (${product})` : size) : '',
      };
    })
    .filter(d => d.size);
}

// Disk size the way it's printed on the drive (decimal): 500105249280 → "500GB".
export function formatDiskSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const gb = n / 1e9;
  if (gb >= 1000) return `${Math.round((gb / 1000) * 10) / 10}TB`;
  return `${Math.round(gb)}GB`;
}

/**
 * Physical disks → the Portal's storage_drives [{ label, size }].
 * ConnectWise: { name: "0 C:", metric: { totalSpaceBytes }, partitions: [{ name: "C:" }] }.
 * Label = the disk's drive letters ("C:" / "D: E:"), else its name minus the index.
 */
export function drivesFrom(storages) {
  if (!Array.isArray(storages)) return [];
  return storages
    .map(s => {
      const letters = (s.partitions ?? []).map(p => str(p.name)).filter(n => /^[A-Z]:$/i.test(n));
      const label = letters.length ? letters.join(' ') : str(s.name).replace(/^\d+(\s+|$)/, '') || `Disk ${s.index ?? ''}`.trim();
      return { label, size: formatDiskSize(s.metric?.totalSpaceBytes ?? s.totalSpaceBytes) };
    })
    .filter(d => d.size);
}
export const drivesText = (drives) => (drives ?? []).map(d => [d.label, d.size].filter(Boolean).join(' ')).join(' · ');

// --- Machine → Portal device fields -------------------------------------------

// ConnectWise's own category first, then the agent/OS, then the make / model / name
// (lib/device-type.js) - so an HP LaserJet or an Aruba switch isn't filed as "Network"
// just because ConnectWise calls every discovered device a "NetworkDevice".
export function deviceTypeFor(m) {
  return classifyDevice({
    category: m.category, hint: m.type_hint, os: m.os,
    manufacturer: m.manufacturer, model: m.model, name: [m.name, m.machine_name].filter(Boolean).join(' '),
  });
}

// Columns an import can write. Blanks are never written.
export function deviceFieldsFromMachine(m) {
  const type = deviceTypeFor(m);
  const computer = type === 'workstation' || type === 'server';
  return {
    device_type:      type,
    label:            m.name || m.machine_name,
    computer_name:    computer ? m.machine_name : '',
    model:            m.model,
    service_tag:      computer ? m.serial : '',          // Dell/Lenovo/HP serial = the service tag
    serial_number:    computer ? '' : m.serial,          // network gear keeps a plain serial
    manufacturer:     computer ? '' : m.manufacturer,
    processor:        computer ? m.processor : '',
    ram:              computer ? m.ram : '',
    operating_system: computer ? m.os : '',
    ip_address:       m.private_ip,
    storage_drives:   computer ? (m.drives ?? []) : [],
    share_paths:      computer ? (m.shares ?? []) : [],
    local_accounts:   computer ? (m.local_accounts ?? []) : [],
    mac_address:      m.mac,
    // Dell warranty, looked up by service tag during the import (routes/connectwise.js).
    warranty_expires: computer ? (m.warranty_expires ?? '') : '',
    warranty_coverage: computer ? (m.warranty_coverage ?? '') : '',
    // The last signed-in user is a good first guess at who a workstation belongs to; on
    // a server it's just whoever last RDP'd in, so leave it alone there.
    assigned_to:      type === 'workstation' ? m.logged_on_user : '',
  };
}

// How an import treats a device that already exists in the Portal - the same rules as
// UniFi (lib/sync-merge.js), so the two never fight over a record:
//   FILL     - only written when the Portal field is empty. People curate these by hand
//              ("Reception PC", "Front desk", a nicer model name).
//   REPORTED - facts the machine reports about itself (IP, OS, RAM…): filled when empty;
//              a different value is kept and listed in the preview, and only replaced when
//              the person ticks "Also replace values that changed" (take_newer).
//   MAC      - added, never replaced: a MAC the device isn't known by fills a blank
//              mac_address or joins other_macs.
//   IP       - only compared when ConnectWise's primary card is the device's main MAC; an
//              IP UniFi recorded for the Wi-Fi card is just as right.
//   LISTS    - shares and local accounts are added to; replacing the accounts list with
//              ConnectWise's is a take_newer change.
export const FILL_ONLY = ['label', 'assigned_to', 'model', 'service_tag', 'serial_number', 'manufacturer', 'storage_drives', 'share_paths'];
export const REPORTED = ['computer_name', 'ip_address', 'operating_system', 'processor', 'ram', 'local_accounts'];
// Warranty comes from Dell, which knows better than a hand-typed date (an extension bought
// later moves it), so it's refreshed whenever it differs.
export const FROM_DELL = ['warranty_expires', 'warranty_coverage'];

// A stored DATE comes back from pg as a Date at local midnight; compare it as YYYY-MM-DD.
const DATE_FIELDS = new Set(['warranty_expires']);
const fieldText = (field, v) => {
  if (!DATE_FIELDS.has(field)) return str(v);
  const r = coerceDate(v);
  return r.ok && r.value ? r.value : '';
};

// List-valued (JSONB) fields:
//   storage_drives - filled when the device has none; also replaced when what's there is
//                    only bare sizes ("C: 500GB", what an older import wrote), so the
//                    better "500GB SSD (model)" text lands.
//   share_paths    - shares not on file yet are added (hand-written notes kept).
//   local_accounts - accounts not on file yet are added; dropping ones ConnectWise no
//                    longer lists is a take_newer change.
const LIST_TEXT = { storage_drives: (v) => drivesText(v), share_paths: (v) => sharesText(v), local_accounts: (v) => accountsText(v) };
const LIST_KEY = { share_paths: (x) => compact(x?.path), local_accounts: (x) => compact(x?.username) };
const listOf = (v) => (Array.isArray(v) ? v : []);
const meaningful = (field, list) => listOf(list).filter(x =>
  field === 'storage_drives' ? (x?.label || x?.size) : field === 'share_paths' ? (x?.path || x?.note) : x?.username);
const bareDrives = (list) => list.length > 0 && list.every(d => /^(\d+(\.\d+)?(GB|TB|MB))?$/i.test(str(d?.size)));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => JSON.stringify(listOf(a).map(x => JSON.stringify(x)).sort()) === JSON.stringify(listOf(b).map(x => JSON.stringify(x)).sort());

/**
 * What an import would do to an existing device.
 * @returns {{ updates, changes, newer, differs }} - see lib/sync-merge.js
 */
export function mergePlan(device, fields) {
  const p = planner();
  // Imports before the device-type fix filed printers, switches, TVs… under the catch-all
  // "Network". Re-sort those - but only a device an import created and left as Network;
  // a type someone picked by hand is theirs.
  if (device?.rmm_endpoint_id && device.device_type === 'network' && fields.device_type && fields.device_type !== 'network') {
    p.apply('device_type', fields.device_type, TYPE_LABEL.network, TYPE_LABEL[fields.device_type] ?? fields.device_type);
  }
  // The IP ConnectWise reports for the device's own main MAC (null = nothing comparable).
  const seen = addressFor(device, [{ mac: fields.mac_address, ip: fields.ip_address }]);
  for (const field of [...FILL_ONLY, ...REPORTED, ...FROM_DELL]) {
    if (field in LIST_TEXT) {
      const to = meaningful(field, fields[field]);
      if (!to.length) continue;                     // never blank out what the Portal has
      const have = meaningful(field, device?.[field]);
      const text = LIST_TEXT[field];
      if (!have.length) { p.apply(field, to, null, text(to)); continue; }
      if (field === 'storage_drives') {
        if (!sameList(have, to) && bareDrives(have)) p.apply(field, to, text(have), text(to));
        continue;
      }
      const key = LIST_KEY[field];
      const added = to.filter(x => !have.some(h => key(h) === key(x)));
      const merged = [...have, ...added];
      if (added.length) p.apply(field, merged, null, text(added), 'add');
      if (field === 'local_accounts' && !sameSet(merged, to)) p.differ(field, to, text(merged), text(to));
      continue;
    }
    const to = fieldText(field, fields[field]);
    if (!to) continue;                      // never blank out what the Portal has
    const from = fieldText(field, device?.[field]);
    if (!from) { p.apply(field, to, null, to); continue; }
    if (FROM_DELL.includes(field)) { if (compact(from) !== compact(to)) p.apply(field, to, from, to); continue; }
    if (!REPORTED.includes(field)) continue;
    const reported = field === 'ip_address' ? str(seen?.ip) : to;
    if (reported && compact(from) !== compact(reported)) p.differ(field, reported, from, reported);
  }
  const macs = addMacs(device, [{ mac: fields.mac_address }]);
  if (macs.mac_address) p.apply('mac_address', macs.mac_address, null, macs.mac_address);
  if (macs.other_macs) {
    p.apply('other_macs', macs.other_macs, null, macs.added.join(', '), 'add');
  }
  return p.result();
}

/**
 * Find the Portal device an RMM machine already is.
 * Strongest evidence first: an earlier import's endpoint link, then serial / service
 * tag, then MAC, then computer name or label. A name shared by two devices is never
 * guessed between (reported as ambiguous instead).
 *
 * @param claimed Set of device ids already matched earlier in the same import
 */
export function findMatch(machine, devices, claimed = new Set()) {
  const pool = (devices ?? []).filter(d => !claimed.has(d.id));
  const one = (list, reason) => (list.length === 1 ? { device: list[0], reason } : null);

  if (machine.endpoint_id) {
    const hit = pool.find(d => d.rmm_endpoint_id && d.rmm_endpoint_id === machine.endpoint_id);
    if (hit) return { device: hit, reason: 'previous import' };
  }
  const serial = compact(machine.serial);
  if (serial) {
    const r = one(pool.filter(d => compact(d.service_tag) === serial || compact(d.serial_number) === serial), 'serial / service tag');
    if (r) return r;
  }
  // Any of its network cards against any MAC the device is known by.
  const macs = [...new Set([machine.mac, ...(machine.macs ?? [])].map(macKey).filter(Boolean))];
  if (macs.length) {
    const r = one(pool.filter(d => { const known = deviceMacKeys(d); return macs.some(k => known.has(k)); }), 'MAC address');
    if (r) return r;
  }
  const names = [...new Set([machine.machine_name, machine.name].map(norm).filter(Boolean))];
  if (names.length) {
    const hits = pool.filter(d => names.includes(norm(d.computer_name)) || names.includes(norm(d.label)));
    if (hits.length === 1) return { device: hits[0], reason: 'computer name' };
    if (hits.length > 1) return { device: null, reason: null, ambiguous: hits };
  }
  return { device: null, reason: null };
}
