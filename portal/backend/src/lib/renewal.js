// Renewal-date math for auto-renewing licenses.
//
// Auto-renewing subscriptions store an *anchor* expiration date plus an interval
// ('monthly' | 'annually'). Instead of mutating the stored date every cycle (which
// would need a cron job), we compute the next renewal on the fly: roll the anchor
// forward by whole intervals until it lands on or after `from` (today).
//
// All math is done from the ORIGINAL anchor (anchor + k intervals), never by
// iterating off the previous result - so a Jan-31 anchor yields Feb-28, Mar-31,
// Apr-30… instead of drifting to the 28th forever. Day-of-month is clamped to the
// target month's length, which also makes a Feb-29 annual anchor land on Feb-28 in
// common years.

import { coerceIntervalCount } from './cadence.js';

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Parse a DATE coming from Postgres (a JS Date, or a 'YYYY-MM-DD' string) into a
// local-midnight Date, ignoring any time/zone so we never drift a day.
function parseAnchor(value) {
  if (!value) return null;
  if (value instanceof Date) return startOfDay(value);
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// Add `n` months to `date`, clamping the day to the target month's length.
function addMonths(date, n) {
  const total = date.getMonth() + n;
  const year = date.getFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(date.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
}

// Add `n` years, clamping Feb-29 → Feb-28 in non-leap years.
function addYears(date, n) {
  const year = date.getFullYear() + n;
  const day = Math.min(date.getDate(), daysInMonth(year, date.getMonth()));
  return new Date(year, date.getMonth(), day);
}

// The next renewal date on or after `from` (default: today), for an auto-renewing
// license. Returns a Date, or null if the anchor can't be parsed. A future anchor is
// returned unchanged (the subscription hasn't reached its first renewal yet).
//
// `count` is how many intervals pass between renewals - 1 for a plain annual
// subscription, 3 for a domain registered three years at a time. Steps are always
// whole multiples of (count × interval) measured from the ORIGINAL anchor, so a
// three-year cycle lands on the same month/day every third year with no drift.
export function nextRenewal(anchorValue, interval, from = new Date(), count = 1) {
  const step = coerceIntervalCount(count, interval);
  const anchor = parseAnchor(anchorValue);
  if (!anchor) return null;
  const today = startOfDay(from);
  if (anchor >= today) return anchor;

  if (interval === 'annually') {
    let k = Math.floor((today.getFullYear() - anchor.getFullYear()) / step);
    if (k < 0) k = 0;
    let next = addYears(anchor, k * step);
    while (next < today) next = addYears(anchor, ++k * step);
    return next;
  }

  // monthly (default for any auto-renew without an explicit annual interval)
  const months = (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth());
  let k = months > 0 ? Math.floor(months / step) : 0;
  let next = addMonths(anchor, k * step);
  while (next < today) next = addMonths(anchor, ++k * step);
  return next;
}

// 'YYYY-MM-DD' string for a Date (local parts), for JSON responses.
export function toDateStr(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
