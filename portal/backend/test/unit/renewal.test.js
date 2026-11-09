import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRenewal, toDateStr } from '../../src/lib/renewal.js';

const at = (y, m, d) => new Date(y, m - 1, d); // 1-based month for readability
const next = (anchor, interval, from) => toDateStr(nextRenewal(anchor, interval, from));

test('a future anchor is returned unchanged (not yet renewed)', () => {
  assert.equal(next('2026-12-01', 'monthly', at(2026, 6, 29)), '2026-12-01');
  assert.equal(next('2030-01-01', 'annually', at(2026, 6, 29)), '2030-01-01');
});

test('monthly: rolls forward to the next on-or-after occurrence', () => {
  // anchored on the 15th; today is the 29th → next month's 15th
  assert.equal(next('2026-01-15', 'monthly', at(2026, 6, 29)), '2026-07-15');
  // today exactly on an occurrence → that date counts (on-or-after)
  assert.equal(next('2026-01-15', 'monthly', at(2026, 6, 15)), '2026-06-15');
});

test('monthly: 31st anchor clamps short months but does NOT drift', () => {
  // From the ORIGINAL anchor, so Mar still lands on the 31st (no permanent 28th drift)
  assert.equal(next('2026-01-31', 'monthly', at(2026, 2, 1)),  '2026-02-28'); // Feb clamp
  assert.equal(next('2026-01-31', 'monthly', at(2026, 3, 1)),  '2026-03-31'); // back to 31
  assert.equal(next('2026-01-31', 'monthly', at(2026, 4, 1)),  '2026-04-30'); // Apr clamp
});

test('monthly: 30th anchor clamps February to the 28th', () => {
  assert.equal(next('2026-01-30', 'monthly', at(2026, 2, 10)), '2026-02-28');
});

test('monthly: Feb-29 (leap) clamp in a common-year February', () => {
  assert.equal(next('2024-01-31', 'monthly', at(2025, 2, 5)),  '2025-02-28');
});

test('monthly: crosses a year boundary correctly', () => {
  assert.equal(next('2025-11-10', 'monthly', at(2026, 1, 5)),  '2026-01-10');
});

test('annually: rolls forward whole years', () => {
  assert.equal(next('2020-09-01', 'annually', at(2026, 6, 29)), '2026-09-01');
  assert.equal(next('2020-03-01', 'annually', at(2026, 6, 29)), '2027-03-01');
});

test('annually: Feb-29 anchor lands on Feb-28 in common years, Feb-29 in leap years', () => {
  assert.equal(next('2024-02-29', 'annually', at(2025, 1, 1)),  '2025-02-28'); // common year
  assert.equal(next('2024-02-29', 'annually', at(2028, 1, 1)),  '2028-02-29'); // leap year
});

test('unknown/missing interval defaults to monthly', () => {
  assert.equal(next('2026-01-15', undefined, at(2026, 6, 29)), '2026-07-15');
});

test('unparseable anchor yields null', () => {
  assert.equal(nextRenewal(null, 'monthly'), null);
  assert.equal(nextRenewal('not-a-date', 'monthly'), null);
});

test('accepts a Date anchor as well as a string', () => {
  assert.equal(next(at(2026, 1, 15), 'monthly', at(2026, 6, 29)), '2026-07-15');
});
