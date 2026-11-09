// Billing cadences, including "every N years" (mirrors backend lib/cadence.js).
//
// Every recurring thing in the Portal — a catalog service, a customer's recurring
// charge, an auto-renewing license — has a BASE period (monthly / quarterly /
// semiannual / annual) plus an INTERVAL COUNT: how many of those periods pass
// between bills. Count 1 is the ordinary case and the default everywhere, so
// anything entered before this existed behaves exactly as it always did.
//
// Only the ANNUAL cadence exposes a count above 1 ("every 3 years" — domain
// registrations, multi-year SSL certs, extended warranties). Both spellings of the
// yearly period are accepted: the service catalog and work orders store 'annual',
// customer recurring charges store 'annually'.

export const MAX_INTERVAL_COUNT = 50;

const BASE_LABEL = {
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  semiannual: 'Semi-annual',
  annual:     'Annually',
  annually:   'Annually',
};
const BASE_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1, annually: 1 };
const BASE_UNIT = { monthly: 'mo', quarterly: 'qtr', semiannual: '6mo', annual: 'yr', annually: 'yr' };

export const isAnnual = (frequency) => frequency === 'annual' || frequency === 'annually';

// Clamp a count to a whole number of periods. Anything unparseable, below 1, or
// attached to a non-annual period collapses to 1 (the ordinary cadence).
export function coerceIntervalCount(value, frequency) {
  if (!isAnnual(frequency)) return 1;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_INTERVAL_COUNT);
}

// "Monthly", "Annually", "Every 3 years".
export function cadenceLabel(frequency, count = 1) {
  const n = coerceIntervalCount(count, frequency);
  if (n > 1) return `Every ${n} years`;
  return BASE_LABEL[frequency] ?? frequency ?? '';
}

// Price suffix: 'mo' | 'qtr' | '6mo' | 'yr' | '3yr'.
export function cadenceUnit(frequency, count = 1) {
  const n = coerceIntervalCount(count, frequency);
  return n > 1 ? `${n}yr` : (BASE_UNIT[frequency] ?? '');
}

// How many times a year this cadence bills — 12 monthly, 1 annually, 1/3 for every
// three years. Multiply an amount by this to annualize it.
export function perYear(frequency, count = 1) {
  return (BASE_PER_YEAR[frequency] ?? 0) / coerceIntervalCount(count, frequency);
}

// True when a cadence needs a YEAR anchor as well as a month: "November" alone
// can't say whether the next three-year renewal falls in 2027 or 2029.
export const needsYearAnchor = (frequency, count) => coerceIntervalCount(count, frequency) > 1;

// Options for the "every N years" picker. 1 is spelled out as the plain cadence so
// the dropdown reads as one list rather than a special mode.
export const YEAR_COUNT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);
