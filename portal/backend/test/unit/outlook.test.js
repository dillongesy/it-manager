import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utcIso, lastDay, matchTechs, eventTechs, normalizeEvent, normalizeEvents, wallClock, assignCategories, eventPatch,
  recurrenceText, taskEvent, taskEventChanged, toGraphRecurrence, recurrenceSpec, endSeriesBefore, eventCreate, taskMinutes,
} from '../../src/lib/outlook.js';

const users = [
  { id: 'd', full_name: 'Dana Grant' },
  { id: 'r', full_name: 'Riley Morgan' },
  { id: 's1', full_name: 'Sam Lee' },
  { id: 's2', full_name: 'Sam Ortiz' },
  { id: 'a', full_name: 'Al Brown' },
];

test('utcIso turns Graph UTC date-times into ISO instants', () => {
  assert.equal(utcIso({ dateTime: '2026-11-03T14:00:00.0000000', timeZone: 'UTC' }), '2026-11-03T14:00:00Z');
  assert.equal(utcIso({ dateTime: '2026-11-03T14:30' }), '2026-11-03T14:30:00Z');
  assert.equal(utcIso({ dateTime: '' }), null);
  assert.equal(utcIso(null), null);
});

test('lastDay: an all-day end is exclusive', () => {
  assert.equal(lastDay('2026-11-03', '2026-11-04'), '2026-11-03');          // one day
  assert.equal(lastDay('2026-11-30', '2026-12-03'), '2026-12-02');          // across a month
  assert.equal(lastDay('2026-11-03', '2026-11-03'), '2026-11-03');          // malformed → one day
  assert.equal(lastDay('2026-11-03', null), '2026-11-03');
});

test('matchTechs: full names, unique first names, in order of mention', () => {
  assert.deepEqual(matchTechs('Dana @ Northwind', users), ['d']);
  assert.deepEqual(matchTechs('riley off — dentist', users), ['r']);
  assert.deepEqual(matchTechs('Riley & Dana at Contoso', users), ['r', 'd']);
  assert.deepEqual(matchTechs('Northwind install (Dana Grant)', users), ['d']);
});

test('matchTechs: shared first names need the full name; short names and initials never count', () => {
  assert.deepEqual(matchTechs('Sam at Lakeside', users), []);               // two Sams
  assert.deepEqual(matchTechs('Sam Ortiz at Lakeside', users), ['s2']);
  assert.deepEqual(matchTechs('AL office closed', users), []);              // "Al" is too short
  assert.deepEqual(matchTechs('DG - PC setup', users), []);                 // initials ignored
  assert.deepEqual(matchTechs('Danaville trip', users), []);              // whole words only
  assert.deepEqual(matchTechs('', users), []);
});

test('normalizeEvent: timed event', () => {
  const ev = normalizeEvent({
    id: 'e1', subject: '  Dana @ Northwind ', isAllDay: false, showAs: 'busy',
    start: { dateTime: '2026-11-03T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-11-03T16:00:00.0000000', timeZone: 'UTC' },
    location: { displayName: 'Northwind — Stepping Stones' }, categories: [],
  }, users);
  assert.deepEqual(ev, {
    id: 'e1', title: 'Dana @ Northwind', all_day: false, start: '2026-11-03T14:00:00Z', end: '2026-11-03T16:00:00Z',
    location: 'Northwind — Stepping Stones', show_as: 'busy', private: false, user_ids: ['d'],
    recurring: false, series_id: null, etag: null,
  });
});

test('normalizeEvent: all-day, several days, matched by category', () => {
  const ev = normalizeEvent({
    id: 'e2', subject: 'Vacation', isAllDay: true, categories: ['Riley'],
    start: { dateTime: '2026-11-09T00:00:00.0000000' }, end: { dateTime: '2026-11-12T00:00:00.0000000' },
  }, users);
  assert.equal(ev.start_date, '2026-11-09');
  assert.equal(ev.end_date, '2026-11-11');
  assert.deepEqual(ev.user_ids, ['r']);
});

test('normalizeEvent: private events hide the title and location but keep whose they are', () => {
  const ev = normalizeEvent({
    id: 'e3', subject: 'Riley - doctor', sensitivity: 'private', location: { displayName: 'Clinic' },
    start: { dateTime: '2026-11-04T15:00:00' }, end: { dateTime: '2026-11-04T16:00:00' },
  }, users);
  assert.equal(ev.title, 'Private appointment');
  assert.equal(ev.location, null);
  assert.equal(ev.private, true);
  assert.deepEqual(ev.user_ids, ['r']);
});

