// Quick date-range presets for the customer export's work-order filter.
// Each preset returns { from, to } as 'YYYY-MM-DD' strings (or null for open-ended).

import { toDateInput } from './date.js';

// These Dates are built from LOCAL components, so format them locally too -
// toISOString() would shift them a day back in every US timezone.
const iso = (d) => toDateInput(d);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

export const RANGE_PRESETS = [
  { id: '30d',  label: 'Last 30 days',  compute: () => ({ from: iso(daysAgo(30)),  to: null }) },
  { id: '60d',  label: 'Last 60 days',  compute: () => ({ from: iso(daysAgo(60)),  to: null }) },
  { id: '3m',   label: 'Last 3 months', compute: () => ({ from: iso(monthsAgo(3)),  to: null }) },
  { id: '6m',   label: 'Last 6 months', compute: () => ({ from: iso(monthsAgo(6)),  to: null }) },
  { id: '1y',   label: 'Last year',     compute: () => ({ from: iso(monthsAgo(12)), to: null }) },
  { id: 'all',  label: 'All',           compute: () => ({ from: null, to: null }) },
];

// Human label for the range, for the export header/summary.
export function rangeLabel({ id, from, to }) {
  if (id && id !== 'custom') {
    const preset = RANGE_PRESETS.find(p => p.id === id);
    if (preset) return preset.label;
  }
  if (from && to) return `${from} to ${to}`;
  if (from) return `since ${from}`;
  if (to) return `through ${to}`;
  return 'All';
}
