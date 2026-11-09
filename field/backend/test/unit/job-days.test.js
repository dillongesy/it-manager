// Multi-day job captures (migration 006): per-technician hours, day totals and
// rate labels. A day's hours is ALWAYS the sum of its technicians', so these
// guard the one number the office bills from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHours,
  dayHours,
  totalHours,
  hoursByTechnician,
  normalizeDay,
  normalizeDays,
} from '../../src/lib/work-order-logic.js';

// --- parseHours ----------------------------------------------------------------

test('parseHours accepts numbers and numeric strings', () => {
  assert.equal(parseHours(4), 4);
  assert.equal(parseHours('2.5'), 2.5);
  assert.equal(parseHours(0), 0);
});

test('parseHours treats blank as null (counted as 0 downstream)', () => {
  assert.equal(parseHours(''), null);
  assert.equal(parseHours(null), null);
  assert.equal(parseHours(undefined), null);
});

test('parseHours rejects negatives and garbage rather than storing them', () => {
  assert.equal(parseHours(-3), null);
  assert.equal(parseHours('abc'), null);
  assert.equal(parseHours(Infinity), null);
});

test('parseHours rounds to the two decimals the column stores', () => {
  assert.equal(parseHours('3.333'), 3.33);
  assert.equal(parseHours(4.567), 4.57);
  assert.equal(parseHours(0.25), 0.25); // the quarter-hour step the form uses
});

test('parseHours clamps to the NUMERIC(6,2) range instead of erroring on insert', () => {
  assert.equal(parseHours(999999), 9999.99);
});

// --- Day + job totals ----------------------------------------------------------

test('dayHours sums the technicians on that day', () => {
  const day = { technicians: [{ hours: 4 }, { hours: 2.5 }, { hours: 1.25 }] };
  assert.equal(dayHours(day), 7.75);
});

test('a technician with blank hours contributes 0, never NaN', () => {
  const day = { technicians: [{ hours: 4 }, { hours: '' }, { hours: null }] };
  assert.equal(dayHours(day), 4);
});

test('a day with no technicians is 0 hours', () => {
  assert.equal(dayHours({ technicians: [] }), 0);
  assert.equal(dayHours({}), 0);
  assert.equal(dayHours(null), 0);
});

test('totalHours adds up every day of the job', () => {
  const days = [
    { technicians: [{ hours: 4 }, { hours: 2.5 }] }, // 6.5
    { technicians: [{ hours: 3 }] },                 // 3
    { technicians: [{ hours: 8 }, { hours: 8 }] },   // 16
  ];
  assert.equal(totalHours(days), 25.5);
  assert.equal(totalHours([]), 0);
  assert.equal(totalHours(undefined), 0);
});

test('hoursByTechnician rolls one person up across every day they worked', () => {
  const days = [
    { technicians: [{ initials: 'DG', hours: 4 }, { initials: 'RM', hours: 2.5 }] },
    { technicians: [{ initials: 'DG', hours: 3 }] },
    { technicians: [{ initials: 'RM', hours: '' }] },
  ];
  const totals = hoursByTechnician(days);
  assert.deepEqual(totals, [{ label: 'DG', hours: 7 }, { label: 'RM', hours: 2.5 }]);
});

test('hoursByTechnician falls back to a name when there are no initials', () => {
  const days = [{ technicians: [{ full_name: 'Contract Cabling Co', hours: 6 }] }];
  assert.deepEqual(hoursByTechnician(days), [{ label: 'Contract Cabling Co', hours: 6 }]);
});

// --- normalizeDay --------------------------------------------------------------

test('normalizeDay keeps hours alongside each technician', () => {
  const day = normalizeDay({
    work_date: '2026-07-20',
    technicians: [{ user_id: 'u1', hours: '4' }, { initials: 'rm', name: 'R M', hours: 2.5 }],
  });
  assert.deepEqual(day.technicians, [
    { user_id: 'u1', initials: null, name: null, hours: 4 },
    { user_id: null, initials: 'RM', name: 'R M', hours: 2.5 },
  ]);
});

