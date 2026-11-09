// Turning a multi-day Field job capture into a Portal work order: one section per
// field day, with the per-technician hours preserved in the section's internal
// notes (the Portal stores a single hours figure per section). Rates aren't part
// of the import - every section inherits the work order's default, and the biller
// overrides it per section in the Portal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumDayHours,
  hoursBreakdown,
  dayTechnicianNames,
  buildSectionNotes,
  jobDays,
  initialsOf,
  matchPortalUser,
  splitTechnicians,
} from '../../src/lib/field-import.js';

// --- Hours ---------------------------------------------------------------------

test('sumDayHours totals the technicians on the day', () => {
  assert.equal(sumDayHours({ technicians: [{ hours: 4 }, { hours: '2.5' }] }), 6.5);
});

test('sumDayHours treats blank/invalid hours as 0 rather than NaN', () => {
  assert.equal(sumDayHours({ technicians: [{ hours: 4 }, { hours: null }, { hours: '' }, { hours: 'x' }] }), 4);
  assert.equal(sumDayHours({ technicians: [] }), 0);
  assert.equal(sumDayHours(null), 0);
});

test('hoursBreakdown renders the per-technician split for the internal notes', () => {
  const day = { technicians: [{ initials: 'DG', hours: 4 }, { initials: 'RM', hours: 2.5 }] };
  assert.equal(hoursBreakdown(day), 'DG 4, RM 2.5');
});

test('hoursBreakdown omits technicians who logged no hours', () => {
  const day = { technicians: [{ initials: 'DG', hours: 4 }, { initials: 'JT', hours: '' }] };
  assert.equal(hoursBreakdown(day), 'DG 4');
});

test('hoursBreakdown is empty when nobody logged hours', () => {
  assert.equal(hoursBreakdown({ technicians: [{ initials: 'DG' }] }), '');
  assert.equal(hoursBreakdown({ technicians: [] }), '');
});

// --- Technician names ----------------------------------------------------------

test('dayTechnicianNames prefers full names and dedupes case-insensitively', () => {
  const day = { technicians: [
    { initials: 'DG', full_name: 'Dana Grant' },
    { initials: 'RM' },
    { initials: 'DG', full_name: 'dana grant' },
  ] };
  assert.deepEqual(dayTechnicianNames(day), ['Dana Grant', 'RM']);
});

test('dayTechnicianNames skips entries with neither name nor initials', () => {
  assert.deepEqual(dayTechnicianNames({ technicians: [{}, { initials: '  ' }] }), []);
});

// --- Section notes -------------------------------------------------------------

const JOB = {
  number: 42,
  customer_name: 'Smith Dental',
  customer_address: '12 Main St',
  notes: 'Gate code 4471',
};

