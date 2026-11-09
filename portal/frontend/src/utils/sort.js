// Sorting helpers for the "Sort" buttons and menus on the customer tabs.

// Case-insensitive, natural-number-aware compare ("Switch 2" before "Switch 10").
// Blank names sink to the bottom so unnamed rows don't lead the list.
export function alphaCompare(a, b) {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

// Sort a copy of `items` by the name `keyFn` pulls off each one.
export function sortByName(items, keyFn) {
  return [...items].sort((a, b) => alphaCompare(keyFn(a), keyFn(b)));
}

// True when `items` is already in alphabetical order — lets a Sort button
// disable itself instead of firing a pointless reorder request.
export function isSortedByName(items, keyFn) {
  for (let i = 1; i < items.length; i++) {
    if (alphaCompare(keyFn(items[i - 1]), keyFn(items[i])) > 0) return false;
  }
  return true;
}

// ─── Sort by other keys (the Devices tab's Sort menu) ───────────────────────

// IPv4 addresses in numeric order ("192.168.1.2" before "192.168.1.10"); anything that
// isn't an IPv4 address (a hostname, IPv6) sorts after them alphabetically. Blanks last.
const ipParts = (v) => {
  const m = String(v ?? '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/\d+)?$/);
  return m ? m.slice(1).map(Number) : null;
};
export function ipCompare(a, b) {
  const x = ipParts(a);
  const y = ipParts(b);
  if (x && y) { for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
  if (x && String(b ?? '').trim()) return -1;
  if (y && String(a ?? '').trim()) return 1;
  return alphaCompare(a, b);
}

// Dates (YYYY-MM-DD or anything Date parses), soonest first. Blanks last.
export function dateCompare(a, b) {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  if (Number.isNaN(x) && Number.isNaN(y)) return 0;
  if (Number.isNaN(x)) return 1;
  if (Number.isNaN(y)) return -1;
  return x - y;
}

export const sortWith = (items, compare) => [...items].sort(compare);
export function isSortedWith(items, compare) {
  for (let i = 1; i < items.length; i++) if (compare(items[i - 1], items[i]) > 0) return false;
  return true;
}
