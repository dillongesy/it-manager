// ConnectWise RMM → Portal device import. The failures this prevents: an import
// overwriting a hand-typed name like "Reception PC", a re-import creating a duplicate
// of a PC that's already on file, junk like "Dell Inc. / Intel(R) Core(TM)… @ 2.10GHz"
// landing in fields techs keep clean, and a response-shape change silently producing
// blank devices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pick, text, normalizeEndpoint, flatten, flattenDevice, formatDiskSize, drivesFrom, companyOf, siteOf, sortByName,
  deviceFieldsFromMachine, deviceTypeFor, mergePlan, findMatch,
  cleanProcessor, cleanOs, formatRam, formatMac, cleanSerial, modelLabel, firstIpv4,
} from '../../src/lib/connectwise.js';
import { baseUrlFor, listOf, recordsOf, recordId, REGION_BASE, DEVICE_SHAPES } from '../../src/lib/connectwise-client.js';
import { columnsFor, changesFor } from '../../src/lib/sync-merge.js';

const ctx = { companyId: 'c1', companyName: 'Smith Dental', siteId: 's1', siteName: 'Main St' };

// Nested shape (details-style).
const nested = {
  endpointId: 'e-100', friendlyName: 'Reception PC', systemName: 'RECEPTION-01', endpointType: 'Desktop',
  os: { name: 'Microsoft Windows 11 Pro' },
  system: { manufacturer: 'Dell Inc.', model: 'OptiPlex 7090', serialNumber: '7XK2QH3' },
  processor: { name: '11th Gen Intel(R) Core(TM) i5-11500 @ 2.70GHz' },
  memory: { total: 17_179_869_184 },                       // bytes
  networks: [{ ipAddress: '192.168.1.45', macAddress: '00-1A-2B-3C-4D-5E' }],
  lastLoggedInUser: 'SMITHDENTAL\\frontdesk', availability: 'Online',
};
// Flat shape (list-style).
const flat = {
  id: 'e-200', name: 'FS01', hostName: 'FS01', deviceType: 'Server',
  operatingSystem: 'Windows Server 2022 Standard', manufacturer: 'VMware, Inc.', model: 'VMware Virtual Platform',
  serialNumber: 'VMware-56 4d 12 34', processor: 'Intel(R) Xeon(R) Silver 4310 CPU @ 2.10GHz',
  totalMemory: 32768,                                      // MB
  ipAddresses: ['169.254.10.2', '10.0.0.5'], macAddress: '005056aabbcc', lastLoggedOnUser: 'administrator',
  status: 'offline',
};

test('region is picked from the Client ID prefix; an explicit URL wins', () => {
  assert.equal(baseUrlFor('0e30abcdef'), REGION_BASE.na);
  assert.equal(baseUrlFor('0e31abcdef'), REGION_BASE.eu);
  assert.equal(baseUrlFor('0E32abcdef'), REGION_BASE.au);
  assert.equal(baseUrlFor('zzzz'), REGION_BASE.na);
  assert.equal(baseUrlFor('0e31', 'https://example.test/'), 'https://example.test');
});

test('listOf finds the array whatever the envelope calls it', () => {
  assert.deepEqual(listOf([1, 2]), [1, 2]);
  assert.deepEqual(listOf({ endpoints: [1] }), [1]);
  assert.deepEqual(listOf({ data: [2] }), [2]);
  assert.deepEqual(listOf({ nothing: true }), []);
  assert.deepEqual(listOf(null), []);
});

test('pick/text read dotted paths, array indexes and {name} objects', () => {
  assert.equal(pick(nested, 'nope', 'system.model'), 'OptiPlex 7090');
  assert.equal(text(nested, 'os'), 'Microsoft Windows 11 Pro');
  assert.equal(text(nested, 'networks.0.ipAddress'), '192.168.1.45');
  assert.equal(text({ a: ['x', 'y'] }, 'a'), 'x, y');
  assert.equal(text({}, 'a'), '');
});

