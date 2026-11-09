// The shared Outlook calendar on the Tasks schedule. The Portal shows its events beside the
// tasks and can edit them (time, title, location, notes, who it's for) - but never turns an
// event into a task. Separately, "Add to Outlook" puts a task on the calendar as an all-day
// event the Portal keeps in step with the task.
//
// Reading: Microsoft Graph returns { start: { dateTime, timeZone } }. The client asks for UTC
// (Prefer: outlook.timezone="UTC"), so a timed event becomes an ISO instant and the browser
// places it on its own local day. An all-day event's end is exclusive (Mon all-day ends Tue
// 00:00), so `end_date` is the last day it covers. calendarView expands repeating events into
// their occurrences.
//
// Writing: times go to Graph as wall-clock time in the office's time zone (OUTLOOK_TIME_ZONE,
// an IANA name, sent to Graph by its Windows name), so a repeating event keeps its local time
// across daylight saving and all-day events land on the right day for everyone.
//
// Who an event is for: an Outlook category naming a tech wins ("Riley Morgan"); otherwise a name
// in its title. Assigning from the Portal sets that category, so Outlook users see it too.

const DAY = 86_400_000;
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Graph's "2026-11-03T14:00:00.0000000" (UTC) → "2026-11-03T14:00:00Z". */
export function utcIso(dt) {
  const m = clean(dt?.dateTime ?? dt).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}Z` : null;
}

const nextDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/** The last day an all-day event covers, from its start date and exclusive end date. */
export function lastDay(startDate, endExclusive) {
  if (!endExclusive || endExclusive <= startDate) return startDate;
  return new Date(Date.parse(`${endExclusive}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

const norm = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which techs a piece of text names: "Dana @ Northwind", "Riley off". A full name always counts;
 * a first name counts when no other tech shares it and it's at least 3 letters (so "Al" never
 * matches "AL"). Initials are never used - "IT", "PC" and "DG" are too easy to hit by accident.
 * Ordered by where the name first appears, so the first person mentioned colours the event.
 */
