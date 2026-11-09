// Auvik (Web UI buttons) and ThreatLocker (Billing-tab seat counts).
// The failures these prevent: a Web UI button opening another customer's printer and a
// seat sync overwriting the MSP's own price.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteId, remoteBrowserUrl, tenantUrl, deviceOf, tenantOf, matchAuvik } from '../../src/lib/auvik.js';
import { orgOf, computerOf, threatlockerProducts, packageOf, rowsOf } from '../../src/lib/threatlocker.js';
import { planSeatSync, findSeatCharge, newSeatCharge, findCatalogService } from '../../src/lib/seat-sync.js';

// --- Auvik -------------------------------------------------------------------

test('the Remote Browser address is the one Auvik itself opens', () => {
  assert.equal(remoteBrowserUrl({ domainPrefix: 'example42', deviceId: '1234567890123456789', port: 443, region: 'us6' }),
    'https://example42-1234567890123456789-443.us6.my.auvik.com/');
  assert.equal(remoteBrowserUrl({ domainPrefix: 'example42', deviceId: '1234567890123456789', port: 80, region: 'us6' }),
    'https://example42-1234567890123456789-80.us6.my.auvik.com/');
  assert.equal(tenantUrl({ domainPrefix: 'example42', region: 'us6' }), 'https://example42.us6.my.auvik.com/');
  // A base64-wrapped "<tenant>:<device>" ID still yields the device number.
  assert.equal(remoteId(Buffer.from('9876543210:1234567890123456789').toString('base64')), '1234567890123456789');
  assert.equal(remoteId('1234567890123456789'), '1234567890123456789');
  // The shape a live Auvik tenant returns: base64 "<tenantId>,<deviceId>".
  assert.equal(remoteId('MTExMTExMTExMTExMTExMTExMSwyMjIyMjIyMjIyMjIyMjIyMjIy'), '2222222222222222222');
});

const tenants = new Map([
  ['t1', tenantOf({ id: 't1', attributes: { domainPrefix: 'example42', displayName: 'Example MSP' } })],
  ['t2', tenantOf({ id: 't2', attributes: { domainPrefix: 'contoso1', displayName: 'Contoso' } })],
]);
const auvikDevice = (id, tenant, attrs) => deviceOf({ id, attributes: attrs, relationships: { tenant: { data: { id: tenant } } } }, tenants);
const auvik = [
  auvikDevice('d1', 't1', { deviceName: 'HP00AA11', deviceType: 'printer', ipAddresses: ['192.168.50.108'], serialNumber: 'CN12345678' }),
  auvikDevice('d2', 't1', { deviceName: 'Brother', deviceType: 'printer', ipAddresses: ['192.168.50.50'] }),
  auvikDevice('d3', 't2', { deviceName: 'HPEE22FF', deviceType: 'printer', ipAddresses: ['192.168.50.50'] }),   // same IP, other customer
];

test('Auvik matching: serial anywhere, IP / name only inside the customer\'s own Auvik site', () => {
  const m = matchAuvik([
    { id: 'p1', device_type: 'printer', serial_number: 'cn12345678' },
    { id: 'p2', device_type: 'printer', ip_address: '192.168.50.50' },
    { id: 'pc', device_type: 'workstation', ip_address: '192.168.50.50' },          // computers use ScreenConnect
  ], auvik, ['Some Name']);
  assert.equal(m.get('p1').device.id, 'd1');
  assert.equal(m.get('p1').reason, 'serial number');
  assert.equal(m.get('p2').device.id, 'd2');                                         // site learned from the serial match
  assert.equal(m.has('pc'), false);
  // A customer with no serial match and no name match gets nothing for a shared private IP.
  const none = matchAuvik([{ id: 'x', device_type: 'printer', ip_address: '192.168.50.50' }], auvik, ['Nobody Inc']);
  assert.equal(none.size, 0);
  // …but a site named like the customer (or its ConnectWise company) scopes it.
  const byName = matchAuvik([{ id: 'x', device_type: 'printer', ip_address: '192.168.50.50' }], auvik, ['Contoso, Inc.']);
  assert.equal(byName.get('x').device.id, 'd3');
});


// --- ThreatLocker -------------------------------------------------------------

