import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSku,
  nextSku,
  serviceLedgerNote,
  parseQuantity,
  isLowStock,
  safeTokenEqual,
  buildSearchClause,
} from '../../src/lib/inventory-logic.js';

test('formatSku pads to 5 digits with INV- prefix', () => {
  assert.equal(formatSku(1), 'INV-00001');
  assert.equal(formatSku(42), 'INV-00042');
  assert.equal(formatSku(99999), 'INV-99999');
  assert.equal(formatSku(123456), 'INV-123456'); // overflow still works, just longer
});

test('nextSku starts at INV-00001 when there is no prior SKU', () => {
  assert.equal(nextSku(null), 'INV-00001');
  assert.equal(nextSku(undefined), 'INV-00001');
  assert.equal(nextSku(''), 'INV-00001');
});

test('nextSku increments the existing SKU', () => {
  assert.equal(nextSku('INV-00001'), 'INV-00002');
  assert.equal(nextSku('INV-00007'), 'INV-00008');
  assert.equal(nextSku('INV-00099'), 'INV-00100');
});

test('nextSku falls back to first SKU when the prior one is unparseable', () => {
  assert.equal(nextSku('GARBAGE'), 'INV-00001');
});

test('serviceLedgerNote always tags IT Portal and includes the actor', () => {
  assert.equal(serviceLedgerNote('Dana Grant', 'Acme job'), '[IT Portal: Dana Grant] Acme job');
});

test('serviceLedgerNote works without a note', () => {
  assert.equal(serviceLedgerNote('Dana Grant', ''), '[IT Portal: Dana Grant]');
  assert.equal(serviceLedgerNote('Dana Grant', undefined), '[IT Portal: Dana Grant]');
});

test('serviceLedgerNote works without an actor', () => {
  assert.equal(serviceLedgerNote('', 'note only'), '[IT Portal] note only');
  assert.equal(serviceLedgerNote(undefined, undefined), '[IT Portal]');
});

test('parseQuantity accepts positive numbers and strings', () => {
  assert.deepEqual(parseQuantity(5), { ok: true, value: 5 });
  assert.deepEqual(parseQuantity('3'), { ok: true, value: 3 });
  assert.deepEqual(parseQuantity('2.5'), { ok: true, value: 2.5 });
});

test('parseQuantity rejects zero, negatives, and non-numbers', () => {
  for (const bad of [0, -1, '0', 'abc', '', null, undefined, NaN]) {
    const r = parseQuantity(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.equal(r.error, 'quantity must be > 0.');
  }
});

test('isLowStock compares quantity against threshold', () => {
  assert.equal(isLowStock(3, 5), true);   // below
  assert.equal(isLowStock(5, 5), true);   // at threshold = low
  assert.equal(isLowStock(6, 5), false);  // above
});

test('isLowStock with no threshold is never low', () => {
  assert.equal(isLowStock(0, null), false);
  assert.equal(isLowStock(0, undefined), false);
});

test('isLowStock handles string numerics from pg NUMERIC columns', () => {
  assert.equal(isLowStock('3.00', '5.00'), true);
  assert.equal(isLowStock('6.00', '5.00'), false);
});

test('safeTokenEqual returns true only for identical strings', () => {
  assert.equal(safeTokenEqual('abc123', 'abc123'), true);
});

test('safeTokenEqual returns false on mismatch, length diff, or nullish', () => {
  assert.equal(safeTokenEqual('abc123', 'abc124'), false);
  assert.equal(safeTokenEqual('abc', 'abcd'), false);
  assert.equal(safeTokenEqual('', 'x'), false);
  assert.equal(safeTokenEqual(null, 'x'), false);
  assert.equal(safeTokenEqual('x', null), false);
  assert.equal(safeTokenEqual(undefined, undefined), false);
});

test('buildSearchClause returns empty for blank/whitespace search', () => {
  assert.deepEqual(buildSearchClause('', ['name']), { clause: '', params: [] });
  assert.deepEqual(buildSearchClause('   ', ['name']), { clause: '', params: [] });
  assert.deepEqual(buildSearchClause(null, ['name']), { clause: '', params: [] });
  assert.deepEqual(buildSearchClause('x', []), { clause: '', params: [] });
});

test('buildSearchClause makes one column-OR group per token', () => {
  const { clause, params } = buildSearchClause('cat6', ['name', 'sku'], 1);
  assert.equal(clause, '(name ILIKE $1 OR sku ILIKE $1)');
  assert.deepEqual(params, ['%cat6%']);
});

test('buildSearchClause ANDs multiple tokens so order/gaps do not matter (HID 20)', () => {
  // "HID 20" must match "HID Signo Reader 20 Black": each token in its own AND group.
  const { clause, params } = buildSearchClause('HID 20', ['name', 'sku'], 1);
  assert.equal(
    clause,
    '(name ILIKE $1 OR sku ILIKE $1) AND (name ILIKE $2 OR sku ILIKE $2)'
  );
  assert.deepEqual(params, ['%HID%', '%20%']);
});

test('buildSearchClause honours a non-1 startIndex (params already in the query)', () => {
  const { clause, params } = buildSearchClause('a b', ['name'], 3);
  assert.equal(clause, '(name ILIKE $3) AND (name ILIKE $4)');
  assert.deepEqual(params, ['%a%', '%b%']);
});

test('buildSearchClause collapses repeated whitespace between tokens', () => {
  const { params } = buildSearchClause('  HID   20  ', ['name'], 1);
  assert.deepEqual(params, ['%HID%', '%20%']);
});