export function matchTechs(text, users) {
  const hay = ` ${norm(text)} `;
  const first = (u) => norm(u.full_name).split(' ')[0] ?? '';
  const firstCount = new Map();
  for (const u of users) { const f = first(u); if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
  const hits = [];
  for (const u of users) {
    const full = norm(u.full_name);
    const f = first(u);
    let at = full.includes(' ') ? hay.indexOf(` ${full} `) : -1;
    if (at < 0 && f.length >= 3 && firstCount.get(f) === 1) at = hay.indexOf(` ${f} `);
    if (at >= 0) hits.push({ id: u.id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.id);
}

/** Who an event is for: the techs its categories name, else the techs its title names. */
export function eventTechs(subject, categories, users) {
  const byCategory = matchTechs((categories ?? []).join(' | '), users);
  return byCategory.length ? byCategory : matchTechs(subject ?? '', users);
}

const isPrivate = (raw) => ['private', 'confidential'].includes(String(raw?.sensitivity ?? '').toLowerCase());

/**
 * One Graph event → what the schedule shows, or null for a cancelled or unreadable one.
 * Private events keep their time and whose they are but not their title or location, and the
 * Portal won't edit them.
 */
export function normalizeEvent(raw, users = []) {
  if (!raw || raw.isCancelled) return null;
  const start = utcIso(raw.start);
  if (!start) return null;
  const end = utcIso(raw.end) ?? start;
  const hidden = isPrivate(raw);
  const categories = Array.isArray(raw.categories) ? raw.categories.map(clean).filter(Boolean) : [];
  const ev = {
    id: raw.id,
    title: hidden ? 'Private appointment' : (clean(raw.subject) || '(No title)'),
    all_day: Boolean(raw.isAllDay),
    start,
    end,
    location: hidden ? null : (clean(raw.location?.displayName) || null),
    show_as: raw.showAs ?? null,
    private: hidden,
    user_ids: eventTechs(raw.subject, categories, users),
    // A repeating event's occurrences (and edited ones, "exceptions") point at their series.
    recurring: Boolean(raw.seriesMasterId) || ['occurrence', 'exception'].includes(raw.type),
    series_id: raw.seriesMasterId ?? null,
    etag: raw['@odata.etag'] ?? null,
  };
  if (ev.all_day) {
    ev.start_date = start.slice(0, 10);
    ev.end_date = lastDay(ev.start_date, end.slice(0, 10));
  }
  return ev;
}

export const normalizeEvents = (list, users) => (list ?? []).map(e => normalizeEvent(e, users)).filter(Boolean);

// -- Writing ------------------------------------------------------------------------------

// Graph wants Windows time-zone names. The usual US zones; anything else is passed as given.
const WINDOWS_ZONES = {
  'America/Chicago': 'Central Standard Time', 'America/New_York': 'Eastern Standard Time',
  'America/Denver': 'Mountain Standard Time', 'America/Phoenix': 'US Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time', 'America/Anchorage': 'Alaskan Standard Time',
  'Pacific/Honolulu': 'Hawaiian Standard Time', UTC: 'UTC', 'Etc/UTC': 'UTC',
};
export const windowsZone = (iana) => WINDOWS_ZONES[iana] ?? iana;

/** An instant as wall-clock time in an IANA zone: "2026-11-05T09:00:00". */
export function wallClock(iso, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export const graphTime = (iso, zone) => ({ dateTime: wallClock(iso, zone), timeZone: windowsZone(zone) });
export const graphDate = (date, zone) => ({ dateTime: `${date}T00:00:00`, timeZone: windowsZone(zone) });

/** An event's categories with its tech set to `user` (or nobody): categories naming any tech are replaced. */
export function assignCategories(categories, user, users) {
  const keep = (categories ?? []).filter(c => !matchTechs(c, users).length);
  return user ? [...keep, user.full_name] : keep;
}

export const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validInstant = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const fail = (error) => ({ ok: false, error });

const DOW_BY_INDEX = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const dowOf = (date) => DOW_BY_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** "HH:MM" on a date plus some minutes → { date, time } (wall-clock arithmetic). */
function addMinutesWall(date, hhmm, minutes) {
  const iso = new Date(Date.parse(`${date}T${hhmm}:00Z`) + minutes * 60_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
/** The office-time day and time an event starts / ends. An all-day one's date is its own (no zone shift). */
function eventWall(raw, which, zone) {
  const iso = utcIso(raw?.[which]);
  if (!iso) return null;
  return raw.isAllDay ? `${iso.slice(0, 10)}T00:00:00` : wallClock(iso, zone);
}

// -- Repeating events --
// The Portal's repeat settings ⇄ Graph's recurrence:
//   { freq: 'daily' | 'weekly' | 'monthly' | 'yearly', interval (1–99),
//     days: ['monday', …]          (weekly; "every weekday" is weekly Mon–Fri)
//     monthly: 'day' | 'weekday'   (on day 4 / on the first Wednesday - from the start date)
//     end: 'never' | 'date' | 'count', until: 'YYYY-MM-DD', count }
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const NTH = ['first', 'second', 'third', 'fourth', 'last'];

/** The repeat settings as a Graph recurrence starting on `startDate`; recurrence null = doesn't repeat. */
export function toGraphRecurrence(spec, startDate, zone) {
  if (!spec || !spec.freq || spec.freq === 'none') return { ok: true, recurrence: null };
  const interval = Number(spec.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return fail('Repeat every 1 to 99.');
  const d = new Date(`${startDate}T00:00:00Z`);
  let pattern;
  if (spec.freq === 'daily') pattern = { type: 'daily', interval };
  else if (spec.freq === 'weekly') {
    const days = [...new Set(spec.days?.length ? spec.days : [dowOf(startDate)])];
    if (days.some(x => !DOW_BY_INDEX.includes(x))) return fail('Unknown weekday.');
    pattern = { type: 'weekly', interval, daysOfWeek: days, firstDayOfWeek: 'sunday' };
  } else if (spec.freq === 'monthly') {
    pattern = spec.monthly === 'weekday'
      ? { type: 'relativeMonthly', interval, daysOfWeek: [dowOf(startDate)], index: NTH[Math.min(4, Math.ceil(d.getUTCDate() / 7) - 1)] }
      : { type: 'absoluteMonthly', interval, dayOfMonth: d.getUTCDate() };
  } else if (spec.freq === 'yearly') pattern = { type: 'absoluteYearly', interval, month: d.getUTCMonth() + 1, dayOfMonth: d.getUTCDate() };
  else return fail('Unknown repeat.');

  const range = { type: 'noEnd', startDate, recurrenceTimeZone: windowsZone(zone) };
  if (spec.end === 'date') {
    if (!DATE_RE.test(spec.until ?? '') || spec.until < startDate) return fail('The repeat must end on or after its first day.');
    Object.assign(range, { type: 'endDate', endDate: spec.until });
  } else if (spec.end === 'count') {
    const c = Number(spec.count);
    if (!Number.isInteger(c) || c < 1 || c > 999) return fail('Repeat 1 to 999 times.');
    Object.assign(range, { type: 'numbered', numberOfOccurrences: c });
  }
  return { ok: true, recurrence: { pattern, range } };
}

/** A Graph recurrence as the editor's repeat settings (freq 'other' = a pattern it can only describe). */
export function recurrenceSpec(recurrence) {
  const p = recurrence?.pattern;
  if (!p?.type) return null;
  const r = recurrence.range ?? {};
  const spec = {
    interval: Number(p.interval) || 1,
    end: r.type === 'endDate' ? 'date' : r.type === 'numbered' ? 'count' : 'never',
    until: r.type === 'endDate' ? r.endDate ?? null : null,
    count: r.type === 'numbered' ? r.numberOfOccurrences ?? null : null,
  };
  const kinds = {
    daily: { freq: 'daily' },
    weekly: { freq: 'weekly', days: p.daysOfWeek ?? [] },
    absoluteMonthly: { freq: 'monthly', monthly: 'day' },
    relativeMonthly: { freq: 'monthly', monthly: 'weekday' },
    absoluteYearly: { freq: 'yearly' },
  };
  return { ...spec, ...(kinds[p.type] ?? { freq: 'other' }) };
}

/**
 * "Delete this and following": the series' recurrence ended the day before `occurrence`. If that
 * occurrence is the first one, the whole series goes instead ({ deleteSeries: true }).
 */
export function endSeriesBefore(master, occurrence, zone) {
  const r = master?.recurrence;
  if (!r?.pattern || !r.range?.startDate) return fail("That event doesn't repeat.");
  const last = shiftDate(eventWall(occurrence, 'start', zone).slice(0, 10), -1);
  if (last < r.range.startDate) return { ok: true, deleteSeries: true };
  return {
    ok: true,
    patch: { recurrence: { pattern: r.pattern, range: { type: 'endDate', startDate: r.range.startDate, endDate: last, recurrenceTimeZone: r.range.recurrenceTimeZone ?? windowsZone(zone) } } },
  };
}

/**
 * The Graph PATCH for an edit made in the Portal. Only the fields sent are changed.
 *   title, location, notes, show_as
 *   assign_to         - a user id, or null for nobody (sets the categories)
 *   reminder_minutes  - minutes before the start, or null for no reminder
 *   one event:  all_day + start_date/end_date (inclusive) or start/end (ISO instants)
 *   a series:   start_time/end_time ("HH:MM", both), shift_days (move every event that many days
 *               - the pattern moves with it), repeat (new repeat settings)
 * `current` is the event (or series) as Graph has it: { categories, isAllDay, start, end, recurrence }.
 */
export function eventPatch(input, current, { zone, users, series = false }) {
  const patch = {};
  if (input.title !== undefined) {
    const t = clean(input.title);
    if (!t) return fail('Give the event a title.');
    patch.subject = t.slice(0, 255);
  }
  if (input.location !== undefined) patch.location = { displayName: clean(input.location).slice(0, 255) };
  if (input.notes !== undefined) patch.body = { contentType: 'text', content: String(input.notes ?? '').slice(0, 20000) };
  if (input.show_as !== undefined) {
    if (!SHOW_AS.includes(input.show_as)) return fail('Unknown "show as" value.');
    patch.showAs = input.show_as;
  }
  if (input.assign_to !== undefined) {
    const user = input.assign_to ? users.find(u => String(u.id) === String(input.assign_to)) : null;
    if (input.assign_to && !user) return fail('Unknown technician.');
    patch.categories = assignCategories(current?.categories, user, users);
  }
  if (input.reminder_minutes !== undefined) {
    if (input.reminder_minutes === null || input.reminder_minutes === '') patch.isReminderOn = false;
    else {
      const m = Number(input.reminder_minutes);
      if (!Number.isInteger(m) || m < 0 || m > 40320) return fail('A reminder must be between 0 minutes and 4 weeks before.');
      Object.assign(patch, { isReminderOn: true, reminderMinutesBeforeStart: m });
    }
  }

  if (series) {
    const timed = input.start_time !== undefined || input.end_time !== undefined;
    const shift = input.shift_days === undefined ? 0 : Number(input.shift_days);
    if (!Number.isInteger(shift) || Math.abs(shift) > 366) return fail('Move it by up to a year.');
    if (timed) {
      if (current?.isAllDay) return fail('This series is all-day — change it to timed in Outlook.');
      if (!TIME_RE.test(input.start_time ?? '') || !TIME_RE.test(input.end_time ?? '')) return fail('Times must look like 09:30.');
      if (input.end_time <= input.start_time) return fail('The end time must be after the start time.');
    }
    if (timed || shift) {
      const day = shiftDate(eventWall(current, 'start', zone).slice(0, 10), shift);
      if (current.isAllDay) {
        Object.assign(patch, { start: graphDate(day, zone), end: graphDate(shiftDate(eventWall(current, 'end', zone).slice(0, 10), shift), zone) });
      } else {
        const st = input.start_time ?? eventWall(current, 'start', zone).slice(11, 16);
        const length = timed ? null : (Date.parse(`${eventWall(current, 'end', zone)}Z`) - Date.parse(`${eventWall(current, 'start', zone)}Z`)) / 60_000;
        const end = timed ? { date: day, time: input.end_time } : addMinutesWall(day, st, length);
        patch.start = { dateTime: `${day}T${st}:00`, timeZone: windowsZone(zone) };
        patch.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: windowsZone(zone) };
      }
    }
    if (shift && input.repeat === undefined) {
      // The pattern moves with it: weekly days shift; daily needs nothing; monthly/yearly can't follow a drag.
      const r = current.recurrence;
      if (!r?.pattern) return fail("That event doesn't repeat.");
      const p = { ...r.pattern };
      if (p.type === 'weekly') p.daysOfWeek = (p.daysOfWeek ?? []).map(d => DOW_BY_INDEX[(DOW_BY_INDEX.indexOf(d) + (shift % 7) + 7) % 7]);
      else if (p.type !== 'daily') return fail("A monthly or yearly series can't be dragged to another day — move just this event, or change the series' repeat settings.");
      patch.recurrence = { pattern: p, range: { ...r.range, startDate: shiftDate(r.range.startDate, shift) } };
    }
    if (input.repeat !== undefined) {
      if (!input.repeat || input.repeat.freq === 'none') return fail('To stop a series, delete "this and following" events instead.');
      if (input.repeat.freq === 'other') return fail('Pick how it repeats.');
      const startDate = patch.start ? patch.start.dateTime.slice(0, 10) : current.recurrence?.range?.startDate ?? eventWall(current, 'start', zone).slice(0, 10);
      const rec = toGraphRecurrence(input.repeat, startDate, zone);
      if (!rec.ok) return rec;
      patch.recurrence = rec.recurrence;
    }
  } else if (input.all_day === true) {
    if (!DATE_RE.test(input.start_date ?? '') || !DATE_RE.test(input.end_date ?? '')) return fail('Pick the start and end dates.');
    if (input.end_date < input.start_date) return fail('The end date must be on or after the start date.');
    Object.assign(patch, { isAllDay: true, start: graphDate(input.start_date, zone), end: graphDate(nextDay(input.end_date), zone) });
  } else if (input.all_day === false) {
    if (!validInstant(input.start) || !validInstant(input.end)) return fail('Pick the start and end times.');
    if (Date.parse(input.end) <= Date.parse(input.start)) return fail('The end must be after the start.');
    Object.assign(patch, { isAllDay: false, start: graphTime(input.start, zone), end: graphTime(input.end, zone) });
  }
  if (!Object.keys(patch).length) return fail('Nothing to change.');
  return { ok: true, patch };
}

/** A new event made in the Portal: the same fields as an edit, plus `repeat`. Busy unless told otherwise. */
export function eventCreate(input, { zone, users }) {
  if (input.all_day === undefined) return fail('Pick when it is.');
  const base = eventPatch({ ...input, title: input.title ?? '' }, { categories: [] }, { zone, users });
  if (!base.ok) return base;
  const startDate = input.all_day ? input.start_date : wallClock(input.start, zone).slice(0, 10);
  const rec = toGraphRecurrence(input.repeat, startDate, zone);
  if (!rec.ok) return rec;
  return { ok: true, event: { showAs: 'busy', ...base.patch, ...(rec.recurrence ? { recurrence: rec.recurrence } : {}) } };
}

const DOW = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };
const DOW_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const every = (n, unit) => (n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`);

/** A Graph recurrence in words: "Every week on Tue, Thu until Dec 31, 2026". */
export function recurrenceText(recurrence) {
  const p = recurrence?.pattern;
  if (!p?.type) return null;
  const n = Number(p.interval) || 1;
  const days = (p.daysOfWeek ?? []).slice().sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b)).map(d => DOW[d] ?? d);
  const nth = p.index && p.index !== 'first' ? p.index : 'first';
  let text = {
    daily: () => every(n, 'day'),
    weekly: () => `${every(n, 'week')}${days.length ? ` on ${days.join(', ')}` : ''}`,
    absoluteMonthly: () => `${every(n, 'month')} on day ${p.dayOfMonth}`,
    relativeMonthly: () => `${every(n, 'month')} on the ${nth} ${days.join('/')}`,
    absoluteYearly: () => `Every year on ${MONTHS[(p.month ?? 1) - 1]} ${p.dayOfMonth}`,
    relativeYearly: () => `Every year on the ${nth} ${days.join('/')} of ${MONTHS[(p.month ?? 1) - 1]}`,
  }[p.type]?.() ?? 'Repeats';
  const r = recurrence.range ?? {};
  if (r.type === 'endDate' && DATE_RE.test(r.endDate ?? '')) {
    const [y, m, d] = r.endDate.split('-').map(Number);
    text += ` until ${MONTHS[m - 1]} ${d}, ${y}`;
  } else if (r.type === 'numbered' && r.numberOfOccurrences) {
    text += `, ${r.numberOfOccurrences} times`;
  }
  return text;
}

const tNum = (n) => `T-${String(n).padStart(5, '0')}`;
const htmlText = (html) => String(html ?? '').replace(/<(br|\/p|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/** How long a task is booked for on the calendar: its length, else its estimate (to the quarter hour), else an hour. */
export function taskMinutes(task) {
  if (task.duration_minutes) return Number(task.duration_minutes);
  const est = Number(task.estimated_hours);
  return est > 0 ? Math.max(15, Math.round(est * 4) * 15) : 60;
}

/**
 * The event "Add to Outlook" puts on the calendar for a task (and rewrites whenever the task
 * changes): at its time for its length (busy), or all-day and free when it has no time, so a
 * date-only task never blocks anyone's real appointments. The tech is a category, like an event
 * assigned from the Portal.
 */
export function taskEvent(task, { zone }) {
  const first = clean(task.assigned_to_name).split(' ')[0];
  const subject = `${first ? `${first}: ` : ''}${clean(task.title)}${task.customer_name ? ` — ${clean(task.customer_name)}` : ''} (${tNum(task.number)})`;
  const date = task.scheduled_day ?? String(task.scheduled_date instanceof Date ? localDate(task.scheduled_date) : task.scheduled_date).slice(0, 10);
  const time = task.scheduled_hm ?? (task.scheduled_time ? String(task.scheduled_time).slice(0, 5) : null);
  const lines = [
    `Task ${tNum(task.number)} — edit it in the Portal. Changes made to this event in Outlook are replaced the next time the task changes.`,
    '',
    task.customer_name ? `Customer: ${task.customer_name}` : 'Internal',
    task.assigned_to_name ? `Assigned to: ${task.assigned_to_name}` : 'Unassigned',
    `Priority: ${task.priority ?? 'normal'}`,
    task.estimated_hours ? `Estimate: ${Number(task.estimated_hours)}h` : null,
  ].filter(l => l !== null);
  const notes = htmlText(task.notes);
  if (notes) lines.push('', notes.slice(0, 4000));
  const end = time ? addMinutesWall(date, time, taskMinutes(task)) : null;
  return {
    subject: subject.slice(0, 255),
    ...(time
      ? { isAllDay: false, start: { dateTime: `${date}T${time}:00`, timeZone: windowsZone(zone) }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone: windowsZone(zone) }, showAs: 'busy' }
      : { isAllDay: true, start: graphDate(date, zone), end: graphDate(nextDay(date), zone), showAs: 'free' }),
    isReminderOn: false,
    categories: task.assigned_to_name ? [clean(task.assigned_to_name)] : [],
    body: { contentType: 'text', content: lines.join('\n') },
  };
}

// pg returns DATE columns as a local-midnight Date.
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether a task change means its Outlook event needs rewriting (a status change alone doesn't). */
export const TASK_EVENT_FIELDS = ['title', 'scheduled_date', 'scheduled_time', 'duration_minutes', 'assigned_to', 'customer_id', 'notes', 'priority', 'estimated_hours'];
export function taskEventChanged(before, after) {
  const v = (x) => (x instanceof Date ? localDate(x) : x == null ? null : String(x));
  return TASK_EVENT_FIELDS.some(f => v(before?.[f]) !== v(after?.[f]));
}
