// Date-only field validation. The bug this prevents: an <input type="date"> accepts a
// six-digit year, Postgres DATE stores it happily, and every later save of that record
// dies with `time zone displacement out of range: "+020207-07"` — including a rename
// that never touched the date.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceDate, coerceDateFields, assertDateFields, MIN_DATE_YEAR, MAX_DATE_YEAR } from '../../src/lib/dates.js';

test('a normal date passes through normalized', () => {
  assert.deepEqual(coerceDate('2026-07-15'), { ok: true, value: '2026-07-15' });
});

test('blank values mean "no date", not an error', () => {
  for (const v of ['', null, undefined]) {
    assert.deepEqual(coerceDate(v), { ok: true, value: null });
  }
});

test('the six-digit year that caused the outage is rejected', () => {
  const r = coerceDate('20207-07-15');
  assert.equal(r.ok, false);
  assert.match(r.error, /YYYY-MM-DD/);
});

test('an expanded-year ISO string is rejected, not half-parsed', () => {
  assert.equal(coerceDate('+020207-07-15T05:00:00.000Z').ok, false);
  // …and so is the 10-char slice of it that reached Postgres.
  assert.equal(coerceDate('+020207-07').ok, false);
});

test('a year outside the sane range is named in the error so it can be fixed', () => {
  const r = coerceDate('0007-07-15');
  assert.equal(r.ok, false);
  assert.match(r.error, /out-of-range year \(7\)/);
  assert.match(r.error, new RegExp(`${MIN_DATE_YEAR}.*${MAX_DATE_YEAR}`));
});

test('the range boundaries themselves are allowed', () => {
  assert.equal(coerceDate('1900-01-01').value, '1900-01-01');
  assert.equal(coerceDate('9999-12-31').value, '9999-12-31');
});

test('a full ISO timestamp keeps only its calendar date', () => {
  assert.equal(coerceDate('2026-07-15T00:00:00.000Z').value, '2026-07-15');
  assert.equal(coerceDate('2026-07-15 00:00:00').value, '2026-07-15');
});

test('a Date instance is formatted from its LOCAL parts (no timezone day-shift)', () => {
  assert.equal(coerceDate(new Date(2026, 6, 15)).value, '2026-07-15');
  assert.equal(coerceDate(new Date('nonsense')).ok, false);
});

test('impossible calendar dates are caught', () => {
  assert.equal(coerceDate('2026-13-01').ok, false);   // month 13
  assert.equal(coerceDate('2026-02-30').ok, false);   // February 30th
  assert.equal(coerceDate('2026-00-10').ok, false);   // month 0
  assert.equal(coerceDate('2026-07-00').ok, false);   // day 0
  assert.equal(coerceDate('2026-02-29').ok, false);   // 2026 is not a leap year
  assert.equal(coerceDate('2028-02-29').value, '2028-02-29'); // …but 2028 is
});

test('junk never reaches the database', () => {
  for (const v of ['not a date', '2026/07/15', '07-15-2026', '2026-7-5', {}, []]) {
    assert.equal(coerceDate(v).ok, false, `expected ${JSON.stringify(v)} to be rejected`);
  }
});

test('coerceDateFields only touches fields actually present (PATCH stays partial)', () => {
  const r = coerceDateFields({ order_date: '2026-01-05', vendor: 'Ingram' },
    ['order_date', 'expected_date', 'received_date']);
  assert.deepEqual(r, { ok: true, values: { order_date: '2026-01-05' } });
});

test('coerceDateFields names the offending field in plain words', () => {
  const r = coerceDateFields({ received_date: '20207-01-01' }, ['order_date', 'received_date']);
  assert.equal(r.ok, false);
  assert.match(r.error, /^received date /);
});

test('assertDateFields throws a 400 the error handler can surface verbatim', () => {
  assert.deepEqual(assertDateFields({ call_date: '2026-03-09' }, ['call_date']), { call_date: '2026-03-09' });
  assert.throws(
    () => assertDateFields({ warranty_expires: '20207-07-15' }, ['warranty_expires']),
    (err) => err.status === 400 && /warranty expires/.test(err.message)
  );
});
