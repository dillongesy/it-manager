import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WO_STATUSES,
  WO_TRANSITIONS,
  CAPTURE_STATUSES,
  canTransitionCapture,
  isEditable,
  isDeletable,
  normalizeTechnician,
  normalizeTechnicians,
  coerceIntervalCount,
  isAnnualCadence,
  MAX_INTERVAL_COUNT,
} from '../../src/lib/work-order-logic.js';

test('WO_STATUSES covers the full lifecycle in order', () => {
  assert.deepEqual(WO_STATUSES, ['draft', 'submitted', 'pending_billing', 'invoiced', 'paid']);
});

test('WO_TRANSITIONS chain from draft to paid', () => {
  assert.deepEqual(WO_TRANSITIONS.submit,  { from: 'draft',           to: 'pending_billing', tsField: 'submitted_at' });
  assert.deepEqual(WO_TRANSITIONS.invoice, { from: 'pending_billing', to: 'invoiced',        tsField: 'invoiced_at' });
  assert.deepEqual(WO_TRANSITIONS.pay,     { from: 'invoiced',        to: 'paid',            tsField: 'paid_at' });
});

test('each transition picks up where the previous left off', () => {
  assert.equal(WO_TRANSITIONS.submit.to,  WO_TRANSITIONS.invoice.from);
  assert.equal(WO_TRANSITIONS.invoice.to, WO_TRANSITIONS.pay.from);
});

test('only open captures are editable and deletable', () => {
  assert.equal(isEditable('open'), true);
  assert.equal(isDeletable('open'), true);
  for (const s of ['ready', 'imported']) {
    assert.equal(isEditable(s), false, `${s} should not be editable`);
    assert.equal(isDeletable(s), false, `${s} should not be deletable`);
  }
});

test('CAPTURE_STATUSES is the open->ready->imported lifecycle', () => {
  assert.deepEqual(CAPTURE_STATUSES, ['open', 'ready', 'imported']);
});

test('canTransitionCapture allows open<->ready only', () => {
  assert.equal(canTransitionCapture('open', 'ready').ok, true);
  assert.equal(canTransitionCapture('ready', 'open').ok, true);
});

test('canTransitionCapture rejects illegal moves', () => {
  assert.equal(canTransitionCapture('open', 'imported').ok, false);   // bridge-only
  assert.equal(canTransitionCapture('ready', 'imported').ok, false);  // bridge-only
  assert.equal(canTransitionCapture('imported', 'open').ok, false);   // terminal
  assert.equal(canTransitionCapture('imported', 'ready').ok, false);  // terminal
  assert.equal(canTransitionCapture('open', 'bogus').ok, false);      // unknown
});

test('normalizeTechnician keeps only user_id for a linked account', () => {
  const row = normalizeTechnician({ user_id: 'uuid-1', initials: 'XX', name: 'Ignored' });
  assert.deepEqual(row, { user_id: 'uuid-1', initials: null, name: null });
});

test('normalizeTechnician keeps typed initials/name for a free-text tech', () => {
  const row = normalizeTechnician({ initials: 'dg', name: 'Dana Grant' });
  assert.deepEqual(row, { user_id: null, initials: 'DG', name: 'Dana Grant' });
});

test('normalizeTechnician accepts full_name as the name source', () => {
  const row = normalizeTechnician({ initials: 'jp', full_name: 'Jane P' });
  assert.deepEqual(row, { user_id: null, initials: 'JP', name: 'Jane P' });
});

test('normalizeTechnician upper-cases and trims free-text initials', () => {
  assert.equal(normalizeTechnician({ initials: '  ab  ' }).initials, 'AB');
});

test('normalizeTechnician returns null for empty entries', () => {
  assert.equal(normalizeTechnician({}), null);
  assert.equal(normalizeTechnician({ initials: '   ' }), null);
  assert.equal(normalizeTechnician(null), null);
  assert.equal(normalizeTechnician(undefined), null);
});

test('normalizeTechnicians filters empties and normalizes the rest', () => {
  const out = normalizeTechnicians([
    { user_id: 'u1' },
    {},
    { initials: 'cd', name: 'C D' },
    { initials: '  ' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { user_id: 'u1', initials: null, name: null });
  assert.deepEqual(out[1], { user_id: null, initials: 'CD', name: 'C D' });
});

test('normalizeTechnicians returns [] for non-arrays', () => {
  assert.deepEqual(normalizeTechnicians(undefined), []);
  assert.deepEqual(normalizeTechnicians(null), []);
  assert.deepEqual(normalizeTechnicians('nope'), []);
});

// ─── Service cadences ("every N years") ────────────────────────────────────────
//
// The value crosses the bridge into a real Portal work-order service, so this app's
// rule about which periods may carry a count has to match the Portal's exactly.

test('a count above 1 is only allowed on a yearly cadence', () => {
  assert.equal(coerceIntervalCount(3, 'annual'), 3);
  assert.equal(coerceIntervalCount(3, 'annually'), 3);
  assert.equal(coerceIntervalCount(2, 'monthly'), 1);
  assert.equal(coerceIntervalCount(2, 'quarterly'), 1);
  assert.equal(coerceIntervalCount(2, 'semiannual'), 1);
  assert.equal(coerceIntervalCount(2, null), 1);
});

test('garbage, blank and out-of-range counts fall back to the ordinary cadence', () => {
  for (const bad of [undefined, null, '', 'abc', 0, -1, NaN]) {
    assert.equal(coerceIntervalCount(bad, 'annual'), 1, `for ${JSON.stringify(bad)}`);
  }
  assert.equal(coerceIntervalCount('3', 'annual'), 3);       // straight off a number input
  assert.equal(coerceIntervalCount(9999, 'annual'), MAX_INTERVAL_COUNT);
});

test('isAnnualCadence accepts both spellings the two apps store', () => {
  assert.equal(isAnnualCadence('annual'), true);
  assert.equal(isAnnualCadence('annually'), true);
  assert.equal(isAnnualCadence('monthly'), false);
});