test('normalizeDay drops empty technicians WITHOUT misaligning the remaining hours', () => {
  // The empty middle entry must not shift RM's 2.5 hours onto the wrong person.
  const day = normalizeDay({
    technicians: [
      { initials: 'DG', hours: 4 },
      {},
      { initials: 'RM', hours: 2.5 },
    ],
  });
  assert.equal(day.technicians.length, 2);
  assert.deepEqual(day.technicians.map((t) => [t.initials, t.hours]), [['DG', 4], ['RM', 2.5]]);
});

test('normalizeDay strips blank text and drops empty parts/services', () => {
  const day = normalizeDay({
    work_date: '2026-07-20',
    description: '   ',
    notes: '  on site notes ',
    items: [{ description: 'Dome camera', quantity: 2 }, { description: '   ' }, {}],
    services: [{ description: 'Programming' }, { description: '' }],
  });
  assert.equal(day.description, null);
  assert.equal(day.notes, 'on site notes');
  assert.equal(day.items.length, 1);
  assert.equal(day.services.length, 1);
});

test('normalizeDay returns null for a day with nothing on it at all', () => {
  assert.equal(normalizeDay({ technicians: [], items: [], services: [] }), null);
  assert.equal(normalizeDay(null), null);
});

test('normalizeDay keeps a day that only has a date — a placeholder for tomorrow', () => {
  const day = normalizeDay({ work_date: '2026-07-21' });
  assert.ok(day);
  assert.equal(day.work_date, '2026-07-21');
});

// --- normalizeDays -------------------------------------------------------------

test('normalizeDays numbers sort_order in the submitted order', () => {
  const days = normalizeDays([
    { work_date: '2026-07-20', technicians: [{ initials: 'DG', hours: 4 }] },
    { work_date: '2026-07-21', technicians: [{ initials: 'DG', hours: 3 }] },
    { work_date: '2026-07-24', technicians: [{ initials: 'DG', hours: 8 }] },
  ]);
  assert.deepEqual(days.map((d) => d.sort_order), [10, 20, 30]);
});

test('normalizeDays renumbers after dropping an empty day in the middle', () => {
  const days = normalizeDays([
    { work_date: '2026-07-20', technicians: [{ initials: 'DG', hours: 4 }] },
    { technicians: [], items: [], services: [] },  // dropped
    { work_date: '2026-07-24', technicians: [{ initials: 'DG', hours: 8 }] },
  ]);
  assert.equal(days.length, 2);
  assert.deepEqual(days.map((d) => d.sort_order), [10, 20]);
  assert.deepEqual(days.map((d) => d.work_date), ['2026-07-20', '2026-07-24']);
});

test('normalizeDays returns [] for non-arrays', () => {
  assert.deepEqual(normalizeDays(undefined), []);
  assert.deepEqual(normalizeDays('nope'), []);
});

test('a full multi-day job normalizes end to end', () => {
  const days = normalizeDays([
    {
      work_date: '2026-07-20',
      description: 'Ran cable, mounted 4 domes',
      technicians: [{ initials: 'DG', hours: '4' }, { initials: 'RM', hours: '2.5' }],
      items: [{ description: 'Dome camera', quantity: 4, unit_price: '129.99' }],
      services: [],
    },
    {
      work_date: '2026-07-25',
      description: 'NVR config',
      technicians: [{ initials: 'DG', hours: '6' }],
      items: [],
      services: [{ description: 'Remote view setup' }],
    },
  ]);

  assert.equal(days.length, 2);
  assert.equal(totalHours(days), 12.5);
  assert.deepEqual(hoursByTechnician(days), [{ label: 'DG', hours: 10 }, { label: 'RM', hours: 2.5 }]);
});
