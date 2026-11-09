import { dayKey, addDays, fromDayKey } from './tasks.js';

// The shared Outlook calendar's events on the Tasks schedule (backend: lib/outlook.js).
// Timed events arrive as UTC instants and land on the viewer's local day; all-day events carry
// start_date / end_date (inclusive).

const MAX_DAYS = 62;
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The local days ("YYYY-MM-DD") an event covers. One ending at midnight doesn't cover the next day. */
export function eventDayKeys(ev) {
  let day;
  let last;
  if (ev.all_day) {
    day = fromDayKey(ev.start_date);
    last = fromDayKey(ev.end_date ?? ev.start_date);
  } else {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const end = e > s ? new Date(e.getTime() - 1) : s;
    last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  }
  const keys = [];
  for (let i = 0; day <= last && i < MAX_DAYS; i++, day = addDays(day, 1)) keys.push(dayKey(day));
  return keys;
}

/**
 * The edit that moves an event to start on another day, keeping its times of day and its length
 * (across daylight saving too) - null when it already starts that day.
 */
export function movedEvent(ev, key) {
  const first = eventDayKeys(ev)[0];
  if (!first || first === key) return null;
  const delta = Math.round((fromDayKey(key) - fromDayKey(first)) / 86_400_000);
  if (ev.all_day) {
    return { all_day: true, start_date: dayKey(addDays(fromDayKey(ev.start_date), delta)), end_date: dayKey(addDays(fromDayKey(ev.end_date ?? ev.start_date), delta)) };
  }
  return { all_day: false, start: addDays(new Date(ev.start), delta).toISOString(), end: addDays(new Date(ev.end), delta).toISOString() };
}

/** "9:00 AM" or "All day". */
export const eventStart = (ev) => (ev.all_day ? 'All day' : time(ev.start));

/** "9:00 AM – 11:00 AM" / "All day". */
export const eventRange = (ev) => (ev.all_day ? 'All day' : `${time(ev.start)} – ${time(ev.end)}`);

/** All-day first, then by start time. */
export const eventOrder = (a, b) => (b.all_day - a.all_day) || String(a.start).localeCompare(String(b.start));

/** day key → that day's events, sorted. */
export function eventsByDay(events) {
  const map = new Map();
  for (const ev of events) {
    for (const k of eventDayKeys(ev)) { if (!map.has(k)) map.set(k, []); map.get(k).push(ev); }
  }
  for (const list of map.values()) list.sort(eventOrder);
  return map;
}
