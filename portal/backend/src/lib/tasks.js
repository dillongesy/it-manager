// Tasks (migration 061) — the internal task list that replaced the Backlog and customer
// To-Dos. Pure functions only, unit-tested: what a request may set, what a status change
// implies, what changed (for the task's history), and the flags/summary behind the
// Overview (overdue, sitting idle, workload per tech).

import { coerceDate } from './dates.js';

export const STATUSES = ['open', 'scheduled', 'in_progress', 'waiting', 'done'];
export const ACTIVE_STATUSES = STATUSES.filter(s => s !== 'done');
export const KINDS = ['task', 'project'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
export const WAITING_ON = ['customer', 'parts', 'vendor', 'other'];

/** Days without any change (edit, comment, status) before an active task counts as sitting idle. */
export const IDLE_DAYS = 14;
/** A due date this many days out (or fewer) counts as "due soon". */
export const DUE_SOON_DAYS = 3;

const DATE_FIELDS = ['scheduled_date', 'due_date', 'requested_date'];
const TEXT_FIELDS = { requested_by: 255, requested_phone: 50, requested_time: 20 };
const ID_FIELDS = ['customer_id', 'location_id', 'assigned_to'];

const fail = (error) => ({ ok: false, error });

/**
 * What a create / edit request may set, validated and normalized.
 * @returns {{ ok: true, values } | { ok: false, error }}
 */
export function coerceTask(body = {}, { partial = false } = {}) {
  const values = {};
  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? '').trim();
    if (!title) return fail('A task needs a title.');
    values.title = title.slice(0, 255);
  }
  if (body.notes !== undefined) values.notes = body.notes ? String(body.notes) : null;

  const pick = (field, allowed, fallback) => {
    if (body[field] === undefined) { if (!partial && fallback !== undefined) values[field] = fallback; return null; }
    if (!allowed.includes(body[field])) return `Unknown ${field.replace('_', ' ')} "${body[field]}".`;
    values[field] = body[field];
    return null;
  };
  // No status default here: applyStatusRules decides it (a new task with a date starts Scheduled).
  const bad = pick('kind', KINDS, 'task') || pick('status', STATUSES) || pick('priority', PRIORITIES, 'normal');
  if (bad) return fail(bad);
  if (body.waiting_on !== undefined) {
    if (body.waiting_on && !WAITING_ON.includes(body.waiting_on)) return fail(`Unknown waiting on "${body.waiting_on}".`);
    values.waiting_on = body.waiting_on || null;
  }

  for (const f of ID_FIELDS) if (body[f] !== undefined) values[f] = body[f] || null;
  for (const f of DATE_FIELDS) {
    if (body[f] === undefined) continue;
    const r = coerceDate(body[f]);
    if (!r.ok) return fail(`${f.replace(/_/g, ' ')} ${r.error}.`);
    values[f] = r.value;
  }
  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    if (body[f] !== undefined) values[f] = String(body[f] ?? '').trim().slice(0, max) || null;
  }
  // A time of day on the scheduled date ("HH:MM", office time) and how long it's booked for.
  if (body.scheduled_time !== undefined) {
    if (body.scheduled_time === null || body.scheduled_time === '') values.scheduled_time = null;
    else {
      const m = String(body.scheduled_time).match(/^([01]\d|2[0-3]):([0-5]\d)(:\d{2})?$/);
      if (!m) return fail('The time must look like 09:30.');
      values.scheduled_time = `${m[1]}:${m[2]}`;
    }
  }
  if (body.duration_minutes !== undefined) {
    if (body.duration_minutes === null || body.duration_minutes === '') values.duration_minutes = null;
    else {
      const d = Number(body.duration_minutes);
      if (!Number.isInteger(d) || d < 5 || d > 10080) return fail('The length must be between 5 minutes and a week.');
      values.duration_minutes = d;
    }
  }
  if (body.estimated_hours !== undefined) {
    if (body.estimated_hours === null || body.estimated_hours === '') values.estimated_hours = null;
    else {
      const h = Number(body.estimated_hours);
      if (!Number.isFinite(h) || h < 0 || h > 9999) return fail('Estimated hours must be a number between 0 and 9999.');
      values.estimated_hours = Math.round(h * 100) / 100;
    }
  }
  return { ok: true, values };
}

