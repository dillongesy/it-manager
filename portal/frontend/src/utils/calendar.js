import { dayKey, fromDayKey, addDays } from './tasks.js';

// Calendar maths for the Tasks schedule: minutes of the day, lengths, reminders, laying out
// overlapping appointments side by side, and the repeat choices the event editor offers.
// Times are the viewer's local (office) time.

export const HOUR_PX = 48;          // one hour in the day/week grid
export const SNAP = 15;             // drag and resize step, minutes
export const DAY_MINUTES = 24 * 60;

const pad = (n) => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const snap = (m, step = SNAP) => Math.round(m / step) * step;
export const snapDown = (m, step = SNAP) => Math.floor(m / step) * step;

/** Minutes since local midnight. */
export const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
/** 570 → "09:30". */
export const hm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
/** "09:30" → 570 (null if blank). */
export const parseHm = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null);
/** 570 → "9:30 AM". */
export const timeLabel = (m) => new Date(2000, 0, 1, 0, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** A local Date at `minutes` past midnight on `key`. */
export const atMinutes = (key, minutes) => { const d = fromDayKey(key); d.setMinutes(minutes); return d; };

/** 90 → "1 h 30 min". */
export function lengthLabel(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? `${h} h` : '', r ? `${r} min` : ''].filter(Boolean).join(' ') || '0 min';
}
export const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

export const REMINDERS = [
  ['', 'No reminder'], [0, 'At the start'], [5, '5 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'],
  [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [10080, '1 week before'],
];

/** How long a task is booked for: its length, else its estimate (to the quarter hour), else an hour. Mirrors the backend. */
export function taskMinutes(task) {
  if (task.duration_minutes) return Number(task.duration_minutes);
  const est = Number(task.estimated_hours);
  return est > 0 ? Math.max(15, Math.round(est * 4) * 15) : 60;
}

/**
 * Lay out one day's timed items so overlapping ones sit side by side, like Outlook.
 * items: [{ key, start, end }] in minutes → Map key → { col, cols }.
 */
export function layoutDay(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = new Map();
  let cluster = [];
  let clusterEnd = -1;
  let columns = [];
  const close = () => { for (const it of cluster) out.get(it.key).cols = columns.length; cluster = []; columns = []; };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) close();
    let col = columns.findIndex(end => end <= it.start);
    if (col < 0) { col = columns.length; columns.push(it.end); } else columns[col] = it.end;
    out.set(it.key, { col, cols: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return out;
}

// -- Repeat settings (backend lib/outlook.js toGraphRecurrence / recurrenceSpec) --

export const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const DOW_SHORT = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };
export const WEEK_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const WEEKDAYS = WEEK_ORDER.slice(0, 5);
const NTH = ['first', 'second', 'third', 'fourth', 'last'];
const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

const dowOf = (key) => DOW[fromDayKey(key).getDay()];
const nthOf = (key) => NTH[Math.min(4, Math.ceil(fromDayKey(key).getDate() / 7) - 1)];
const longDay = (d) => d[0].toUpperCase() + d.slice(1);
const sameDays = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));

/** The quick choices for an event starting on `key`, like Outlook's Repeat menu. */
export function repeatPresets(key) {
  const d = fromDayKey(key);
  const dow = dowOf(key);
  return [
    { id: 'none', label: "Doesn't repeat", spec: null },
    { id: 'daily', label: 'Every day', spec: { freq: 'daily', interval: 1, end: 'never' } },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', spec: { freq: 'weekly', interval: 1, days: WEEKDAYS, end: 'never' } },
    { id: 'weekly', label: `Every week on ${longDay(dow)}`, spec: { freq: 'weekly', interval: 1, days: [dow], end: 'never' } },
    { id: 'biweekly', label: `Every 2 weeks on ${longDay(dow)}`, spec: { freq: 'weekly', interval: 2, days: [dow], end: 'never' } },
    { id: 'monthly-day', label: `Every month on day ${d.getDate()}`, spec: { freq: 'monthly', interval: 1, monthly: 'day', end: 'never' } },
    { id: 'monthly-weekday', label: `Every month on the ${nthOf(key)} ${longDay(dow)}`, spec: { freq: 'monthly', interval: 1, monthly: 'weekday', end: 'never' } },
    { id: 'yearly', label: `Every year on ${d.toLocaleDateString([], { month: 'long', day: 'numeric' })}`, spec: { freq: 'yearly', interval: 1, end: 'never' } },
  ];
}

/** Which quick choice a spec is ('custom' if none). */
export function presetOf(spec, key) {
  if (!spec) return 'none';
  if (spec.end && spec.end !== 'never') return 'custom';
  const hit = repeatPresets(key).find(p => p.spec && p.spec.freq === spec.freq && (p.spec.interval ?? 1) === (spec.interval ?? 1)
    && (spec.freq !== 'weekly' || sameDays(p.spec.days, spec.days?.length ? spec.days : [dowOf(key)]))
    && (spec.freq !== 'monthly' || p.spec.monthly === (spec.monthly ?? 'day')));
  return hit?.id ?? 'custom';
}

/** A spec in words: "Every 2 weeks on Mon, Thu, until Dec 31, 2026". */
export function describeRepeat(spec, key) {
  if (!spec) return "Doesn't repeat";
  if (spec.freq === 'other') return 'Repeats (a pattern set in Outlook)';
  const n = spec.interval ?? 1;
  let text = n > 1 ? `Every ${n} ${UNIT[spec.freq]}s` : `Every ${UNIT[spec.freq]}`;
  if (spec.freq === 'weekly') {
    const days = (spec.days?.length ? spec.days : [dowOf(key)]).slice().sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
    text += sameDays(days, WEEKDAYS) && n === 1 ? ' on weekdays' : ` on ${days.map(x => DOW_SHORT[x]).join(', ')}`;
  }
  if (spec.freq === 'monthly') text += spec.monthly === 'weekday' ? ` on the ${nthOf(key)} ${DOW_SHORT[dowOf(key)]}` : ` on day ${fromDayKey(key).getDate()}`;
  if (spec.freq === 'yearly') text += ` on ${fromDayKey(key).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  if (spec.end === 'date' && spec.until) text += `, until ${fromDayKey(spec.until).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if (spec.end === 'count' && spec.count) text += `, ${spec.count} times`;
  return text;
}

/** Whole days from one day key to another. */
export const daysBetweenKeys = (a, b) => Math.round((fromDayKey(b) - fromDayKey(a)) / 86_400_000);
export const shiftKey = (key, n) => dayKey(addDays(fromDayKey(key), n));

/** "Wed, Nov 4 · 9:00 – 10:30 AM" style range for an item. */
export function whenLabel({ allDay, start, end, startKey, endKey }) {
  const day = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (allDay) {
    return startKey === endKey || !endKey ? `${day(fromDayKey(startKey))} · All day` : `${day(fromDayKey(startKey))} – ${day(fromDayKey(endKey))} · All day`;
  }
  const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return dayKey(start) === dayKey(end) ? `${day(start)} · ${t(start)} – ${t(end)}` : `${day(start)} ${t(start)} – ${day(end)} ${t(end)}`;
}