// maintenanceCapabilities exactly as ThreatLocker returns them (seen live 2026-10-30).
const COMPLETE = { applicationControl: true, networkControl: true, storageControl: true, detect: true, elevation: true, tamper: true, elevationLearning: false };
const PROTECT = { applicationControl: true, networkControl: true, storageControl: false, detect: false, elevation: false, tamper: true };
const pc = (id, org, caps, extra = {}) => computerOf({ computerId: id, computerName: id, organizationId: org, action: 'Secure', maintenanceCapabilities: caps, isDeleted: false, ...extra });

test('each computer is Complete or Protect from its modules', () => {
  assert.deepEqual(packageOf(pc('a', 'o', COMPLETE)), { key: 'complete', missing: [] });
  assert.deepEqual(packageOf(pc('b', 'o', PROTECT)), { key: 'protect', missing: [] });
  // Seen live: a Complete customer with Elevation switched off is still Complete.
  assert.deepEqual(packageOf(pc('c', 'o', { ...COMPLETE, elevation: false })), { key: 'complete', missing: ['Elevation'] });
  assert.equal(packageOf(pc('d', 'o', {})), null);
});

test('a customer\'s orgs add up to one Complete line and one Protect line', () => {
  // "NORTHWIND-C" holds the Complete computers, "NORTHWIND-P" the Protect ones.
  const orgs = [orgOf({ organizationId: 'c', name: 'NORTHWIND-C' }), orgOf({ organizationId: 'p', name: 'NORTHWIND-P' })];
  const computers = [
    pc('C1', 'c', COMPLETE), pc('C2', 'c', { ...COMPLETE, elevation: false }),
    pc('P1', 'p', PROTECT), pc('P2', 'p', PROTECT), pc('P3', 'p', PROTECT),
    pc('GONE', 'p', PROTECT, { isDeleted: true }),
  ];
  const [complete, protect] = threatlockerProducts(orgs, computers);
  assert.deepEqual([complete.key, complete.name, complete.units], ['complete', 'ThreatLocker Complete', 2]);
  assert.deepEqual([protect.key, protect.name, protect.units], ['protect', 'ThreatLocker Protect', 3]);   // deleted one not counted
  assert.deepEqual(complete.notes, ['1 without Elevation turned on']);
  assert.equal(complete.detail[1], 'C2 · NORTHWIND-C (Secure) — no Elevation');
  // One org with only Complete computers: Protect comes back as 0, not missing.
  const [, none] = threatlockerProducts([orgs[0]], computers.filter(c => c.org_id === 'c'));
  assert.equal(none.units, 0);
});

test('a live ThreatLocker org: the MSP\'s own org is recognised, catalog products that aren\'t enabled are ignored', () => {
  const org = orgOf({
    organizationId: 'o3', name: 'Lakeside Dental', parentId: 'msp', businessClassificationName: '', billingMethod: 'device', computerCount: 35,
    products: [{ name: 'storagecontrol', displayName: 'Storage Control', isEnabledProduct: false }],
  });
  assert.deepEqual([org.bundles, org.billing, org.is_msp, org.parent_id], [[], 'per device', false, 'msp']);
  assert.equal(orgOf({ organizationId: 'msp', name: 'Example MSP', businessClassificationName: 'MSP' }).is_msp, true);
  assert.deepEqual(rowsOf({ data: [1, 2] }), [1, 2]);
});

// --- Seat sync ---------------------------------------------------------------

const CATALOG = [
  { id: 'sc', name: 'ThreatLocker Complete (Monthly)', unit_price: '6.00', recurrence: 'monthly' },
  { id: 'sp', name: 'ThreatLocker Protect (Monthly)', unit_price: '4.00', recurrence: 'monthly' },
];
const product = (key, units) => ({ key, name: key === 'complete' ? 'ThreatLocker Complete' : 'ThreatLocker Protect', units, unit_label: 'computers', frequency: 'monthly', active: true });

test('each package finds its own Services entry, the same cadence winning a tie', () => {
  assert.equal(findCatalogService(product('complete', 1), CATALOG).id, 'sc');
  assert.equal(findCatalogService(product('protect', 1), CATALOG).id, 'sp');
  const withAnnual = [...CATALOG, { id: 'sca', name: 'ThreatLocker Complete (Annual)', unit_price: '60', recurrence: 'annual' }];
  assert.equal(findCatalogService(product('complete', 1), withAnnual).id, 'sc');
});