test('the first section carries the job provenance; later sections do not repeat it', () => {
  const day = { technicians: [{ initials: 'DG', hours: 4 }], notes: null };

  const first = buildSectionNotes({ job: JOB, day, isFirst: true });
  assert.match(first, /Imported from Field Job #42/);
  assert.match(first, /Field customer: Smith Dental/);
  assert.match(first, /Site: 12 Main St/);
  assert.match(first, /Job notes: Gate code 4471/);
  assert.match(first, /Hours: DG 4/);

  const later = buildSectionNotes({ job: JOB, day, isFirst: false });
  assert.doesNotMatch(later, /Imported from Field Job/);
  assert.equal(later, 'Hours: DG 4');
});

test("the day's own notes come through", () => {
  const day = { technicians: [], notes: 'Ceiling tile damaged, told Riley' };
  const notes = buildSectionNotes({ job: JOB, day, isFirst: false });
  assert.equal(notes, 'Ceiling tile damaged, told Riley');
});

test('a section with nothing to say gets null, not an empty string', () => {
  const notes = buildSectionNotes({ job: JOB, day: { technicians: [] }, isFirst: false });
  assert.equal(notes, null);
});

// --- jobDays -------------------------------------------------------------------

test('jobDays passes a multi-day capture straight through', () => {
  const job = { days: [{ work_date: '2026-07-20' }, { work_date: '2026-07-21' }] };
  assert.equal(jobDays(job).length, 2);
});

test('a pre-006 flat capture folds into a single day, keeping its lump hours', () => {
  const job = {
    work_date: '2026-07-20',
    hours: 6.5,
    description: 'Camera install',
    technicians: [{ initials: 'DG' }, { initials: 'RM' }],
    items: [{ description: 'Dome camera', quantity: 4 }],
    services: [],
  };
  const days = jobDays(job);
  assert.equal(days.length, 1);
  assert.equal(days[0].work_date, '2026-07-20');
  assert.equal(days[0].description, 'Camera install');
  assert.equal(days[0].items.length, 1);
  // No per-tech split exists on an old capture, so the lump total is carried
  // separately rather than being summed to 0 from blank technician hours.
  assert.equal(days[0].legacy_hours, 6.5);
  assert.equal(sumDayHours(days[0]), 0);
});

test('jobDays tolerates an empty days array and a missing job', () => {
  assert.equal(jobDays({ days: [] }).length, 1);
  assert.equal(jobDays(undefined).length, 1);
});

// --- End to end ----------------------------------------------------------------

test('a three-day job maps to three sections with the right dates and hours', () => {
  const job = {
    ...JOB,
    days: [
      { work_date: '2026-07-20', description: 'Cable pull',
        technicians: [{ initials: 'DG', hours: 4 }, { initials: 'RM', hours: 2.5 }] },
      { work_date: '2026-07-21', description: 'Mount cameras',
        technicians: [{ initials: 'DG', hours: 3 }] },
      { work_date: '2026-07-25', description: 'NVR config',
        technicians: [{ initials: 'DG', hours: 8 }, { initials: 'RM', hours: 8 }] },
    ],
  };

  const sections = jobDays(job).map((day, i) => ({
    sort_order: (i + 1) * 10,
    work_date: day.work_date,
    hours: sumDayHours(day),
    notes: buildSectionNotes({ job, day, isFirst: i === 0 }),
  }));

  assert.deepEqual(sections.map((s) => s.sort_order), [10, 20, 30]);
  assert.deepEqual(sections.map((s) => s.work_date), ['2026-07-20', '2026-07-21', '2026-07-25']);
  assert.deepEqual(sections.map((s) => s.hours), [6.5, 3, 16]);
  assert.equal(sections.reduce((sum, s) => sum + s.hours, 0), 25.5);
  assert.match(sections[0].notes, /Imported from Field Job #42/);
  assert.match(sections[2].notes, /Hours: DG 8, RM 8/);
});

// --- Matching field crew to Portal accounts ------------------------------------
//
// The bug these guard: a camera tech who also has a Portal login used to import as a
// free-text chip sitting NEXT TO their own unselected user account on the work order -
// the same person listed twice.

const USERS = [
  { id: 'u-marty',  full_name: 'Marty Bornhoft' },
  { id: 'u-dana', full_name: 'Dana Grant' },
  { id: 'u-riley',  full_name: 'Riley Gray' },
];

test('initialsOf builds initials from a full name', () => {
  assert.equal(initialsOf('Marty Bornhoft'), 'mb');
  assert.equal(initialsOf('  Mary  Jo  Smith '), 'mjs');
  assert.equal(initialsOf(''), '');
});

test('a field name matching a Portal user resolves to that user', () => {
  assert.equal(matchPortalUser('Marty Bornhoft', USERS), 'u-marty');
});

test('matching ignores case and sloppy whitespace', () => {
  assert.equal(matchPortalUser('  marty   BORNHOFT ', USERS), 'u-marty');
});

test('a name nobody in the Portal has stays free text', () => {
  assert.equal(matchPortalUser('Justin', USERS), null);
  assert.equal(matchPortalUser('Trey', USERS), null);
});

test('unambiguous initials resolve to the Portal user', () => {
  assert.equal(matchPortalUser('MB', USERS), 'u-marty');
  assert.equal(matchPortalUser('dg', USERS), 'u-dana');
});

test('AMBIGUOUS initials stay free text — never guess who did billable work', () => {
  const twoDGs = [...USERS, { id: 'u-dave', full_name: 'Dave Green' }];
  assert.equal(matchPortalUser('DG', twoDGs), null);
});

test('two Portal users with the same name are not guessed between', () => {
  const twins = [{ id: 'a', full_name: 'Marty Bornhoft' }, { id: 'b', full_name: 'Marty Bornhoft' }];
  assert.equal(matchPortalUser('Marty Bornhoft', twins), null);
});

test('a long string is never treated as initials', () => {
  assert.equal(matchPortalUser('MBXY', USERS), null);
  assert.equal(matchPortalUser('M', USERS), null);
});

test('blank / missing names resolve to nothing', () => {
  assert.equal(matchPortalUser('', USERS), null);
  assert.equal(matchPortalUser(null, USERS), null);
  assert.equal(matchPortalUser('Marty Bornhoft', []), null);
});

test("splitTechnicians separates the day's crew into linked users and free names", () => {
  const day = { technicians: [
    { full_name: 'Marty Bornhoft', hours: 8 },
    { full_name: 'Justin', hours: 8 },
    { full_name: 'Trey', hours: 8 },
  ] };
  assert.deepEqual(splitTechnicians(day, USERS),
    { userIds: ['u-marty'], freeNames: ['Justin', 'Trey'] });
});

test('the same person logged by name AND initials becomes ONE linked technician', () => {
  const day = { technicians: [{ full_name: 'Marty Bornhoft' }, { initials: 'MB' }] };
  assert.deepEqual(splitTechnicians(day, USERS), { userIds: ['u-marty'], freeNames: [] });
});

test('duplicate free-text names collapse too', () => {
  const day = { technicians: [{ full_name: 'Justin' }, { full_name: 'justin' }] };
  assert.deepEqual(splitTechnicians(day, USERS), { userIds: [], freeNames: ['Justin'] });
});

test('with no Portal roster everyone stays free text (import still works)', () => {
  const day = { technicians: [{ full_name: 'Marty Bornhoft' }, { full_name: 'Justin' }] };
  assert.deepEqual(splitTechnicians(day, []), { userIds: [], freeNames: ['Marty Bornhoft', 'Justin'] });
});

test('an empty day yields nothing, not a crash', () => {
  assert.deepEqual(splitTechnicians({}, USERS), { userIds: [], freeNames: [] });
  assert.deepEqual(splitTechnicians(undefined, USERS), { userIds: [], freeNames: [] });
});
