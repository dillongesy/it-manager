// Validation for date-only (Postgres DATE) request fields.
//
// Why this exists: an HTML <input type="date"> lets a user type a SIX-digit year, and
// PostgreSQL's DATE type happily accepts years up to 5874897 — so a fat-fingered
// "20207-07-15" stores fine and only detonates later. Once stored, the API serializes
// it as an expanded-year ISO string ("+020207-07-15T…"), which no client can round-trip,
// and the next save fails with the Postgres parser's cryptic
// `time zone displacement out of range: "+020207-07"` — leaving the record permanently
// un-editable. Catch it at the door instead, with a message a human can act on.

export const MIN_DATE_YEAR = 1900;
export const MAX_DATE_YEAR = 9999;

function daysInMonth(year, month) {   // month is 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Normalize one date-only value.
 * Accepts '' / null / undefined (→ null), a Date, 'YYYY-MM-DD', or a full ISO string.
 * @returns {{ok: true, value: string|null} | {ok: false, error: string}}
 */
export function coerceDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };

  let y, m, d;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false, error: 'is not a valid date' };
    y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
  } else {
    // Anchored on both ends so an expanded-year string ("+020207-07-15") or trailing
    // junk can never slip through as a "close enough" match.
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (!match) return { ok: false, error: 'must look like YYYY-MM-DD' };
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  }

  if (y < MIN_DATE_YEAR || y > MAX_DATE_YEAR) {
    return { ok: false, error: `has an out-of-range year (${y}) — it must be between ${MIN_DATE_YEAR} and ${MAX_DATE_YEAR}` };
  }
  if (m < 1 || m > 12) return { ok: false, error: `has an invalid month (${m})` };
  if (d < 1 || d > daysInMonth(y, m)) return { ok: false, error: `has an invalid day (${d}) for that month` };

  return { ok: true, value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/**
 * Normalize every date field present on a request body.
 * Fields absent from the body are left absent (so PATCH stays partial).
 * @returns {{ok: true, values: Record<string, string|null>} | {ok: false, error: string}}
 */
export function coerceDateFields(body, fields) {
  const values = {};
  for (const f of fields) {
    if (body?.[f] === undefined) continue;
    const r = coerceDate(body[f]);
    if (!r.ok) return { ok: false, error: `${f.replace(/_/g, ' ')} ${r.error}.` };
    values[f] = r.value;
  }
  return { ok: true, values };
}

// Throwing variant, for use inside the helpers that build a column→value map (where
// there's no `res` to hand back). The error handler turns `status` into a 400 with
// this message, so the user sees "warranty expires has an out-of-range year (20207)…".
export function assertDateFields(body, fields) {
  const r = coerceDateFields(body, fields);
  if (!r.ok) {
    const err = new Error(r.error);
    err.status = 400;
    throw err;
  }
  return r.values;
}