test('a nested endpoint normalizes into clean, tech-style values', () => {
  const m = normalizeEndpoint(nested, ctx);
  assert.equal(m.endpoint_id, 'e-100');
  assert.equal(m.name, 'Reception PC');
  assert.equal(m.machine_name, 'RECEPTION-01');
  assert.equal(m.company, 'Smith Dental');
  assert.equal(m.site, 'Main St');
  assert.equal(m.os, 'Windows 11 Pro');
  assert.equal(m.model, 'Dell OptiPlex 7090');
  assert.equal(m.serial, '7XK2QH3');
  assert.equal(m.processor, '11th Gen Intel Core i5-11500');
  assert.equal(m.ram, '16GB');
  assert.equal(m.private_ip, '192.168.1.45');
  assert.equal(m.mac, '00:1A:2B:3C:4D:5E');
  assert.equal(m.logged_on_user, 'frontdesk');   // DOMAIN\ prefix dropped
  assert.equal(m.online, true);
});

test('a flat endpoint normalizes the same way', () => {
  const m = normalizeEndpoint(flat, ctx);
  assert.equal(m.endpoint_id, 'e-200');
  assert.equal(m.os, 'Windows Server 2022 Standard');
  assert.equal(m.model, 'VMware Virtual Platform');
  assert.equal(m.processor, 'Intel Xeon Silver 4310');
  assert.equal(m.ram, '32GB');
  assert.equal(m.private_ip, '10.0.0.5');        // link-local skipped
  assert.equal(m.mac, '00:50:56:AA:BB:CC');
  assert.equal(m.online, false);
});

// Field names as a real tenant returns them (values made up): the list summary has no
// site or hardware; the v2 details put the device under its category key.
const realSummary = { endpointID: 'a1b2', deviceName: 'RECEPTION-01', friendlyName: 'Reception PC', resourceType: 'desktop', endpointType: 'Desktop' };
const realV2 = { companyID: 'c1', siteID: 's1', endpointID: 'a1b2',
  platform: { deviceName: 'RECEPTION-01', friendlyName: 'Reception PC', endpointType: 'Desktop', subResourceType: 'Windows Desktop',
    ipAddress: '192.168.1.60', macAddress: '00-1A-2B-3C-4D-5E', type: 'desktop' } };

test('real shapes: summary + v2 details (category block lifted) map cleanly', () => {
  const m = normalizeEndpoint(flattenDevice({ summary: realSummary, v2: realV2, v1: null }), ctx);
  assert.equal(m.endpoint_id, 'a1b2');
  assert.equal(m.name, 'Reception PC');
  assert.equal(m.machine_name, 'RECEPTION-01');
  assert.equal(m.site_id, 's1');
  assert.equal(m.private_ip, '192.168.1.60');
  assert.equal(m.mac, '00:1A:2B:3C:4D:5E');
  assert.equal(deviceTypeFor(m), 'workstation');
});

test('v1 details add hardware; v2 wins on IP/MAC, summary fills the rest', () => {
  const v1 = { data: { serialNumber: 'ABC123', os: { name: 'Microsoft Windows 11 Pro' }, totalMemory: 8192, ipAddress: '10.9.9.9' } };
  const m = normalizeEndpoint(flattenDevice({ summary: realSummary, v2: realV2, v1 }), ctx);
  assert.equal(m.serial, 'ABC123');
  assert.equal(m.os, 'Windows 11 Pro');
  assert.equal(m.ram, '8GB');
  assert.equal(m.private_ip, '192.168.1.60');    // v2's current IP, not v1's
  assert.equal(m.name, 'Reception PC');
});

test('a summary alone still yields a usable device', () => {
  const m = normalizeEndpoint(flattenDevice({ summary: realSummary, v2: null, v1: null }), ctx);
  assert.equal(m.endpoint_id, 'a1b2');
  assert.equal(m.machine_name, 'RECEPTION-01');
  assert.equal(m.site_id, 's1');                 // from context when the record has none
});

test('flatten lifts network/cloud category blocks and unwraps envelopes', () => {
  assert.equal(flatten({ network: { ipAddress: '10.0.0.1' } }).ipAddress, '10.0.0.1');
  assert.equal(flatten({ endpoint: { serialNumber: 'S1' } }).serialNumber, 'S1');
  assert.deepEqual(flatten(null), {});
  assert.deepEqual(flatten([1]), {});
});

