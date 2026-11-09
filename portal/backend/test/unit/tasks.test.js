// Tasks (migration 061): the rules behind the internal task list. The failures these
// prevent: a scheduled task still reading "Open", a reopened task keeping its "done by",
// a reorder of one tech's queue shuffling someone else's, and the Overview miscounting
// what's late or idle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceTask, applyStatusRules, changeEvents, taskFlags, summarize, reorderRanks, weekStart } from '../../src/lib/tasks.js';

const NOW = new Date(2026, 10, 4, 10, 0);   // Wed 4 Nov 2026, local
const day = (y, m, d) => new Date(y, m - 1, d);

test('a new task needs a title; unknown statuses/priorities and bad dates are refused', () => {
  assert.equal(coerceTask({}).ok, false);
  assert.equal(coerceTask({ title: '   ' }).ok, false);
  const ok = coerceTask({ title: '  Replace core switch ', customer_id: '', estimated_hours: '2.5', due_date: '2026-11-20' });
  assert.deepEqual([ok.values.title, ok.values.kind, ok.values.status, ok.values.priority, ok.values.customer_id, ok.values.estimated_hours, ok.values.due_date],
    ['Replace core switch', 'task', undefined, 'normal', null, 2.5, '2026-11-20']);
  assert.equal(applyStatusRules(null, ok.values).status, 'open');   // no date: a new task starts Open
  assert.equal(coerceTask({ title: 'x', status: 'closed' }).ok, false);
  assert.equal(coerceTask({ title: 'x', priority: 'asap' }).ok, false);
  assert.equal(coerceTask({ title: 'x', due_date: '20207-01-01' }).ok, false);
  assert.equal(coerceTask({ title: 'x', estimated_hours: -1 }).ok, false);
  // A partial edit only carries what was sent.
  assert.deepEqual(coerceTask({ priority: 'high' }, { partial: true }).values, { priority: 'high' });
});

test('dates move a task between Open and Scheduled unless the status was set by hand', () => {
  assert.equal(applyStatusRules(null, { title: 'x', scheduled_date: '2026-11-05' }).status, 'scheduled');
  assert.equal(applyStatusRules({ status: 'open' }, { scheduled_date: '2026-11-05' }).status, 'scheduled');
  assert.equal(applyStatusRules({ status: 'scheduled' }, { scheduled_date: null }).status, 'open');
  assert.equal(applyStatusRules({ status: 'in_progress' }, { scheduled_date: '2026-11-05' }).status, undefined);   // already being worked
  assert.equal(applyStatusRules({ status: 'open' }, { scheduled_date: '2026-11-05', status: 'in_progress' }).status, 'in_progress');
});

test('status changes stamp started / done, reopening clears done, and only Waiting keeps "waiting on"', () => {
  const started = applyStatusRules({ status: 'open' }, { status: 'in_progress' }, { userId: 'u1', now: NOW });
  assert.equal(started.started_at, NOW);
  assert.equal(applyStatusRules({ status: 'waiting', started_at: NOW }, { status: 'in_progress' }, { now: NOW }).started_at, undefined);   // first start only
  const done = applyStatusRules({ status: 'in_progress', waiting_on: null }, { status: 'done' }, { userId: 'u1', now: NOW });
  assert.deepEqual([done.done_at, done.done_by, done.status_changed_at], [NOW, 'u1', NOW]);
  const reopened = applyStatusRules({ status: 'done', done_by: 'u1' }, { status: 'open' }, { now: NOW });
  assert.deepEqual([reopened.done_at, reopened.done_by], [null, null]);
  assert.equal(applyStatusRules({ status: 'waiting', waiting_on: 'parts' }, { status: 'in_progress' }).waiting_on, null);
  assert.equal(applyStatusRules({ status: 'open' }, { status: 'waiting', waiting_on: 'customer' }).waiting_on, 'customer');
});

test('an edit becomes readable history entries; pg dates compare by day', () => {
  const before = { status: 'open', assigned_to: null, scheduled_date: null, due_date: day(2026, 11, 20), priority: 'normal', title: 'A', notes: '<p>x</p>' };
  const after = { ...before, status: 'scheduled', assigned_to: 'u1', scheduled_date: day(2026, 11, 6), due_date: '2026-11-20', priority: 'high', title: 'B' };
  const kinds = changeEvents(before, after).map(e => e.kind);
  assert.deepEqual(kinds, ['status', 'assigned', 'scheduled', 'priority', 'edited']);   // due date unchanged (Date vs string)
  assert.deepEqual(changeEvents(before, after).find(e => e.kind === 'scheduled').data, { from: null, to: '2026-11-06', from_time: null, to_time: null });
  assert.deepEqual(changeEvents(before, { ...before }), []);
  // Changing what it's waiting on is a status entry too.
  assert.equal(changeEvents({ ...before, status: 'waiting', waiting_on: 'parts' }, { ...before, status: 'waiting', waiting_on: 'vendor' })[0].kind, 'status');
});

