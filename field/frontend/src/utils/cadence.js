// Service billing cadences (mirrors the backend's lib/work-order-logic.js helpers and
// the Portal's utils/cadence.js).
//
// A recurring service carries a base period plus an INTERVAL COUNT: how many of those
// periods pass between bills. Count 1 is the ordinary case and the default, so nothing
// captured before this existed changes.
//
// Only a YEARLY period may carry a count above 1 — "every 3 years" for a domain
// registration or a multi-year cert. The Portal enforces the same rule, so whatever is
// captured here survives the import to a real work order unchanged.

export const MAX_INTERVAL_COUNT = 50;

// Both spellings: the Field app and the Portal's service catalog store 'annual',
// the Portal's recurring charges store 'annually'.
export const isAnnualCadence = (recurrence) => recurrence === 'annual' || recurrence === 'annually';

export function coerceIntervalCount(value, recurrence) {
  if (!isAnnualCadence(recurrence)) return 1;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_INTERVAL_COUNT);
}

const LABEL = {
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  semiannual: 'Semi-annual',
  annual:     'Annual',
  annually:   'Annual',
};

// "Monthly", "Annual", "every 3 years".
export function cadenceLabel(recurrence, count = 1) {
  const n = coerceIntervalCount(count, recurrence);
  if (n > 1) return `every ${n} years`;
  return LABEL[recurrence] ?? recurrence ?? '';
}