test('seat sync: Complete and Protect update their own charges, link them to Services, and keep a different price unless asked', () => {
  const charges = [
    { id: 'c1', description: 'ThreatLocker Complete', quantity: '10', unit_price: '5.00', amount: '50.00', frequency: 'monthly', is_active: true },
    { id: 'c2', description: 'ThreatLocker Protect (Monthly)', quantity: '40', unit_price: '4.00', amount: '160.00', frequency: 'monthly', is_active: true, service_catalog_id: 'sp' },
  ];
  const [c, p] = planSeatSync('threatlocker', [product('complete', 12), product('protect', 46)], charges, CATALOG, 'Security');
  assert.equal(c.preview.charge.id, 'c1');
  assert.equal(p.preview.charge.id, 'c2');
  assert.equal(c.preview.updates.quantity, 12);
  assert.equal(c.preview.updates.service_catalog_id, 'sc');                     // linked, so Services price changes roll down
  assert.equal(c.preview.updates.amount, 60);                                   // 12 × the charge's own $5.00
  assert.equal('unit_price' in c.preview.updates, false);
  assert.deepEqual(c.preview.price_option, { from: 5, to: 6, service: 'ThreatLocker Complete (Monthly)' });
  assert.deepEqual([p.preview.updates.quantity, p.preview.updates.amount, p.preview.price_option], [46, 184, null]);
  assert.equal('service_catalog_id' in p.preview.updates, false);               // already linked
  // The biller ticks "use the Services price".
  const [asked] = planSeatSync('threatlocker', [product('complete', 12), product('protect', 46)], charges, CATALOG, 'Security', { useCatalogPrice: true });
  assert.deepEqual([asked.preview.updates.unit_price, asked.preview.updates.amount], [6, 72]);
  // Planned again with the update applied: nothing to do.
  const synced = { ...charges[1], ...p.preview.updates, source: 'threatlocker', external_id: 'protect' };
  const [, again] = planSeatSync('threatlocker', [product('complete', 12), product('protect', 46)], [charges[0], synced], CATALOG, 'Security');
  assert.equal(again.preview.action, 'unchanged');
});

test('seat sync: a package with no computers leaves a name-matched charge alone; a new charge is named and priced from Services', () => {
  const charges = [{ id: 'old', description: 'ThreatLocker Protect', quantity: '46', unit_price: '4.00', is_active: true }];
  // Only the Complete org is picked: Protect reads 0 and must not zero the Protect charge.
  const [c, p] = planSeatSync('threatlocker', [product('complete', 8), product('protect', 0)], charges, CATALOG, 'Security');
  assert.equal(p.preview.action, 'skip');
  assert.equal(c.preview.action, 'create');
  assert.deepEqual([c.preview.create.description, c.preview.create.unit_price, c.preview.create.amount, c.preview.create.service_catalog_id], ['ThreatLocker Complete (Monthly)', 6, 48, 'sc']);
  // A charge an earlier sync linked does go to 0, flagged so it isn't pre-ticked.
  const linked = [{ ...charges[0], source: 'threatlocker', external_id: 'protect', service_catalog_id: 'sp' }];
  const [, zero] = planSeatSync('threatlocker', [product('complete', 8), product('protect', 0)], linked, CATALOG, 'Security');
  assert.deepEqual([zero.preview.action, zero.preview.updates.quantity, zero.preview.to_zero], ['update', 0, true]);
});

test('seat sync: two lookalike charges are never guessed between; no Services match leaves the price blank', () => {
  const two = [{ id: 'a', description: 'ThreatLocker Complete' }, { id: 'b', description: 'ThreatLocker Complete (old)' }];
  assert.equal(findSeatCharge('threatlocker', product('complete', 3), two, new Set(), { manyProducts: true }).ambiguous.length, 2);
  const blank = newSeatCharge('threatlocker', { key: 's', name: 'ThreatLocker Elevation', units: 4, unit_label: 'computers', frequency: 'annually', term_end: '2027-06-30' }, [], 'Security');
  assert.deepEqual([blank.unit_price, blank.amount, blank.billing_month], [null, null, 7]);   // renews the month after the term ends
});