test('normalizeEvents drops cancelled and unreadable events, and untitled ones get a title', () => {
  const list = normalizeEvents([
    { id: 'x', subject: 'Cancelled', isCancelled: true, start: { dateTime: '2026-11-03T14:00:00' } },
    { id: 'y', subject: 'No start' },
    { id: 'z', subject: '', start: { dateTime: '2026-11-03T14:00:00' } },
    null,
  ], users);
  assert.deepEqual(list.map(e => [e.id, e.title, e.end]), [['z', '(No title)', '2026-11-03T14:00:00Z']]);
});

// -- Recurring events, assigning, writing --

test('normalizeEvent marks occurrences of a repeating event and keeps the etag', () => {
  const ev = normalizeEvent({
    id: 'o1', subject: 'Weekly sync', type: 'occurrence', seriesMasterId: 'm1', '@odata.etag': 'W/"abc"',
    start: { dateTime: '2026-11-03T15:00:00' }, end: { dateTime: '2026-11-03T15:30:00' },
  }, users);
  assert.equal(ev.recurring, true);
  assert.equal(ev.series_id, 'm1');
  assert.equal(ev.etag, 'W/"abc"');
  assert.equal(normalizeEvent({ id: 'x', type: 'exception', seriesMasterId: 'm1', start: { dateTime: '2026-11-03T15:00:00' } }, users).recurring, true);
});

test('eventTechs: a category naming a tech wins over names in the title', () => {
  assert.deepEqual(eventTechs('Dana @ Northwind', ['Riley Morgan'], users), ['r']);   // reassigned to Riley
  assert.deepEqual(eventTechs('Dana @ Northwind', ['Blue category'], users), ['d']);   // no tech category → title
  assert.deepEqual(eventTechs('Team lunch', [], users), []);
});

test('assignCategories swaps the tech category and keeps the others', () => {
  assert.deepEqual(assignCategories(['Blue category', 'Dana Grant'], users[1], users), ['Blue category', 'Riley Morgan']);
  assert.deepEqual(assignCategories(['Riley', 'Red'], null, users), ['Red']);         // "nobody" removes a first-name category too
  assert.deepEqual(assignCategories(undefined, users[0], users), ['Dana Grant']);
});

test('wallClock gives office time on either side of daylight saving', () => {
  assert.equal(wallClock('2026-07-01T14:00:00Z', 'America/Chicago'), '2026-07-01T09:00:00');   // CDT, UTC-5
  assert.equal(wallClock('2026-12-01T15:00:00Z', 'America/Chicago'), '2026-12-01T09:00:00');   // CST, UTC-6
  assert.equal(wallClock('2026-12-01T05:30:00Z', 'America/Chicago'), '2026-11-30T23:30:00');   // previous local day
  assert.equal(wallClock('2026-12-01T06:00:00Z', 'America/Chicago'), '2026-12-01T00:00:00');   // midnight is 00, not 24
});

const zone = 'America/Chicago';
test('eventPatch: one event moved, retitled and reassigned', () => {
  const p = eventPatch({ all_day: false, start: '2026-11-05T15:00:00Z', end: '2026-11-05T17:00:00Z', title: ' New title ', assign_to: 'r' },
    { categories: ['Dana Grant', 'Green'] }, { zone, users });
  assert.equal(p.ok, true);
  assert.deepEqual(p.patch, {
    subject: 'New title',
    categories: ['Green', 'Riley Morgan'],
    isAllDay: false,
    start: { dateTime: '2026-11-05T09:00:00', timeZone: 'Central Standard Time' },
    end: { dateTime: '2026-11-05T11:00:00', timeZone: 'Central Standard Time' },
  });
});

test('eventPatch: all-day dates are inclusive in, exclusive out', () => {
  const p = eventPatch({ all_day: true, start_date: '2026-11-30', end_date: '2026-12-01' }, {}, { zone, users });
  assert.deepEqual(p.patch, {
    isAllDay: true,
    start: { dateTime: '2026-11-30T00:00:00', timeZone: 'Central Standard Time' },
    end: { dateTime: '2026-12-02T00:00:00', timeZone: 'Central Standard Time' },
  });
});