/**
 * Everything a change implies beyond what was asked for:
 *   - giving an open task a date makes it Scheduled; clearing a Scheduled task's date
 *     makes it Open again (unless the request set the status itself)
 *   - only a Waiting task carries "waiting on"
 *   - a status change stamps status_changed_at; the first move to In progress stamps
 *     started_at; Done stamps done_at/done_by, and reopening clears them
 * `before` is the stored task (null on create).
 */
export function applyStatusRules(before, values, { userId = null, now = new Date() } = {}) {
  const out = { ...values };
  const prevStatus = before?.status ?? null;
  if (out.status === undefined) {
    const date = out.scheduled_date;
    if (date && (prevStatus ?? 'open') === 'open') out.status = 'scheduled';
    else if (date === null && prevStatus === 'scheduled') out.status = 'open';
    else if (!before) out.status = 'open';
  }
  // No date, no time of day.
  if (out.scheduled_date === null) out.scheduled_time = null;
  const status = out.status ?? prevStatus ?? 'open';
  if (status !== 'waiting') { if (out.waiting_on !== undefined || before?.waiting_on) out.waiting_on = null; }

  if (out.status !== undefined && out.status !== prevStatus) {
    out.status_changed_at = now;
    if (out.status === 'in_progress' && !before?.started_at) out.started_at = now;
    if (out.status === 'done') { out.done_at = now; out.done_by = userId; }
    else if (prevStatus === 'done') { out.done_at = null; out.done_by = null; }
  }
  return out;
}

const dateKey = (v) => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const same = (a, b) => (a ?? null) === (b ?? null);

/**
 * The history entries an edit produces: [{ kind, data: { from, to } }]. Dates are compared
 * as YYYY-MM-DD (pg hands DATE back as a local-midnight Date).
 */
export function changeEvents(before, after) {
  const events = [];
  if (!same(before.status, after.status)) events.push({ kind: 'status', data: { from: before.status, to: after.status, waiting_on: after.waiting_on ?? null } });
  else if (after.status === 'waiting' && !same(before.waiting_on, after.waiting_on)) events.push({ kind: 'status', data: { from: before.status, to: after.status, waiting_on: after.waiting_on ?? null } });
  if (!same(before.assigned_to, after.assigned_to)) events.push({ kind: 'assigned', data: { from: before.assigned_to ?? null, to: after.assigned_to ?? null } });
  const hm = (v) => (v ? String(v).slice(0, 5) : null);
  if (!same(dateKey(before.scheduled_date), dateKey(after.scheduled_date)) || !same(hm(before.scheduled_time), hm(after.scheduled_time))) {
    events.push({ kind: 'scheduled', data: { from: dateKey(before.scheduled_date), to: dateKey(after.scheduled_date), from_time: hm(before.scheduled_time), to_time: hm(after.scheduled_time) } });
  }
  if (!same(dateKey(before.due_date), dateKey(after.due_date))) events.push({ kind: 'due', data: { from: dateKey(before.due_date), to: dateKey(after.due_date) } });
  if (!same(before.priority, after.priority)) events.push({ kind: 'priority', data: { from: before.priority, to: after.priority } });
  const edited = ['title', 'notes', 'kind', 'customer_id', 'estimated_hours', 'duration_minutes'].filter(f => String(before[f] ?? '') !== String(after[f] ?? ''));
  if (edited.length) events.push({ kind: 'edited', data: { fields: edited } });
  return events;
}

const DAY = 86_400_000;
const localDay = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
const daysBetween = (from, to) => Math.floor((localDay(to) - localDay(from)) / DAY);
const parseDay = (v) => { const k = dateKey(v); return k ? new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) : null; };

/**
 * The flags the lists and the Overview colour a task by.
 *   overdue  — active and past its due date
 *   due_soon — active and due within DUE_SOON_DAYS
 *   missed   — Scheduled for a day that's already gone
 *   idle     — active and untouched for IDLE_DAYS
 */
