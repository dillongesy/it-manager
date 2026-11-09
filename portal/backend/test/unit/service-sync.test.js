// Rolling a service-catalog price change down to the customers billed for it.
// The failure this prevents: Microsoft 365 goes from $35 to $38 and a customer's
// Billing tab quietly keeps saying $35 forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceSyncPlan, lineTotal, coerceMoney, coerceQty } from '../../src/lib/service-sync.js';

const charge = (o = {}) => ({ id: 'c1', description: 'M365', quantity: 1, unit_price: 35, amount: 35, is_active: true, ...o });

test('a price rise re-prices the linked charge and its line total', () => {
  const plan = priceSyncPlan([charge()], 38);
  assert.equal(plan.length, 1);
  assert.deepEqual(
    { from: plan[0].from, to: plan[0].to, amountFrom: plan[0].amountFrom, amountTo: plan[0].amountTo },
    { from: 35, to: 38, amountFrom: 35, amountTo: 38 }
  );
});

test('quantity is preserved — only the per-each price moves', () => {
  const plan = priceSyncPlan([charge({ quantity: 12, amount: 420 })], 38);
  assert.equal(plan[0].quantity, 12);
  assert.equal(plan[0].amountTo, 456);   // 12 × 38, not 38
});

test('inactive charges are left alone — they are history, not live billing', () => {
  assert.deepEqual(priceSyncPlan([charge({ is_active: false })], 38), []);
});

test('a charge already at the new price is a no-op (no phantom audit entries)', () => {
  assert.deepEqual(priceSyncPlan([charge({ unit_price: 38, amount: 38 })], 38), []);
});

test('numeric strings from pg NUMERIC columns compare correctly', () => {
  assert.deepEqual(priceSyncPlan([charge({ unit_price: '38.00', quantity: '3' })], 38), []);
  const plan = priceSyncPlan([charge({ unit_price: '35.00', quantity: '3' })], 38);
  assert.equal(plan[0].amountTo, 114);
});

test('a charge with no price yet still gets the catalog price', () => {
  const plan = priceSyncPlan([charge({ unit_price: null, amount: null })], 38);
  assert.deepEqual({ from: plan[0].from, to: plan[0].to, amountTo: plan[0].amountTo }, { from: null, to: 38, amountTo: 38 });
});

test('clearing the catalog price changes nothing — it never zeroes a customer out', () => {
  assert.deepEqual(priceSyncPlan([charge()], null), []);
  assert.deepEqual(priceSyncPlan([charge()], ''), []);
});

test('only the charges that actually need moving are returned', () => {
  const plan = priceSyncPlan([
    charge({ id: 'a', unit_price: 35 }),
    charge({ id: 'b', unit_price: 38 }),
    charge({ id: 'c', unit_price: 30, is_active: false }),
    charge({ id: 'd', unit_price: null }),
  ], 38);
  assert.deepEqual(plan.map(p => p.id), ['a', 'd']);
});

test('no linked charges at all is an empty plan, not a crash', () => {
  assert.deepEqual(priceSyncPlan([], 38), []);
  assert.deepEqual(priceSyncPlan(undefined, 38), []);
});

test('line totals round to cents', () => {
  assert.equal(lineTotal(3, 4.995), 14.99);      // 14.985 → 14.99
  assert.equal(lineTotal(7, 12.34), 86.38);
  assert.equal(lineTotal(2, null), null);
});

test('coercion: blanks are null, garbage quantity falls back to 1', () => {
  assert.equal(coerceMoney(''), null);
  assert.equal(coerceMoney(null), null);
  assert.equal(coerceMoney('12.50'), 12.5);
  assert.equal(coerceQty('abc'), 1);
  assert.equal(coerceQty(-3), 1);
  assert.equal(coerceQty('0'), 0);
});
