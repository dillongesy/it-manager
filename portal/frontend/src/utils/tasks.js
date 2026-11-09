// Tasks - labels, colours and the date flags the lists use. The rules themselves (what a
// status change implies, the Overview numbers) live in backend lib/tasks.js; the flags are
// mirrored here so a list can colour a row without a round trip.

export const TASK_STATUSES = ['open', 'scheduled', 'in_progress', 'waiting', 'done'];
export const ACTIVE_STATUSES = TASK_STATUSES.filter(s => s !== 'done');

export const STATUS_LABEL = { open: 'Open', scheduled: 'Scheduled', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
export const STATUS_BADGE = {
  open:        'bg-surface-600 text-gray-300',
  scheduled:   'bg-blue-900/40 text-blue-300',
  in_progress: 'bg-accent/15 text-accent',
  waiting:     'bg-purple-900/40 text-purple-300',
  done:        'bg-green-900/30 text-green-400',
};

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
export const PRIORITY_BADGE = {
  urgent: 'bg-red-900/50 text-red-300',
  high:   'bg-orange-900/40 text-orange-300',
  normal: 'bg-surface-600 text-gray-400',
  low:    'bg-surface-700 text-gray-500',
};
export const PRIORITY_DOT = { urgent: 'bg-red-500', high: 'bg-orange-400', normal: 'bg-gray-500', low: 'bg-gray-700' };

export const KIND_LABEL = { task: 'Task', project: 'Project' };
export const WAITING_ON = ['customer', 'parts', 'vendor', 'other'];
export const WAITING_LABEL = { customer: 'the customer', parts: 'parts', vendor: 'a vendor', other: 'something else' };

export const taskNumber = (n) => `T-${String(n ?? 0).padStart(5, '0')}`;

export const IDLE_DAYS = 14;
export const DUE_SOON_DAYS = 3;
const DAY = 86_400_000;
const localDay = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
const parseDay = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : localDay(v);
};
const daysBetween = (a, b) => Math.round((localDay(b) - localDay(a)) / DAY);

/** overdue / due soon / missed (scheduled day passed) / idle - same rules as the backend. */
export function taskFlags(task, today = new Date()) {
  const active = task.status !== 'done';
  const due = parseDay(task.due_date);
  const scheduled = parseDay(task.scheduled_date);
  const dueIn = due ? daysBetween(today, due) : null;
  const idleDays = task.updated_at ? daysBetween(task.updated_at, today) : 0;
  return {
    overdue: active && dueIn != null && dueIn < 0,
    due_soon: active && dueIn != null && dueIn >= 0 && dueIn <= DUE_SOON_DAYS,
    due_in: dueIn,
    missed: task.status === 'scheduled' && scheduled != null && daysBetween(today, scheduled) < 0,
    idle: active && idleDays >= IDLE_DAYS,
    idle_days: idleDays,
    age_days: task.created_at ? daysBetween(task.created_at, today) : 0,
  };
}

/** "today", "tomorrow", "in 4 days", "2 days ago". */
export function relativeDays(n) {
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Local YYYY-MM-DD for a Date. */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Monday of the week `d` falls in. */
export function weekStart(d = new Date()) {
  const x = localDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The 1st of the month `d` falls in. */
export const monthStart = (d = new Date()) => { const x = localDay(d); return new Date(x.getFullYear(), x.getMonth(), 1); };

/** `n` months from the 1st of `d`'s month. */
export const addMonths = (d, n) => { const x = monthStart(d); return new Date(x.getFullYear(), x.getMonth() + n, 1); };

/** The month calendar: whole Monday–Sunday weeks covering `d`'s month (4–6 rows of 7 days). */
export function monthWeeks(d) {
  const first = monthStart(d);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const weeks = [];
  for (let monday = weekStart(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
  }
  return weeks;
}

// Each tech's colour on the schedule. Mid-tone colours that read on both themes; red is left
// out because the calendar already uses it for overdue.
export const TECH_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6'];
export const UNASSIGNED_COLOR = '#6b7280';
const hashOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/**
 * user id → colour, assigned automatically. Accounts pick in the order they were created, each
 * starting from a colour derived from its id and taking the next free one, so adding a tech
 * never changes anyone else's colour. Past ten techs, colours repeat.
 */
export function techColors(techs) {
  const out = new Map();
  const used = new Set();
  const order = [...techs].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id)));
  for (const u of order) {
    const start = hashOf(u.id) % TECH_PALETTE.length;
    let pick = TECH_PALETTE[start];
    for (let i = 0; i < TECH_PALETTE.length; i++) {
      const c = TECH_PALETTE[(start + i) % TECH_PALETTE.length];
      if (!used.has(c)) { pick = c; break; }
    }
    used.add(pick);
    out.set(String(u.id), pick);
  }
  return out;
}

/** "#3b82f6", 0.15 → "rgba(59, 130, 246, 0.15)". */
export const tint = (hex, alpha) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`; };

/** A local Date at midnight from "YYYY-MM-DD". */
export const fromDayKey = (key) => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));

/** "Dana Grant" → "DG". */
export const initials = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();

/** Today as local YYYY-MM-DD. */
export const todayKey = () => dayKey(new Date());
