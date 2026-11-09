// Renewal-date math for auto-renewing licenses (mirrors backend lib/renewal.js).
//
// Auto-renewing subscriptions store an anchor expiration date + interval ('monthly' |
// 'annually'). The next renewal is computed on the fly: roll the anchor forward by whole
// intervals until it lands on or after today. All math is from the ORIGINAL anchor
// (anchor + k intervals), with the day clamped to the target month's length — so a
// Jan-31 anchor yields Feb-28, Mar-31, Apr-30… (no drift) and a Feb-29 annual anchor
// lands on Feb-28 in common years.

import { cadenceLabel, coerceIntervalCount } from './cadence.js';

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Parse 'YYYY-MM-DD' (the API date form) into a local-midnight Date, ignoring any time
// so we never drift a day across timezones.
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return startOfDay(value);
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

function addMonths(date, n) {
  const total = date.getMonth() + n;
  const year = date.getFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return new Date(year, month, Math.min(date.getDate(), daysInMonth(year, month)));
}

function addYears(date, n) {
  const year = date.getFullYear() + n;
  return new Date(year, date.getMonth(), Math.min(date.getDate(), daysInMonth(year, date.getMonth())));
}

// The next renewal Date on or after today, for an auto-renewing license. Returns null if
// the anchor is unparseable. A future anchor is returned unchanged.
//
// `count` is how many intervals pass between renewals — 1 for a plain annual
// subscription, 3 for a domain registered three years at a time. Steps are whole
// multiples of (count × interval) from the ORIGINAL anchor, so a three-year cycle keeps
// landing on the same month/day every third year.
export function nextRenewal(anchorValue, interval, from = new Date(), count = 1) {
  const step = coerceIntervalCount(count, interval);
  const anchor = parseDate(anchorValue);
  if (!anchor) return null;
  const today = startOfDay(from);
  if (anchor >= today) return anchor;

  if (interval === 'annually') {
    let k = Math.max(0, Math.floor((today.getFullYear() - anchor.getFullYear()) / step));
    let next = addYears(anchor, k * step);
    while (next < today) next = addYears(anchor, ++k * step);
    return next;
  }
  const months = (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth());
  let k = months > 0 ? Math.floor(months / step) : 0;
  let next = addMonths(anchor, k * step);
  while (next < today) next = addMonths(anchor, ++k * step);
  return next;
}

// "Monthly" | "Annually" | "Every 3 years".
export const intervalLabel = (interval, count = 1) => cadenceLabel(interval, count);

// nextRenewal() for a license row straight off the API.
export const nextRenewalFor = (license, from = new Date()) =>
  nextRenewal(license?.renewal_date, license?.renewal_interval, from, license?.renewal_interval_count);