test('device lists grouped by category are all read, and records without IDs opened up', () => {
  const body = { platform: [{ endpointID: 'p1' }, { endpointID: 'p2' }], network: [{ endpointID: 'n1' }], cloud: [] };
  assert.deepEqual(recordsOf(body).map(recordId), ['p1', 'p2', 'n1']);
  const nested = { data: [{ siteName: 'Main', endpoints: [{ endpointID: 'x1' }] }] };
  assert.deepEqual(recordsOf(nested).map(recordId), ['x1']);
  assert.deepEqual(recordsOf({ endpoints: [{ id: 7 }] }).map(recordId), ['7']);
  assert.deepEqual(recordsOf(null), []);
});

test('device-list request shapes are singular and tried most-specific first', () => {
  assert.deepEqual(DEVICE_SHAPES.map(s => s.resourceType ?? s.kind), ['site', 'company', 'client', 'partner', 'v1']);
});

test('memory unit is inferred: bytes, MB, GB, or an existing label', () => {
  assert.equal(formatRam(8 * 1024 ** 3), '8GB');
  assert.equal(formatRam(16106), '16GB');
  assert.equal(formatRam(32), '32GB');
  assert.equal(formatRam('15.9 GB'), '16GB');
  assert.equal(formatRam(512), '512MB');
  assert.equal(formatRam(''), '');
  assert.equal(formatRam({}), '');
});

test('value cleanup', () => {
  assert.equal(cleanProcessor('AMD Ryzen 5 5600G with Radeon Graphics'), 'AMD Ryzen 5 5600G with Radeon Graphics');
  assert.equal(cleanOs('Microsoft Windows Server 2019 Standard'), 'Windows Server 2019 Standard');
  assert.equal(formatMac('garbage'), '');
  assert.equal(formatMac('00-11-22-33-44-55, 66-77-88-99-AA-BB'), '00:11:22:33:44:55');
  assert.equal(firstIpv4('fe80::1, 203.0.113.9, 192.168.50.20'), '192.168.50.20');   // private preferred
  assert.equal(firstIpv4('203.0.113.9'), '203.0.113.9');
  assert.equal(firstIpv4('127.0.0.1'), '');
});

test('placeholder serials and manufacturers are dropped, not imported', () => {
  for (const junk of ['To be filled by O.E.M.', 'Default string', 'System Serial Number', '0', 'None', 'Unknown', '']) {
    assert.equal(cleanSerial(junk), '', junk);
  }
  assert.equal(modelLabel('System manufacturer', 'System Product Name'), '');
  assert.equal(modelLabel('LENOVO', '20XW004JUS'), 'Lenovo 20XW004JUS');
  assert.equal(modelLabel('HP', 'HP EliteDesk 800 G6'), 'HP EliteDesk 800 G6');
});

test('companies and sites read tolerantly and sort by name', () => {
  assert.deepEqual(companyOf({ companyId: 7, companyName: 'Acme' }), { id: '7', name: 'Acme' });
  assert.equal(siteOf({ siteId: 's', siteName: 'HQ', address: { city: 'Springfield' } }).city, 'Springfield');
  assert.equal(siteOf({ id: 's' }).name, 'Site');
  assert.deepEqual(sortByName([{ name: 'b' }, { name: 'A' }, { name: 'Site 10' }, { name: 'Site 2' }]).map(x => x.name),
    ['A', 'b', 'Site 2', 'Site 10']);
});

test('device type from the RMM type, then the OS', () => {
  assert.equal(deviceTypeFor(normalizeEndpoint(flat)), 'server');
  assert.equal(deviceTypeFor({ type_hint: 'Laptop', os: 'Windows 11 Pro' }), 'workstation');
  assert.equal(deviceTypeFor({ type_hint: 'Firewall', os: '' }), 'firewall');
  assert.equal(deviceTypeFor({ type_hint: 'Network Switch', os: '' }), 'switch');
  assert.equal(deviceTypeFor({ type_hint: 'Printer', os: '' }), 'printer');
  assert.equal(deviceTypeFor({ type_hint: '', os: 'Windows Server 2019' }), 'server');
  assert.equal(deviceTypeFor({ type_hint: '', os: 'macOS 14' }), 'workstation');
});

