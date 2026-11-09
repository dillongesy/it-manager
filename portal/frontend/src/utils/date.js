// Formatting for date-only values (Postgres DATE columns).
//
// A DATE column arrives at the frontend as a UTC-anchored ISO string
// (e.g. "2026-07-07T00:00:00.000Z"). Formatting it with `new Date(str).toLocaleDateString()`
// in a US (UTC-negative) timezone rolls it back a day. These helpers take the calendar-date
// portion ("YYYY-MM-DD") and build a LOCAL Date so the displayed day matches what was entered.
//
// Only use these for date-only values. Real timestamps (created_at, submitted_at, …) represent
// an actual instant and should keep using `new Date(x).toLocaleString/Date()` directly.

// Parse a date-only value into a local-midnight Date. Accepts a 'YYYY-MM-DD[...]' string or a
// Date. Returns null when the value is empty/unparseable.
export function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Locale date string for a date-only value, timezone-safe. Empty string when missing.
// `opts` is forwarded to toLocaleDateString (e.g. { month: 'short', day: 'numeric', year: 'numeric' }).
export function formatDate(value, opts) {
  const d = parseDateOnly(value);
  return d ? d.toLocaleDateString(undefined, opts) : '';
}

// A <input type="date"> can hold a SIX-digit year, and Postgres DATE accepts it, so a
// fat-fingered "20207-07-15" stores happily. It comes back as an expanded-year ISO
// string ("+020207-07-15T…"), where the old `value.slice(0, 10)` yields "+020207-07" —
// which the date input silently rejects (renders blank) while the form still holds it,
// so every later save of that record fails in Postgres with
// `time zone displacement out of range`. Even a plain rename becomes impossible.
//
// toDateInput() is the safe replacement: a real 'YYYY-MM-DD' or '' — never a string the
// input can't show and the API can't accept.
export const MIN_INPUT_YEAR = 1900;
export const MAX_INPUT_YEAR = 9999;

export function toDateInput(value) {
  const d = parseDateOnly(value);
  if (!d) return '';
  const y = d.getFullYear();
  if (y < MIN_INPUT_YEAR || y > MAX_INPUT_YEAR) return '';
  return [
    String(y).padStart(4, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

// True when a stored value exists but can't be shown in a date input (corrupt/out of
// range). Forms use this to say so out loud instead of silently blanking the field —
// otherwise the next save would quietly erase a date the user never touched.
export function isUnusableDate(value) {
  return !!value && toDateInput(value) === '';
}

// Today as a 'YYYY-MM-DD' input value, in LOCAL time. (`new Date().toISOString()
// .slice(0,10)` is UTC — after ~7pm in US timezones it hands back tomorrow.)
export function todayInput() {
  return toDateInput(new Date());
}