test('flags: overdue, due soon, missed schedule, idle — done tasks are never late', () => {
  const base = { status: 'open', created_at: day(2026, 10, 1), updated_at: day(2026, 11, 3) };
  assert.equal(taskFlags({ ...base, due_date: '2026-11-03' }, NOW).overdue, true);
  assert.equal(taskFlags({ ...base, due_date: '2026-11-04' }, NOW).overdue, false);
  assert.equal(taskFlags({ ...base, due_date: '2026-11-07' }, NOW).due_soon, true);
  assert.equal(taskFlags({ ...base, due_date: '2026-11-08' }, NOW).due_soon, false);
  assert.equal(taskFlags({ ...base, status: 'scheduled', scheduled_date: '2026-11-02' }, NOW).missed, true);
  assert.equal(taskFlags({ ...base, updated_at: day(2026, 10, 21) }, NOW).idle_days, 14);
  assert.equal(taskFlags({ ...base, updated_at: day(2026, 10, 21) }, NOW).idle, true);
  assert.equal(taskFlags({ ...base, status: 'done', due_date: '2026-10-01', updated_at: day(2026, 9, 1) }, NOW).overdue, false);
});

test('the Overview counts per tech, this week, and leaves finished work out of the workload', () => {
  const tasks = [
    { id: 'a', number: 1, title: 'A', status: 'in_progress', priority: 'urgent', assigned_to: 'u1', due_date: '2026-11-01', estimated_hours: '3', created_at: day(2026, 10, 1), updated_at: day(2026, 11, 3) },
    { id: 'b', number: 2, title: 'B', status: 'scheduled', priority: 'normal', assigned_to: 'u1', scheduled_date: '2026-11-06', estimated_hours: '1.5', created_at: day(2026, 10, 1), updated_at: day(2026, 11, 3) },
    { id: 'c', number: 3, title: 'C', status: 'waiting', waiting_on: 'parts', priority: 'low', assigned_to: null, created_at: day(2026, 9, 1), updated_at: day(2026, 9, 2) },
    { id: 'd', number: 4, title: 'D', status: 'done', priority: 'normal', assigned_to: 'u2', done_by: 'u2', done_at: day(2026, 11, 3) },
    { id: 'e', number: 5, title: 'E', status: 'done', priority: 'normal', assigned_to: 'u2', done_by: 'u2', done_at: day(2026, 10, 28) },   // last week
  ];
  const s = summarize(tasks, [{ id: 'u1', full_name: 'Dana' }, { id: 'u2', full_name: 'Riley' }], NOW);
  assert.deepEqual([s.totals.active, s.totals.overdue, s.totals.unassigned, s.totals.idle, s.totals.done_this_week], [3, 1, 1, 1, 1]);
  assert.deepEqual(s.waiting_on.parts, 1);
  const dana = s.workload.find(w => w.user_id === 'u1');
  assert.deepEqual([dana.active, dana.in_progress, dana.overdue, dana.scheduled_this_week, dana.estimated_hours], [2, 1, 1, 1, 4.5]);
  assert.equal(s.workload.find(w => w.user_id === 'u2').done_this_week, 1);
  assert.equal(s.workload.find(w => w.user_id === null).active, 1);   // Unassigned row shown because it has work
  assert.deepEqual(s.overdue.map(t => t.id), ['a']);
  assert.deepEqual(s.urgent.map(t => t.id), ['a']);
  assert.deepEqual(weekStart(NOW), day(2026, 11, 2));
});

test('reordering hands out the same rank slots, so other queues keep their places', () => {
  const ranks = new Map([['a', 10], ['b', 40], ['c', 70]]);
  assert.deepEqual(reorderRanks(['c', 'a', 'b'], ranks), [{ id: 'c', rank: 10 }, { id: 'a', rank: 40 }, { id: 'b', rank: 70 }]);
  // Ties (several still at 0) are spread so the new order sticks.
  assert.deepEqual(reorderRanks(['b', 'a'], new Map([['a', 0], ['b', 0]])).map(r => r.rank), [0, 1]);
});

test('a scheduled task can have a time of day and a length; clearing the date clears the time', () => {
  assert.deepEqual(coerceTask({ title: 'x', scheduled_time: '09:30', duration_minutes: 90 }).values.scheduled_time, '09:30');
  assert.equal(coerceTask({ title: 'x', scheduled_time: '13:45:00' }).values.scheduled_time, '13:45');
  assert.equal(coerceTask({ title: 'x', scheduled_time: '' }).values.scheduled_time, null);
  assert.match(coerceTask({ title: 'x', scheduled_time: '9:30' }).error, /09:30/);
  assert.match(coerceTask({ title: 'x', duration_minutes: 2 }).error, /length/);
  assert.match(coerceTask({ title: 'x', duration_minutes: 30.5 }).error, /length/);
  assert.equal(applyStatusRules({ status: 'scheduled' }, { scheduled_date: null }).scheduled_time, null);
  const ev = changeEvents({ status: 'scheduled', scheduled_date: '2026-11-05', scheduled_time: '09:00:00' }, { status: 'scheduled', scheduled_date: '2026-11-05', scheduled_time: '13:00:00' });
  assert.deepEqual(ev.find(e => e.kind === 'scheduled').data, { from: '2026-11-05', to: '2026-11-05', from_time: '09:00', to_time: '13:00' });
});