test('eventPatch: a series changes its time of day but keeps its first day and pattern', () => {
  const master = { isAllDay: false, start: { dateTime: '2026-09-01T14:00:00.0000000', timeZone: 'UTC' }, categories: [] };
  const p = eventPatch({ start_time: '10:00', end_time: '10:30', notes: 'Bring laptops' }, master, { zone, users, series: true });
  assert.deepEqual(p.patch, {
    body: { contentType: 'text', content: 'Bring laptops' },
    start: { dateTime: '2026-09-01T10:00:00', timeZone: 'Central Standard Time' },
    end: { dateTime: '2026-09-01T10:30:00', timeZone: 'Central Standard Time' },
  });
  // A series edit never sends one-event dates, even if they're in the request
  assert.equal(eventPatch({ all_day: true, start_date: '2026-11-05', end_date: '2026-11-05', title: 'x' }, master, { zone, users, series: true }).patch.isAllDay, undefined);
});

test('eventPatch refuses bad edits in plain words', () => {
  const bad = (input, current = {}, opts = {}) => eventPatch(input, current, { zone, users, ...opts }).error;
  assert.match(bad({ title: '   ' }), /title/);
  assert.match(bad({ all_day: false, start: '2026-11-05T17:00:00Z', end: '2026-11-05T15:00:00Z' }), /after the start/);
  assert.match(bad({ all_day: true, start_date: '2026-11-06', end_date: '2026-11-05' }), /on or after/);
  assert.match(bad({ assign_to: 'nobody-here' }), /Unknown technician/);
  assert.match(bad({ show_as: 'maybe' }), /show as/);
  assert.match(bad({ start_time: '9:00', end_time: '10:00' }, { isAllDay: false, start: { dateTime: '2026-09-01T14:00:00' } }, { series: true }), /09:30/);
  assert.match(bad({ start_time: '09:00', end_time: '10:00' }, { isAllDay: true }, { series: true }), /all-day/);
  assert.match(bad({}), /Nothing to change/);
});

