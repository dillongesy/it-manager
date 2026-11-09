// "Every N years" cadences.
//
// The bug these exist to prevent: a domain registration bought for three years used
// to be recorded as "Annually", which tripled it in every recurring-revenue total and
// put the renewal two years early on the dashboard. The interval count is what makes
// the difference, so its coercion and its money math are both worth pinning down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceIntervalCount, cadenceLabel, cadenceUnit, perYear, coerceBillingYear,
  isAnnual, MAX_INTERVAL_COUNT,
} from '../../src/lib/cadence.js';
import { nextRenewal, toDateStr } from '../../src/lib/renewal.js';

// ─── Which periods may carry a count ───────────────────────────────────────────

test('both spellings of the yearly period are recognized', () => {
  // The service catalog stores 'annual'; customer recurring charges store 'annually'.
  assert.equal(isAnnual('annual'), true);
  assert.equal(isAnnual('annually'), true);
  assert.equal(isAnnual('monthly'), false);
});

test('a count above 1 is only allowed on a yearly period', () => {
  assert.equal(coerceIntervalCount(3, 'annual'), 3);
  assert.equal(coerceIntervalCount(3, 'annually'), 3);
  // "Every 2 quarters" would need a label and next-due path nothing is written for.
  assert.equal(coerceIntervalCount(2, 'quarterly'), 1);
  assert.equal(coerceIntervalCount(2, 'monthly'), 1);
  assert.equal(coerceIntervalCount(2, 'semiannual'), 1);
});

test('garbage, zero and negative counts fall back to the ordinary cadence', () => {
  for (const bad of [undefined, null, '', 'abc', 0, -4, NaN, {}]) {
    assert.equal(coerceIntervalCount(bad, 'annually'), 1, `for ${JSON.stringify(bad)}`);
  }
});

test('a numeric string from a form input is accepted', () => {
  assert.equal(coerceIntervalCount('3', 'annually'), 3);
  assert.equal(coerceIntervalCount('3.9', 'annually'), 3);   // whole periods only
});

test('an absurd count is clamped rather than stored', () => {
  assert.equal(coerceIntervalCount(9999, 'annually'), MAX_INTERVAL_COUNT);
});

// ─── Labels ────────────────────────────────────────────────────────────────────

test('a count of 1 reads as the plain cadence', () => {
  assert.equal(cadenceLabel('monthly', 1), 'Monthly');
  assert.equal(cadenceLabel('quarterly', 1), 'Quarterly');
  assert.equal(cadenceLabel('semiannual', 1), 'Semi-annual');
  assert.equal(cadenceLabel('annual', 1), 'Annually');
  assert.equal(cadenceLabel('annually', 1), 'Annually');
});

test('a multi-year cadence reads as "Every N years"', () => {
  assert.equal(cadenceLabel('annually', 3), 'Every 3 years');
  assert.equal(cadenceLabel('annual', 2), 'Every 2 years');
});

test('a count that the period cannot carry is ignored by the label too', () => {
  assert.equal(cadenceLabel('monthly', 6), 'Monthly');
});

test('the price suffix carries the years', () => {
  assert.equal(cadenceUnit('monthly', 1), 'mo');
  assert.equal(cadenceUnit('quarterly', 1), 'qtr');
  assert.equal(cadenceUnit('semiannual', 1), '6mo');
  assert.equal(cadenceUnit('annually', 1), 'yr');
  assert.equal(cadenceUnit('annually', 3), '3yr');
});

test('an unknown cadence degrades to its own name rather than blank', () => {
  assert.equal(cadenceLabel('fortnightly', 1), 'fortnightly');
  assert.equal(cadenceUnit('fortnightly', 1), '');
});

// ─── Annualizing ───────────────────────────────────────────────────────────────

test('perYear is what keeps recurring-revenue totals honest', () => {
  assert.equal(perYear('monthly', 1), 12);
  assert.equal(perYear('quarterly', 1), 4);
  assert.equal(perYear('semiannual', 1), 2);
  assert.equal(perYear('annually', 1), 1);
  // A $60 domain billed every 3 years is $20/yr of recurring revenue, not $60.
  assert.equal(60 * perYear('annually', 3), 20);
});

// ─── Year anchor ───────────────────────────────────────────────────────────────

test('only a multi-year charge stores a year anchor', () => {
  assert.equal(coerceBillingYear(2027, 'annually', 1), null);
  assert.equal(coerceBillingYear(2027, 'quarterly', 1), null);
  assert.equal(coerceBillingYear(2027, 'annually', 3), 2027);
});

test('a missing or impossible anchor year defaults to the current year', () => {
  const from = new Date(2026, 7, 26);
  assert.equal(coerceBillingYear(null, 'annually', 3, from), 2026);
  assert.equal(coerceBillingYear('20207', 'annually', 3, from), 2026);   // the 6-digit-year typo
  assert.equal(coerceBillingYear(1200, 'annually', 3, from), 2026);
});

// ─── Multi-year renewals ───────────────────────────────────────────────────────

const next = (anchor, interval, from, count) => toDateStr(nextRenewal(anchor, interval, from, count));

test('a 3-year domain renewal steps three years at a time from its anchor', () => {
  // Registered 2024-03-15 for 3 years; today is well past the first term.
  assert.equal(next('2024-03-15', 'annually', new Date(2028, 0, 1), 3), '2030-03-15');
  assert.equal(next('2024-03-15', 'annually', new Date(2026, 7, 26), 3), '2027-03-15');
  // On the renewal day itself, today still counts.
  assert.equal(next('2024-03-15', 'annually', new Date(2027, 2, 15), 3), '2027-03-15');
});

test('a multi-year cycle never drifts off its anchor day', () => {
  // Every step is measured from the ORIGINAL anchor, so Feb-29 clamps per landing
  // year instead of walking backwards a day each cycle.
  assert.equal(next('2024-02-29', 'annually', new Date(2031, 0, 1), 2), '2032-02-29');
  assert.equal(next('2024-02-29', 'annually', new Date(2025, 0, 1), 2), '2026-02-28');
});

test('an omitted count behaves exactly as before — nothing existing changes', () => {
  assert.equal(next('2024-03-15', 'annually', new Date(2026, 7, 26)), '2027-03-15');
  assert.equal(next('2024-03-15', 'annually', new Date(2026, 7, 26), 1), '2027-03-15');
  assert.equal(next('2026-01-31', 'monthly', new Date(2026, 1, 1)), '2026-02-28');
});

test('a count on a monthly subscription is ignored, not applied', () => {
  // The count belongs to yearly periods only; a stray value must not silently turn a
  // monthly subscription into a quarterly one.
  assert.equal(next('2026-01-15', 'monthly', new Date(2026, 7, 26), 3),
               next('2026-01-15', 'monthly', new Date(2026, 7, 26), 1));
});

test('a future anchor is returned unchanged whatever the count', () => {
  assert.equal(next('2029-06-01', 'annually', new Date(2026, 7, 26), 3), '2029-06-01');
});
