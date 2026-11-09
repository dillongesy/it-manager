// Dell warranty → "Warranty Expires" on a device.
// The failures this prevents: an extended warranty ignored because only the first
// entitlement was read, a date a day off because Dell stamps end dates in UTC, and a
// non-Dell machine (or a junk tag) sent to Dell at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endDateOf, warrantyFromAsset, warrantyPlan, isDell, isValidServiceTag, normalizeTag, tagOf } from '../../src/lib/dell.js';

const asset = (o = {}) => ({
  serviceTag: 'JDJFX53',
  shipDate: '2021-03-10T00:00:00Z',
  systemDescription: 'OptiPlex 3080',
  invalid: false,
  entitlements: [
    { startDate: '2021-03-10T00:00:00Z', endDate: '2024-03-10T23:59:59.000001Z', serviceLevelDescription: 'Onsite Service After Remote Diagnosis', serviceLevelGroup: 5 },
    { startDate: '2024-03-11T00:00:00Z', endDate: '2027-03-11T05:59:59.999Z', serviceLevelDescription: 'ProSupport', serviceLevelGroup: 5 },
  ],
  ...o,
});

test('end dates are read as the day Dell means, whatever the server time zone', () => {
  assert.equal(endDateOf('2024-03-10T23:59:59.000001Z'), '2024-03-10');   // late in the UTC day → same day
  assert.equal(endDateOf('2027-03-11T05:59:59.999Z'), '2027-03-10');      // small hours UTC → the US day before
  assert.equal(endDateOf('not a date'), null);
  assert.equal(endDateOf(null), null);
});

test('the warranty ends when the LAST entitlement does, and that one names the coverage', () => {
  const w = warrantyFromAsset(asset());
  assert.equal(w.expires, '2027-03-10');
  assert.equal(w.coverage, 'ProSupport');
  assert.equal(w.tag, 'JDJFX53');
  assert.equal(w.ship_date, '2021-03-10');
  assert.equal(w.invalid, false);
});

test('software / digital-delivery entitlements never count as warranty', () => {
  const w = warrantyFromAsset(asset({ entitlements: [
    ...asset().entitlements,
    { endDate: '2099-01-01T23:00:00Z', serviceLevelDescription: 'Dell Digital Delivery', serviceLevelGroup: 11 },
    { endDate: '2098-01-01T23:00:00Z', serviceLevelDescription: 'Something', serviceLevelGroup: -99999 },
  ] }));
  assert.equal(w.expires, '2027-03-10');
});

test('an asset Dell marks invalid, or with nothing at all, has no warranty', () => {
  assert.equal(warrantyFromAsset({ serviceTag: 'ABC1234', invalid: true, entitlements: [] }).invalid, true);
  assert.equal(warrantyFromAsset({ serviceTag: 'ABC1234', entitlements: [] }).expires, null);
  assert.equal(warrantyFromAsset(null).expires, null);
});

test('only Dell machines with a real service tag are looked up', () => {
  assert.equal(isDell({ manufacturer: 'Dell' }), true);
  assert.equal(isDell({ model: 'Dell OptiPlex 7090' }), true);
  assert.equal(isDell({ model: 'Alienware Aurora R13' }), true);
  assert.equal(isDell({ manufacturer: 'Lenovo', model: 'ThinkCentre M70q' }), false);
  assert.equal(isDell({ model: 'Dellwood Router' }), false);           // a word that starts with "dell"
  assert.equal(isValidServiceTag('jdjfx53'), true);
  assert.equal(isValidServiceTag('5CD1234XYZ'), false);                 // HP-length serial
  assert.equal(isValidServiceTag('To Be Filled'), false);
  assert.equal(normalizeTag(' jd jfx53 '), 'JDJFX53');
  assert.equal(tagOf({ service_tag: '', serial_number: 'abc1234' }), 'ABC1234');
});

test('the plan says what a check would do to each device', () => {
  const devices = [
    { id: 'a', label: 'Front desk', model: 'Dell OptiPlex 3080', service_tag: 'JDJFX53', warranty_expires: null },
    { id: 'b', label: 'Office', model: 'Dell OptiPlex 3080', service_tag: 'JDJFX54', warranty_expires: new Date(2027, 2, 10) },  // pg DATE → local-midnight Date
    { id: 'c', label: 'Server', model: 'Dell PowerEdge T150', service_tag: 'JDJFX55', warranty_expires: '2025-01-01' },
    { id: 'd', label: 'Unknown', model: 'Dell Latitude 5440', service_tag: 'ZZZZZZZ' },
    { id: 'e', label: 'No tag', model: 'Dell Latitude 5440', service_tag: '' },
    { id: 'f', label: 'Lenovo', model: 'Lenovo ThinkPad', service_tag: 'PF0A0BBB' },
  ];
  const results = new Map([
    ['JDJFX53', asset()],
    ['JDJFX54', asset({ serviceTag: 'JDJFX54' })],
    ['JDJFX55', asset({ serviceTag: 'JDJFX55' })],
  ]);
  const rows = Object.fromEntries(warrantyPlan(devices, results).map(r => [r.device_id, r]));
  assert.equal(rows.a.action, 'fill');
  assert.equal(rows.a.expires, '2027-03-10');
  assert.equal(rows.b.action, 'unchanged');
  assert.equal(rows.b.current, '2027-03-10');
  assert.equal(rows.c.action, 'update');
  assert.equal(rows.c.current, '2025-01-01');
  assert.equal(rows.d.action, 'not_found');
  assert.equal(rows.e.action, 'no_tag');
  assert.equal(rows.f, undefined);                                      // not Dell → not listed
});