test('computer vs network-gear fields go to the right columns', () => {
  const pc = deviceFieldsFromMachine(normalizeEndpoint(nested));
  assert.equal(pc.service_tag, '7XK2QH3');
  assert.equal(pc.serial_number, '');
  assert.equal(pc.assigned_to, 'frontdesk');
  const sw = deviceFieldsFromMachine({ ...normalizeEndpoint(nested), type_hint: 'Switch', os: '' });
  assert.equal(sw.device_type, 'switch');
  assert.equal(sw.serial_number, '7XK2QH3');
  assert.equal(sw.service_tag, '');
  assert.equal(sw.computer_name, '');
  assert.equal(sw.assigned_to, '');
});

test('a server never gets the last RDP user as its "assigned to"', () => {
  assert.equal(deviceFieldsFromMachine(normalizeEndpoint(flat)).assigned_to, '');
});

test('merge: curated fields are filled only when empty, never overwritten', () => {
  const fields = deviceFieldsFromMachine(normalizeEndpoint(nested));
  const device = { label: 'Front Desk PC', assigned_to: 'Front desk', model: 'Dell OptiPlex 7090 Micro', service_tag: '' };
  const { updates, changes } = mergePlan(device, fields);
  assert.equal(updates.label, undefined);
  assert.equal(updates.assigned_to, undefined);
  assert.equal(updates.model, undefined);
  assert.equal(updates.service_tag, '7XK2QH3');
  assert.ok(changes.find(c => c.field === 'service_tag' && c.mode === 'fill'));
});

test('merge: live facts (IP, OS, RAM…) that differ are kept, and offered as take-newer changes', () => {
  const fields = deviceFieldsFromMachine(normalizeEndpoint(nested));
  const device = {
    label: 'Reception PC', computer_name: 'RECEPTION-01', ip_address: '192.168.1.20',
    operating_system: 'Windows 10 Pro', ram: '16 GB', mac_address: '00:1a:2b:3c:4d:5e',
    processor: '11th Gen Intel Core i5-11500',
  };
  const plan = mergePlan(device, fields);
  assert.equal(plan.updates.ip_address, undefined);
  assert.equal(plan.updates.operating_system, undefined);
  assert.equal(plan.newer.ip_address, '192.168.1.45');
  assert.equal(plan.newer.operating_system, 'Windows 11 Pro');
  assert.equal(plan.newer.ram, undefined);       // "16 GB" == "16GB"
  assert.equal(plan.updates.mac_address, undefined);  // same MAC, different formatting
  assert.equal(plan.newer.computer_name, undefined);
  assert.deepEqual(plan.differs.find(c => c.field === 'ip_address'), { field: 'ip_address', from: '192.168.1.20', to: '192.168.1.45', mode: 'update' });
  // An IP seen on a card that isn't the device's main MAC (UniFi recorded the Wi-Fi one) isn't a difference.
  assert.equal(mergePlan({ ...device, mac_address: '11:22:33:44:55:66' }, fields).newer.ip_address, undefined);
  // Asked for: the newer values are written and listed with everything else.
  const cols = columnsFor(plan, true);
  assert.equal(cols.operating_system, 'Windows 11 Pro');
  assert.ok(changesFor(plan, true).some(c => c.field === 'ip_address'));
  assert.equal(columnsFor(plan, false).ip_address, undefined);
});

test('merge: a blank value from the RMM never erases Portal data', () => {
  assert.deepEqual(mergePlan({ ip_address: '10.0.0.9', model: 'X' }, { ip_address: '', model: '' }).updates, {});
});

test('match: previous import → serial → MAC → name, in that order', () => {
  const m = normalizeEndpoint(nested);
  const devices = [
    { id: 'd-name', computer_name: 'reception-01' },
    { id: 'd-mac', mac_address: '001A2B3C4D5E' },
    { id: 'd-serial', service_tag: '7xk2qh3' },
    { id: 'd-link', rmm_endpoint_id: 'e-100' },
  ];
  assert.equal(findMatch(m, devices).device.id, 'd-link');
  assert.equal(findMatch(m, devices.slice(0, 3)).device.id, 'd-serial');
  assert.equal(findMatch(m, devices.slice(0, 2)).device.id, 'd-mac');
  assert.equal(findMatch(m, devices.slice(0, 1)).device.id, 'd-name');
});

