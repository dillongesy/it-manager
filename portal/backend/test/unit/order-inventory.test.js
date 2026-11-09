// Matching Order Log lines to shared inventory for "Add to inventory".
// The failures this prevents: a customer's one-off laptop being received into stock
// because it vaguely resembled something, a line being received twice, and a guess
// between two same-named inventory items.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLine, planInventoryAdd, receiveQty, receiveNote, norm } from '../../src/lib/order-inventory.js';

const inv = [
  { id: 'i1', name: 'Cat6 Patch Cable 3ft', sku: 'INV-00001', manufacturer_barcode: '012345678905', quantity: '40', unit: 'ea' },
  { id: 'i2', name: 'UniFi U6 Pro',          sku: 'INV-00002', manufacturer_barcode: null,           quantity: '2',  unit: 'ea' },
  { id: 'i3', name: 'Keystone Jack',         sku: 'INV-00003', manufacturer_barcode: null,           quantity: '0',  unit: 'ea' },
  { id: 'i4', name: 'Keystone Jack',         sku: 'INV-00004', manufacturer_barcode: null,           quantity: '5',  unit: 'ea' },
];

test('norm is case- and whitespace-insensitive', () => {
  assert.equal(norm('  UniFi   U6  PRO '), 'unifi u6 pro');
  assert.equal(norm(null), '');
});

test('SKU matches the inventory SKU or the manufacturer barcode', () => {
  assert.equal(matchLine({ item_name: 'whatever', sku: 'inv-00002' }, inv).item.id, 'i2');
  assert.equal(matchLine({ item_name: 'whatever', sku: '012345678905' }, inv).item.id, 'i1');
  assert.equal(matchLine({ item_name: 'x', sku: 'INV-00002' }, inv).by, 'sku');
});

test('name matches exactly (ignoring case/spacing) when no SKU matches', () => {
  const m = matchLine({ item_name: 'cat6 patch  cable 3FT', sku: 'VENDOR-PART-9' }, inv);
  assert.equal(m.item.id, 'i1');
  assert.equal(m.by, 'name');
});

test('a partial/fuzzy name is NOT a match — no guessing', () => {
  assert.equal(matchLine({ item_name: 'Cat6 Patch Cable' }, inv).item, null);
  assert.equal(matchLine({ item_name: 'Dell Latitude 5440' }, inv).item, null);
});

test('two inventory items with the same name are never guessed between', () => {
  const m = matchLine({ item_name: 'Keystone Jack' }, inv);
  assert.equal(m.item, null);
  assert.deepEqual(m.candidates.map(c => c.id), ['i3', 'i4']);
});

test('an existing link wins over SKU/name, and falls back if the item is gone', () => {
  assert.equal(matchLine({ item_name: 'UniFi U6 Pro', inventory_item_id: 'i1' }, inv).item.id, 'i1');
  const m = matchLine({ item_name: 'UniFi U6 Pro', inventory_item_id: 'deleted' }, inv);
  assert.equal(m.item.id, 'i2');
  assert.equal(m.by, 'name');
});

test('mixed order: only the matching lines are received', () => {
  const plan = planInventoryAdd([
    { item_name: 'UniFi U6 Pro', quantity: 3 },
    { item_name: 'Dell Latitude 5440 for Smith Dental', quantity: 1 },
    { item_name: 'Cat6 Patch Cable 3ft', sku: 'INV-00001', quantity: 50 },
  ], inv);
  assert.deepEqual(plan.map(l => l.state), ['receive', 'unmatched', 'receive']);
  assert.equal(plan[0].match.id, 'i2');
  assert.equal(plan[2].match.id, 'i1');
});

test('a line already received is reported as added and never received again', () => {
  const plan = planInventoryAdd([
    { item_name: 'UniFi U6 Pro', quantity: 3, inventory_item_id: 'i2', inventory_name: 'UniFi U6 Pro', added_qty: 3, added_at: '2026-09-01T00:00:00Z' },
  ], inv);
  assert.equal(plan[0].state, 'added');
  assert.equal(plan[0].added_qty, 3);
});

test('manual link resolves an unmatched or ambiguous line; skip leaves a match out', () => {
  const items = [
    { item_name: 'Keystone Jack', quantity: 24 },          // ambiguous
    { item_name: 'Access point (U6-Pro)', quantity: 1 },   // unmatched
    { item_name: 'Cat6 Patch Cable 3ft', quantity: 10 },   // matched
  ];
  assert.deepEqual(planInventoryAdd(items, inv).map(l => l.state), ['ambiguous', 'unmatched', 'receive']);
  const plan = planInventoryAdd(items, inv, { 0: 'i4', '1': 'i2', 2: 'skip' });
  assert.deepEqual(plan.map(l => l.state), ['receive', 'receive', 'skipped']);
  assert.equal(plan[0].match.id, 'i4');
  assert.equal(plan[0].by, 'manual');
  assert.equal(plan[1].match.id, 'i2');
});

test('a manual link to an item that no longer exists falls back to normal matching', () => {
  const plan = planInventoryAdd([{ item_name: 'UniFi U6 Pro', quantity: 1 }], inv, { 0: 'gone' });
  assert.equal(plan[0].match.id, 'i2');
});

test('a matched line with no usable quantity is flagged, not received', () => {
  const plan = planInventoryAdd([{ item_name: 'UniFi U6 Pro', quantity: 0 }], inv);
  assert.equal(plan[0].state, 'bad_qty');
});

test('receiveQty accepts positive numbers and pg NUMERIC strings only', () => {
  assert.equal(receiveQty('2.50'), 2.5);
  assert.equal(receiveQty(4), 4);
  assert.equal(receiveQty(0), null);
  assert.equal(receiveQty(-1), null);
  assert.equal(receiveQty(''), null);
  assert.equal(receiveQty('abc'), null);
});

test('receive note traces stock back to its order', () => {
  assert.equal(receiveNote({ vendor: 'CDW', po_number: 'PO-12' }), 'Order from CDW · PO PO-12');
  assert.equal(receiveNote({ vendor: 'Amazon' }), 'Order from Amazon');
});

test('match summary carries on-hand quantity as a number', () => {
  const plan = planInventoryAdd([{ item_name: 'UniFi U6 Pro', quantity: 1 }], inv);
  assert.equal(plan[0].match.quantity, 2);
  assert.equal(plan[0].match.sku, 'INV-00002');
});
