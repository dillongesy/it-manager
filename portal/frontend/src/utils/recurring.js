// Helpers for the customer recurring-billing tracker.
//
// Charges are month-granular (they bill "in November", not on a specific day), so the
// next-due math is a simple walk over the next 12 months - no day clamping or leap-year
// edge cases to worry about, unlike the license renewal math.
//
// The exception is a MULTI-YEAR charge (a domain bought three years at a time). A month
// alone can't place one - "November" could be 2027 or 2029 - so those also carry a year
// anchor and step forward in whole N-year jumps from it. See utils/cadence.js for the
// cadence vocabulary itself.

import {
  cadenceLabel, cadenceUnit, perYear, coerceIntervalCount, needsYearAnchor,
  MAX_INTERVAL_COUNT, YEAR_COUNT_OPTIONS,
} from './cadence.js';

export { cadenceLabel, cadenceUnit, perYear, coerceIntervalCount, needsYearAnchor, MAX_INTERVAL_COUNT, YEAR_COUNT_OPTIONS };

export const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annually'];

export const FREQ_LABEL = {
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  semiannual: 'Semi-annual',
  annually:   'Annually',
};

// Step in months between occurrences for periodic (non-monthly) charges.
const FREQ_STEP = { quarterly: 3, semiannual: 6, annually: 12 };

export const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }),
}));

// The next month a charge is due, as { year, month(1-12) }, on or after `from` (the
// current month counts). Returns null for monthly charges (they bill every month) or
// when there's no anchor month.
export function nextDue(frequency, billingMonth, from = new Date(), { count = 1, billingYear = null } = {}) {
  if (!billingMonth) return null;
  const n = coerceIntervalCount(count, frequency);
  const curY = from.getFullYear();
  const curM = from.getMonth() + 1;

  if (n > 1) {
    // Multi-year: one fixed anchor stepped by whole N-year jumps, so the cycle can't
    // drift. A missing year anchor falls back to this year - the API always stores one,
    // but a row imported or edited by hand shouldn't render as "no next due".
    const step = 12 * n;
    const anchorIdx = (billingYear ?? curY) * 12 + (billingMonth - 1);
    const nowIdx = curY * 12 + (curM - 1);
    const k = nowIdx <= anchorIdx ? 0 : Math.ceil((nowIdx - anchorIdx) / step);
    const idx = anchorIdx + k * step;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  const step = FREQ_STEP[frequency];
  if (!step) return null;

  // All the months this charge lands on within a year.
  const occ = new Set();
  for (let k = 0; k < 12 / step; k++) {
    occ.add(((billingMonth - 1 + k * step) % 12) + 1);
  }

  for (let i = 0; i < 12; i++) {
    const m = ((curM - 1 + i) % 12) + 1;
    const y = curY + Math.floor((curM - 1 + i) / 12);
    if (occ.has(m)) return { year: y, month: m };
  }
  return null;
}

// nextDue() for a charge row straight off the API - the four schedule fields always
// travel together, so callers shouldn't have to remember to pass all of them.
export const nextDueFor = (charge, from = new Date()) =>
  nextDue(charge?.frequency, charge?.billing_month, from,
    { count: charge?.interval_count, billingYear: charge?.billing_year });

// "Nov 2026" for a { year, month } from nextDue().
export function nextDueLabel(due) {
  if (!due) return null;
  return new Date(due.year, due.month - 1, 1)
    .toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// How a charge's cadence reads: "Monthly", "Annually", "Every 3 years".
export const chargeCadence = (charge) => cadenceLabel(charge?.frequency, charge?.interval_count);

// Price suffix for a charge: 'mo', 'yr', '3yr'…
export const chargeUnit = (charge) => cadenceUnit(charge?.frequency, charge?.interval_count);

// Annualized dollar total of a set of charges - each amount times how often it bills
// per year. A charge billed every 3 years contributes a THIRD of its amount, which is
// the whole reason the interval count has to reach these totals.
export function annualizedTotal(charges) {
  return charges.reduce((sum, c) => {
    const amt = parseFloat(c.amount) || 0;
    return sum + amt * perYear(c.frequency, c.interval_count);
  }, 0);
}

export const money = (n) => `$${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