export function taskFlags(task, today = new Date()) {
  const active = task.status !== 'done';
  const due = parseDay(task.due_date);
  const scheduled = parseDay(task.scheduled_date);
  const dueIn = due ? daysBetween(today, due) : null;
  const idleDays = task.updated_at ? daysBetween(task.updated_at, today) : 0;
  return {
    overdue: active && dueIn != null && dueIn < 0,
    due_soon: active && dueIn != null && dueIn >= 0 && dueIn <= DUE_SOON_DAYS,
    missed: task.status === 'scheduled' && scheduled != null && daysBetween(today, scheduled) < 0,
    idle: active && idleDays >= IDLE_DAYS,
    age_days: task.created_at ? daysBetween(task.created_at, today) : 0,
    idle_days: idleDays,
  };
}

/** Monday of the week `d` falls in (local time). */
export function weekStart(d = new Date()) {
  const x = localDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/**
 * The Overview: totals, waiting reasons, workload per tech and the lists worth a look.
 * `tasks` = every active task plus anything finished recently; `users` = [{ id, full_name }].
 */
export function summarize(tasks, users = [], today = new Date()) {
  const monday = weekStart(today);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const inWeek = (v) => { const d = parseDay(v); return d && d >= monday && d <= sunday; };
  const active = tasks.filter(t => t.status !== 'done');
  const withFlags = active.map(t => ({ ...t, flags: taskFlags(t, today) }));

  const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const t of active) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const waitingOn = Object.fromEntries(WAITING_ON.map(w => [w, 0]));
  for (const t of active) if (t.status === 'waiting') waitingOn[t.waiting_on || 'other'] += 1;
  const doneThisWeek = tasks.filter(t => t.status === 'done' && t.done_at && new Date(t.done_at) >= monday);

  const hours = (list) => Math.round(list.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0) * 100) / 100;
  const workload = [...users, { id: null, full_name: 'Unassigned' }].map(u => {
    const mine = withFlags.filter(t => (t.assigned_to ?? null) === u.id);
    return {
      user_id: u.id,
      name: u.full_name,
      active: mine.length,
      in_progress: mine.filter(t => t.status === 'in_progress').length,
      waiting: mine.filter(t => t.status === 'waiting').length,
      overdue: mine.filter(t => t.flags.overdue).length,
      scheduled_this_week: mine.filter(t => inWeek(t.scheduled_date)).length,
      estimated_hours: hours(mine),
      done_this_week: doneThisWeek.filter(t => (t.done_by ?? t.assigned_to ?? null) === u.id).length,
    };
  }).filter(w => w.user_id !== null || w.active > 0);

  const slim = (t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority, kind: t.kind,
    customer_id: t.customer_id, customer_name: t.customer_name ?? null, assigned_to: t.assigned_to, assigned_to_name: t.assigned_to_name ?? null,
    // Dates go out as the driver gave them, like the list endpoint, so the browser formats both the same way.
    due_date: t.due_date ?? null, scheduled_date: t.scheduled_date ?? null, waiting_on: t.waiting_on ?? null, flags: t.flags });
  return {
    totals: {
      active: active.length,
      overdue: withFlags.filter(t => t.flags.overdue).length,
      due_soon: withFlags.filter(t => t.flags.due_soon).length,
      idle: withFlags.filter(t => t.flags.idle).length,
      unassigned: active.filter(t => !t.assigned_to).length,
      projects: active.filter(t => t.kind === 'project').length,
      done_this_week: doneThisWeek.length,
    },
    by_status: byStatus,
    waiting_on: waitingOn,
    workload,
    overdue: withFlags.filter(t => t.flags.overdue).sort((a, b) => a.flags.idle_days - b.flags.idle_days || String(a.due_date).localeCompare(String(b.due_date))).map(slim),
    idle: withFlags.filter(t => t.flags.idle).sort((a, b) => b.flags.idle_days - a.flags.idle_days).slice(0, 15).map(slim),
    urgent: withFlags.filter(t => t.priority === 'urgent' || t.priority === 'high').sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]).slice(0, 15).map(slim),
  };
}

/**
 * New ranks for a reorder: the tasks keep the rank slots they already held (sorted), handed
 * out in the new order — so reordering one tech's queue never shuffles anyone else's.
 */
export function reorderRanks(ids, currentRanks) {
  const slots = ids.map(id => Number(currentRanks.get(id) ?? 0)).sort((a, b) => a - b);
  // Duplicate slots (e.g. several tasks still at 0) would leave ties; spread them out.
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  return ids.map((id, i) => ({ id, rank: slots[i] }));
}
