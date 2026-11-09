import crypto from 'crypto';

// Pure, dependency-free inventory logic. Kept separate from the route handlers
// so it can be unit-tested without a database or environment.

/** SKU prefix for auto-generated barcodes (e.g. INV-00042). Set SKU_PREFIX to change. */
export const SKU_PREFIX = (process.env.SKU_PREFIX || 'INV').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';

/** Format a SKU from a sequence number: 42 -> "INV-00042". */
export function formatSku(n) {
  return `${SKU_PREFIX}-${String(n).padStart(5, '0')}`;
}

/** Next SKU given the current highest SKU (or null/undefined for the first). */
export function nextSku(lastSku) {
  if (!lastSku) return formatSku(1);
  const num = parseInt(String(lastSku).replace(/^[A-Za-z0-9]+-/, ''), 10);
  if (Number.isNaN(num)) return formatSku(1);
  return formatSku(num + 1);
}

/**
 * Ledger note for stock the IT Portal consumes through the bridge.
 * Always prefixed so Field-side history shows it came from the IT side, with the
 * acting tech's name when known: "[IT Portal: Dana Grant] used on Acme job".
 */
export function serviceLedgerNote(actor, notes) {
  const tag = '[IT Portal' + (actor ? `: ${actor}` : '') + ']';
  return [tag, notes].filter(Boolean).join(' ');
}

/**
 * Validate a stock quantity (receive/checkout). Must be a number > 0.
 * Returns { ok, value } or { ok:false, error }.
 */
export function parseQuantity(input) {
  const q = parseFloat(input);
  if (!q || q <= 0) return { ok: false, error: 'quantity must be > 0.' };
  return { ok: true, value: q };
}

/** True when stock is at or below its low-stock threshold (null threshold = never low). */
export function isLowStock(quantity, threshold) {
  if (threshold == null) return false;
  return Number(quantity) <= Number(threshold);
}

/**
 * Build a token-AND / column-OR ILIKE search clause for a free-text search box.
 *
 * Splits `search` on whitespace into tokens; every token must appear (case-insensitive
 * substring) in AT LEAST ONE of `columns`. This makes multi-word searches order- and
 * gap-independent: "HID 20" matches "HID Signo Reader 20 Black".
 *
 * Returns { clause, params } where `params` are the values to append to the query and
 * placeholders are numbered starting at `startIndex` ($startIndex, $startIndex+1, …).
 * An empty/whitespace search yields { clause: '', params: [] }.
 */
export function buildSearchClause(search, columns, startIndex = 1) {
  const tokens = String(search ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !columns.length) return { clause: '', params: [] };
  const params = [];
  const groups = tokens.map((tok) => {
    params.push(`%${tok}%`);
    const ph = `$${startIndex + params.length - 1}`;
    return '(' + columns.map((c) => `${c} ILIKE ${ph}`).join(' OR ') + ')';
  });
  return { clause: groups.join(' AND '), params };
}

/** Constant-time string compare for secrets; false on any length/type mismatch. */
export function safeTokenEqual(a, b) {
  if (a == null || b == null) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