test('match: the friendly name and the label count as names too', () => {
  assert.equal(findMatch(normalizeEndpoint(nested), [{ id: 'd1', label: 'reception pc' }]).device.id, 'd1');
});

test('match: two devices with the same name are never guessed between', () => {
  const r = findMatch(normalizeEndpoint(nested), [{ id: 'a', computer_name: 'RECEPTION-01' }, { id: 'b', label: 'reception-01' }]);
  assert.equal(r.device, null);
  assert.equal(r.ambiguous.length, 2);
});

test('match: a device already claimed earlier in the same import is not reused', () => {
  assert.equal(findMatch(normalizeEndpoint(nested), [{ id: 'd1', service_tag: '7XK2QH3' }], new Set(['d1'])).device, null);
});

test('match: nothing in common → new device', () => {
  const r = findMatch(normalizeEndpoint(nested), [{ id: 'x', computer_name: 'OTHER-PC', service_tag: 'ABC123' }]);
  assert.equal(r.device, null);
  assert.equal(r.ambiguous, undefined);
});

// -- Shapes seen on the live trial tenant, 2026-09-28 (values made up) --
const liveV2 = { companyID: 'c1', siteID: 's1', endpointID: 'a1b2', platform: {
  deviceName: 'FRONT-01', friendlyName: 'FRONT-01', endpointType: 'Desktop', type: 'assetCollection', subResourceType: 'Physical',
  ipAddress: ['192.168.50.20', '0.0.0.0', '172.25.64.1'], macAddress: ['10:98:19:0A:0B:0C', '08:B4:D2:0D:0E:0F'],
  remoteAddress: '203.0.113.7',
  system: { product: 'Dell Inc.', model: 'Precision 3680', serialNumber: 'ABC1234', systemName: 'FRONT-01', domain: 'WORKGROUP' },
  os: { product: 'Microsoft Windows 11 Pro', version: '10.0.26200', productKey: 'XXXXX-XXXXX' } } };
const liveMemory = [{ endpointID: 'a1b2', physicalTotalBytes: 34031251456, physicalAvailableBytes: 1 }];
const liveDisks = [{ endpointID: 'a1b2', storages: [
  { index: 0, name: '0 C:', metric: { totalSpaceBytes: 500105249280, freeSpaceBytes: 1 }, partitions: [{ name: 'C:' }] },
  { index: 1, name: '1 D: E:', metric: { totalSpaceBytes: 2000398934016 }, partitions: [{ name: 'D:' }, { name: 'E:' }] },
] }];

test('live shape: system.product is the manufacturer; remoteAddress the public IP', () => {
  const m = normalizeEndpoint(flattenDevice({ summary: {}, v2: liveV2, v1: null }), ctx);
  assert.equal(m.manufacturer, 'Dell');
  assert.equal(m.model, 'Dell Precision 3680');
  assert.equal(m.serial, 'ABC1234');
  assert.equal(m.os, 'Windows 11 Pro');
  assert.equal(m.domain, 'WORKGROUP');
  assert.equal(m.private_ip, '192.168.50.20');
  assert.equal(m.public_ip, '203.0.113.7');
  assert.equal(m.mac, '10:98:19:0A:0B:0C');
});

test('live shape: RAM from memory-usage, drives from disk-usage', () => {
  const m = normalizeEndpoint(flattenDevice({ summary: {}, v2: liveV2, v1: null, memory: liveMemory, disks: liveDisks }), ctx);
  assert.equal(m.ram, '32GB');
  assert.deepEqual(m.drives, [{ label: 'C:', size: '500GB' }, { label: 'D: E:', size: '2TB' }]);
  assert.deepEqual(deviceFieldsFromMachine(m).storage_drives, m.drives);
  assert.deepEqual(deviceFieldsFromMachine({ ...m, type_hint: 'Switch' }).storage_drives, []);
});

test('disk sizes read like the label on the drive', () => {
  assert.equal(formatDiskSize(500105249280), '500GB');
  assert.equal(formatDiskSize(512110190592), '512GB');
  assert.equal(formatDiskSize(1000204886016), '1TB');
  assert.equal(formatDiskSize(0), '');
  assert.deepEqual(drivesFrom([{ index: 2, name: '2 ', metric: { totalSpaceBytes: 256060514304 }, partitions: [] }]), [{ label: 'Disk 2', size: '256GB' }]);
  assert.deepEqual(drivesFrom(null), []);
});