test('recurrenceText describes the common patterns', () => {
  assert.equal(recurrenceText({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday', 'tuesday'] }, range: { type: 'noEnd' } }), 'Every week on Tue, Thu');
  assert.equal(recurrenceText({ pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] }, range: { type: 'endDate', endDate: '2026-12-31' } }), 'Every 2 weeks on Mon until Dec 31, 2026');
  assert.equal(recurrenceText({ pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', numberOfOccurrences: 10 } }), 'Every day, 10 times');
  assert.equal(recurrenceText({ pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 } }), 'Every month on day 15');
  assert.equal(recurrenceText({ pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' } }), 'Every month on the last Fri');
  assert.equal(recurrenceText({ pattern: { type: 'absoluteYearly', interval: 1, month: 3, dayOfMonth: 5 } }), 'Every year on Mar 5');
  assert.equal(recurrenceText(null), null);
});

test('taskEvent: an all-day, free event named for the tech, with the task number', () => {
  const ev = taskEvent({
    number: 12, title: 'Northwind firewall refresh', customer_name: 'Northwind', assigned_to_name: 'Dana Grant', priority: 'high',
    estimated_hours: '6.00', scheduled_date: new Date(2026, 10, 3), notes: '<p>Replace the USG.</p><ul><li>Order UCG Max</li></ul>',
  }, { zone });
  assert.equal(ev.subject, 'Dana: Northwind firewall refresh — Northwind (T-00012)');
  assert.deepEqual([ev.isAllDay, ev.showAs, ev.isReminderOn], [true, 'free', false]);
  assert.deepEqual(ev.start, { dateTime: '2026-11-03T00:00:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(ev.end, { dateTime: '2026-11-04T00:00:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(ev.categories, ['Dana Grant']);
  assert.match(ev.body.content, /T-00012 — edit it in the Portal/);
  assert.match(ev.body.content, /Estimate: 6h/);
  assert.match(ev.body.content, /Replace the USG\.\nOrder UCG Max/);
  const internal = taskEvent({ number: 3, title: 'Rebuild rack', scheduled_date: '2026-11-20' }, { zone });
  assert.equal(internal.subject, 'Rebuild rack (T-00003)');
  assert.deepEqual(internal.categories, []);
});

test('taskEventChanged: a status change alone leaves the Outlook event alone', () => {
  const base = { title: 'A', scheduled_date: new Date(2026, 10, 3), assigned_to: 'd', status: 'open', notes: null };
  assert.equal(taskEventChanged(base, { ...base, status: 'done' }), false);
  assert.equal(taskEventChanged(base, { ...base, scheduled_date: new Date(2026, 10, 3) }), false);   // same day, new Date object
  assert.equal(taskEventChanged(base, { ...base, scheduled_date: new Date(2026, 10, 4) }), true);
  assert.equal(taskEventChanged(base, { ...base, assigned_to: 'r' }), true);
  assert.equal(taskEventChanged(base, { ...base, notes: '<p>x</p>' }), true);
  assert.equal(taskEventChanged(base, { ...base, scheduled_time: '09:00:00' }), true);
  assert.equal(taskEventChanged({ ...base, scheduled_time: '09:00:00' }, { ...base, scheduled_time: '09:00:00', duration_minutes: 90 }), true);
});

// -- Times, lengths, repeating, deleting --

test('taskEvent: a task with a time is a busy, timed event for its length', () => {
  const ev = taskEvent({ number: 7, title: 'Swap switch', scheduled_day: '2026-11-05', scheduled_hm: '13:30', duration_minutes: 90 }, { zone });
  assert.deepEqual([ev.isAllDay, ev.showAs], [false, 'busy']);
  assert.deepEqual(ev.start, { dateTime: '2026-11-05T13:30:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(ev.end, { dateTime: '2026-11-05T15:00:00', timeZone: 'Central Standard Time' });
  const late = taskEvent({ number: 8, title: 'Overnight cutover', scheduled_day: '2026-11-05', scheduled_hm: '23:00', estimated_hours: 3 }, { zone });
  assert.deepEqual(late.end, { dateTime: '2026-11-06T02:00:00', timeZone: 'Central Standard Time' });   // runs past midnight
});

test('taskMinutes: its length, else the estimate to the quarter hour, else an hour', () => {
  assert.equal(taskMinutes({ duration_minutes: 45 }), 45);
  assert.equal(taskMinutes({ estimated_hours: '1.6' }), 90);
  assert.equal(taskMinutes({ estimated_hours: '0.05' }), 15);
  assert.equal(taskMinutes({}), 60);
});

test('toGraphRecurrence builds the patterns the editor offers', () => {
  const r = (spec, start = '2026-11-04') => toGraphRecurrence(spec, start, zone).recurrence;   // a Wednesday
  assert.equal(r({ freq: 'none' }), null);
  assert.deepEqual(r({ freq: 'weekly', interval: 1 }).pattern, { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' });
  assert.deepEqual(r({ freq: 'weekly', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }).pattern.daysOfWeek.length, 5);
  assert.deepEqual(r({ freq: 'monthly', monthly: 'day' }).pattern, { type: 'absoluteMonthly', interval: 1, dayOfMonth: 4 });
  assert.deepEqual(r({ freq: 'monthly', monthly: 'weekday' }).pattern, { type: 'relativeMonthly', interval: 1, daysOfWeek: ['wednesday'], index: 'first' });
  assert.equal(r({ freq: 'monthly', monthly: 'weekday' }, '2026-11-30').pattern.index, 'last');   // the 5th Monday → "last"
  assert.deepEqual(r({ freq: 'yearly' }).pattern, { type: 'absoluteYearly', interval: 1, month: 11, dayOfMonth: 4 });
  assert.deepEqual(r({ freq: 'daily', interval: 2, end: 'count', count: 10 }).range, { type: 'numbered', startDate: '2026-11-04', recurrenceTimeZone: 'Central Standard Time', numberOfOccurrences: 10 });
  assert.deepEqual(r({ freq: 'daily', end: 'date', until: '2026-12-31' }).range.endDate, '2026-12-31');
  assert.match(toGraphRecurrence({ freq: 'daily', end: 'date', until: '2026-11-01' }, '2026-11-04', zone).error, /on or after/);
  assert.match(toGraphRecurrence({ freq: 'daily', interval: 0 }, '2026-11-04', zone).error, /1 to 99/);
});

test('recurrenceSpec reads a series back into the editor (round trip)', () => {
  for (const spec of [
    { freq: 'weekly', interval: 2, days: ['monday', 'thursday'], end: 'never' },
    { freq: 'monthly', monthly: 'weekday', interval: 1, end: 'count', count: 6 },
    { freq: 'yearly', interval: 1, end: 'date', until: '2030-01-01' },
  ]) {
    const back = recurrenceSpec(toGraphRecurrence(spec, '2026-11-02', zone).recurrence);
    for (const [k, v] of Object.entries(spec)) assert.deepEqual(back[k], v, `${spec.freq}.${k}`);
  }
  assert.equal(recurrenceSpec({ pattern: { type: 'relativeYearly', interval: 1 } }).freq, 'other');
  assert.equal(recurrenceSpec(null), null);
});

const series = {
  isAllDay: false,
  start: { dateTime: '2026-09-02T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-09-02T15:30:00.0000000', timeZone: 'UTC' },
  categories: [],
  recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] }, range: { type: 'noEnd', startDate: '2026-09-02', recurrenceTimeZone: 'Central Standard Time' } },
};

test('eventPatch: dragging a weekly series a day later moves its days with it', () => {
  const p = eventPatch({ shift_days: 1 }, series, { zone, users, series: true });
  assert.deepEqual(p.patch.start, { dateTime: '2026-09-03T10:00:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(p.patch.end, { dateTime: '2026-09-03T10:30:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(p.patch.recurrence.pattern.daysOfWeek, ['thursday']);
  assert.equal(p.patch.recurrence.range.startDate, '2026-09-03');
  // Day and time together (dragged to Thursday 2 pm in the week view)
  const both = eventPatch({ shift_days: 1, start_time: '14:00', end_time: '14:30' }, series, { zone, users, series: true });
  assert.equal(both.patch.start.dateTime, '2026-09-03T14:00:00');
  // Saturday → Sunday wraps
  const sat = { ...series, recurrence: { ...series.recurrence, pattern: { type: 'weekly', interval: 1, daysOfWeek: ['saturday'] } } };
  assert.deepEqual(eventPatch({ shift_days: 1 }, sat, { zone, users, series: true }).patch.recurrence.pattern.daysOfWeek, ['sunday']);
  const monthly = { ...series, recurrence: { ...series.recurrence, pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 2 } } };
  assert.match(eventPatch({ shift_days: 1 }, monthly, { zone, users, series: true }).error, /monthly or yearly/);
});

test('eventPatch: a series gets new repeat settings and a reminder', () => {
  const p = eventPatch({ repeat: { freq: 'weekly', days: ['monday', 'wednesday'], end: 'count', count: 12 }, reminder_minutes: 30 }, series, { zone, users, series: true });
  assert.deepEqual(p.patch.recurrence.pattern.daysOfWeek, ['monday', 'wednesday']);
  assert.equal(p.patch.recurrence.range.startDate, '2026-09-02');
  assert.deepEqual([p.patch.isReminderOn, p.patch.reminderMinutesBeforeStart], [true, 30]);
  assert.deepEqual(eventPatch({ reminder_minutes: null }, {}, { zone, users }).patch, { isReminderOn: false });
  assert.match(eventPatch({ repeat: { freq: 'none' } }, series, { zone, users, series: true }).error, /this and following/);
});

test('endSeriesBefore: "this and following" ends the series the day before — or deletes it from the first', () => {
  const occ = (date) => ({ isAllDay: false, start: { dateTime: `${date}T15:00:00` } });
  const p = endSeriesBefore(series, occ('2026-11-11'), zone);
  assert.deepEqual(p.patch.recurrence.range, { type: 'endDate', startDate: '2026-09-02', endDate: '2026-11-10', recurrenceTimeZone: 'Central Standard Time' });
  assert.deepEqual(p.patch.recurrence.pattern, series.recurrence.pattern);
  assert.equal(endSeriesBefore(series, occ('2026-09-02'), zone).deleteSeries, true);
  assert.equal(endSeriesBefore({ isAllDay: true }, occ('2026-11-11'), zone).ok, false);
});

test('eventCreate: a new timed, repeating event; busy by default; needs a title and a time', () => {
  const c = eventCreate({ title: 'Patch Tuesday window', all_day: false, start: '2026-11-10T23:00:00Z', end: '2026-11-11T01:00:00Z',
    repeat: { freq: 'monthly', monthly: 'weekday' }, assign_to: 'd', reminder_minutes: 60 }, { zone, users });
  assert.equal(c.ok, true);
  assert.equal(c.event.showAs, 'busy');
  assert.deepEqual(c.event.start, { dateTime: '2026-11-10T17:00:00', timeZone: 'Central Standard Time' });
  assert.deepEqual(c.event.recurrence.pattern, { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' });
  assert.deepEqual(c.event.categories, ['Dana Grant']);
  assert.match(eventCreate({ title: '', all_day: true, start_date: '2026-11-10', end_date: '2026-11-10' }, { zone, users }).error, /title/);
  assert.match(eventCreate({ title: 'x' }, { zone, users }).error, /when/);
});
