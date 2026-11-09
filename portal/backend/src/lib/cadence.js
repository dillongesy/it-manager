// Billing cadences, including "every N years".
//
// Every recurring thing in the Portal - a catalog service, a customer's recurring
// charge, an auto-renewing license - has a BASE period (monthly / quarterly /
// semiannual / annual) plus an INTERVAL COUNT: how many of those periods pass
// between bills. Count 1 is the ordinary case and the default everywhere, so a row
// that predates this module behaves exactly as it always did.
//
// Only the ANNUAL cadence exposes a count above 1 ("every 3 years" - domain
// registrations, multi-year SSL certs, extended warranties). coerceIntervalCount()
// enforces that: it forces the count back to 1 for any other period, so a stray
// payload can't create an "every 2 quarters" charge that no label or next-due
// calculation is written for. Widening that is a UI decision, not a schema one.
//
// Two vocabularies exist in the schema for the same thing - the service catalog and
// work orders say 'annual', customer recurring charges say 'annually'. Both are
// accepted here rather than migrated, since the strings are stored in three tables
// and touched by the Field bridge.

export const MAX_INTERVAL_COUNT = 50;

const BASE_LABEL = {
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  semiannual: 'Semi-annual',
  annual:     'Annually',
  annually:   'Annually',
};

// Occurrences of the BASE period per year - divided by the interval count to
// annualize money.
const BASE_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1, annually: 1 };

// Short per-period price suffix ("$25.00/mo").
const BASE_UNIT = { monthly: 'mo', quarterly: 'qtr', semiannual: '6mo', annual: 'yr', annually: 'yr' };

// Both spellings of the yearly period. This is the only base that may carry a
// count above 1.
export const isAnnual = (frequency) => frequency === 'annual' || frequency === 'annually';

// Clamp a count to a whole number of periods. Anything unparseable, below 1, or
// attached to a non-annual period collapses to 1 (i.e. the ordinary cadence).
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
  const base = BASE_UNIT[frequency] ?? '';
  return n > 1 ? `${n}yr` : base;
}

// How many times a year this cadence bills - 12 monthly, 1 annually, 1/3 for every
// three years. Multiply an amount by this to annualize it.
export function perYear(frequency, count = 1) {
  const base = BASE_PER_YEAR[frequency] ?? 0;
  return base / coerceIntervalCount(count, frequency);
}

// A multi-year charge needs a year anchor: "November" alone can't say whether the
// next renewal is 2027 or 2029. Ordinary cadences never store one (NULL), the same
// way a monthly charge stores no billing month.
export function coerceBillingYear(value, frequency, count, from = new Date()) {
  if (coerceIntervalCount(count, frequency) < 2) return null;
  const n = parseInt(value, 10);
  if (Number.isInteger(n) && n >= 1900 && n <= 9999) return n;
  return from.getFullYear();
}
