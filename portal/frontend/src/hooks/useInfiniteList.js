import { useInfiniteQuery } from '@tanstack/react-query';

// Infinite-scroll lists. List endpoints report the total match count in
// `X-Total-Count`; these helpers load the first page, fetch more as the user scrolls,
// and expose the total for display.

/** Rows per request. Big enough that most lists finish in one or two fetches. */
export const PAGE_SIZE = 100;

/**
 * The most rows one request can return - mirrors MAX_LIMIT in the backend's
 * lib/pagination.js. Asking for more is silently clamped there, so unpaged views
 * (dashboard summaries) use this rather than an arbitrary large number.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Unwrap a list response into `{ rows, total }`. Falls back to the row count when
 * an endpoint doesn't send the header, so a caller can't end up with total=0 and a
 * list that refuses to load more.
 */
export function toPage(res) {
  const rows = res.data ?? [];
  const header = res.headers?.['x-total-count'];
  const total = header == null ? rows.length : Number(header);
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

/**
 * `fetchPage({ limit, offset })` must resolve to an axios response (pass it
 * through `toPage`, or return `{ rows, total }` directly).
 *
 * Returns the usual React Query result plus a flattened `rows` array and the
 * server-side `total`, so callers render `rows` and never touch `data.pages`.
 */
export function useInfiniteList({ queryKey, fetchPage, pageSize = PAGE_SIZE, ...options }) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const result = await fetchPage({ limit: pageSize, offset: pageParam });
      return result?.rows ? result : toPage(result);
    },
    // Ask for the next window only while fewer rows are loaded than exist. Rows
    // added by someone else mid-scroll shift the window slightly; the list is
    // refetched on invalidation anyway, so that self-corrects.
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, page) => n + page.rows.length, 0);
      if (!lastPage.rows.length) return undefined;
      return loaded < lastPage.total ? loaded : undefined;
    },
    ...options,
  });

  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  // The newest page's total is the freshest; fall back to what's loaded.
  const total = query.data?.pages.at(-1)?.total ?? rows.length;

  return { ...query, rows, total };
}

/**
 * Fetch EVERY matching row by walking the pages. For exports and reports, where a
 * truncated result would be silently wrong - the per-request cap keeps any single
 * query bounded, and this loops until the server says there's nothing left.
 *
 * `fetchPage({ limit, offset })` takes the same shape as `useInfiniteList`.
 */
export async function fetchAllPages(fetchPage, { pageSize = PAGE_SIZE, maxRows = 20000 } = {}) {
  const all = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { rows, total } = toPage(await fetchPage({ limit: pageSize, offset }));
    all.push(...rows);
    // Stop on a short page as well as on the count - a server that doesn't report
    // a total still terminates instead of looping to maxRows.
    if (rows.length < pageSize || all.length >= total) break;
  }
  return all;
}

/**
 * Patch one row inside cached lists, whichever shape they're in - a plain array
 * (`useQuery`) or paged (`useInfiniteQuery`). Used for optimistic toggles that
 * must survive across every cached filter variant of a list.
 */
export function patchCachedRows(old, match, patch) {
  const apply = (rows) => rows.map((row) => (match(row) ? { ...row, ...patch } : row));

  if (Array.isArray(old)) return apply(old);
  if (old?.pages) {
    return { ...old, pages: old.pages.map((page) => ({ ...page, rows: apply(page.rows) })) };
  }
  return old;
}