test('merge: drives are added only when the Portal device has none', () => {
  const to = [{ label: 'C:', size: '500GB' }];
  const empty = mergePlan({ storage_drives: [] }, { storage_drives: to });
  assert.deepEqual(empty.updates.storage_drives, to);
  assert.deepEqual(empty.changes[0], { field: 'storage_drives', from: null, to: 'C: 500GB', mode: 'fill' });
  const curated = mergePlan({ storage_drives: [{ label: 'C:', size: '512GB NVMe SSD' }] }, { storage_drives: to });
  assert.equal(curated.updates.storage_drives, undefined);
  assert.deepEqual(mergePlan({ storage_drives: [{ label: '', size: '' }] }, { storage_drives: to }).updates.storage_drives, to);
});


// --- Dell warranty carried by the import -------------------------------------

test('a Dell warranty found during the import fills, then refreshes, the device\'s warranty', () => {
  const m = { name: 'AARON10PC', machine_name: 'AARON10PC', type_hint: '', os: 'Windows 11 Pro', serial: 'JDJFX53',
    warranty_expires: '2027-03-10', warranty_coverage: 'ProSupport' };
  const fields = deviceFieldsFromMachine(m);
  assert.equal(fields.warranty_expires, '2027-03-10');
  // Blank → filled.
  let plan = mergePlan({ id: 'd' }, fields);
  assert.ok(plan.changes.some(c => c.field === 'warranty_expires' && c.mode === 'fill'));
  // pg hands a DATE back as a local-midnight Date - the same day is NOT a change.
  plan = mergePlan({ id: 'd', warranty_expires: new Date(2027, 2, 10), warranty_coverage: 'ProSupport' }, fields);
  assert.equal(plan.changes.some(c => c.field === 'warranty_expires'), false);
  // A different date (an extension was bought) is refreshed.
  plan = mergePlan({ id: 'd', warranty_expires: '2024-03-10' }, fields);
  const c = plan.changes.find(x => x.field === 'warranty_expires');
  assert.deepEqual([c.from, c.to, c.mode], ['2024-03-10', '2027-03-10', 'update']);
});

test('no warranty from Dell never erases a stored one, and network gear gets none', () => {
  const plan = mergePlan({ id: 'd', warranty_expires: '2026-01-01' }, deviceFieldsFromMachine({ name: 'PC', machine_name: 'PC', os: 'Windows 11' }));
  assert.equal(plan.changes.some(c => c.field === 'warranty_expires'), false);
  assert.equal(deviceFieldsFromMachine({ name: 'SW', type_hint: 'switch', warranty_expires: '2027-01-01' }).warranty_expires, '');
});

// --- Re-sorting what older imports filed as "Network" ------------------------

test('a re-import moves an imported printer out of "Network"; a hand-picked type is left alone', () => {
  const printer = { name: 'HPI0A1B2C', machine_name: 'HPI0A1B2C', type_hint: 'NetworkDevice', category: 'PRINTER',
    manufacturer: 'HP', model: 'HP Color LaserJet Pro MFP 4301', os: '' };
  const fields = deviceFieldsFromMachine(printer);
  assert.equal(fields.device_type, 'printer');
  // Imported earlier as Network → moved.
  let plan = mergePlan({ id: 'd', device_type: 'network', rmm_endpoint_id: 'e1' }, fields);
  const c = plan.changes.find(x => x.field === 'device_type');
  assert.deepEqual([plan.updates.device_type, c.from, c.to], ['printer', 'Network', 'Printer']);
  // Typed in by hand as Network (never imported) → untouched.
  plan = mergePlan({ id: 'd', device_type: 'network' }, fields);
  assert.equal(plan.updates.device_type, undefined);
  // Someone already moved it to Other → untouched.
  plan = mergePlan({ id: 'd', device_type: 'other', rmm_endpoint_id: 'e1' }, fields);
  assert.equal(plan.updates.device_type, undefined);
});
