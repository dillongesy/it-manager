// Shared paging for list endpoints.
//
// Every list route used to default to `limit = 50` with no way to tell you were
// only seeing part of the data — a work-order list silently stopped at 50 rows and
// looked complete. Routes now use `parsePaging` and report the FULL matching count
// in the `X-Total-Count` header, so the UI can page through everything and show
// "showing 100 of 312" instead of quietly truncating.

/** Rows per request when the caller doesn't ask for a specific page size. */
export const DEFAULT_LIMIT = 100;

/**
 * Hard ceiling per request. A caller that needs everything (exports) pages through
 * with `offset` rather than asking for one enormous result set — that keeps any
 * single query bounded no matter what a client sends.
 */
export const MAX_LIMIT = 500;

/**
 * Read `limit`/`offset` off a query string, clamped and always integers.
 * Garbage ("abc", -5, 1e9) collapses to sane values instead of reaching SQL.
 */
export function parsePaging(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = parseInt(query.limit, 10);
  const rawOffset = parseInt(query.offset, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

/**
 * Publish the total number of matching rows so the client knows whether more
 * exist. Exposed to the browser via the CORS `exposedHeaders` list in app.js.
 */
export function setTotalCount(res, total) {
  res.setHeader('X-Total-Count', String(Number(total) || 0));
}
