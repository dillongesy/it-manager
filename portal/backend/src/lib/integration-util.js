// Small helpers shared by the outside-system clients: caching, OAuth tokens, retries,
// and forgetting cached state when an integration's credentials change.

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * A keyed cache: get(key, refresh, load) returns the cached value while fresh.
 * A load that was already running when clear() was called isn't stored, so data
 * fetched with old credentials can't land in the cache after they change.
 */
export function makeCache(ttlMs) {
  const entries = new Map();   // key → { at, value }
  let generation = 0;
  return {
    async get(key, refresh, load) {
      const hit = entries.get(key);
      if (!refresh && hit && Date.now() - hit.at < ttlMs) return hit.value;
      const g = generation;
      const value = await load();
      if (g === generation) entries.set(key, { at: Date.now(), value });
      return value;
    },
    clear: () => { generation++; entries.clear(); },
  };
}

/**
 * One shared OAuth token per client. Concurrent callers share a single sign-in.
 *
 *   const bearer = makeBearer(async (isCurrent) => ({ value, expires }));
 *   await bearer()        → a token valid for at least another minute
 *   bearer.expire()       → forget the token (the service answered 401)
 *   bearer.reset()        → forget everything; a sign-in still in flight is discarded
 *
 * signIn gets isCurrent(): false once reset() has run since it started, for any other
 * state it learns along the way (e.g. which scopes the key has).
 */
export function makeBearer(signIn) {
  let token = null;      // { value, expires }
  let pending = null;
  let generation = 0;
  const bearer = () => {
    if (token && token.expires > Date.now() + 60_000) return Promise.resolve(token.value);
    if (!pending) {
      const g = generation;
      const isCurrent = () => g === generation;
      const p = signIn(isCurrent)
        .then((t) => { if (isCurrent()) token = t; return t.value; })
        .finally(() => { if (pending === p) pending = null; });
      pending = p;
    }
    return pending;
  };
  bearer.expire = () => { token = null; };
  bearer.reset = () => { generation++; token = null; pending = null; };
  return bearer;
}

// ─── Credential changes ──────────────────────────────────────────────────────
// Each client registers what to forget when its integration's settings change
// (Admin → Integrations): tokens, cached lists, what the old key could do.
// lib/settings.js calls integrationChanged(id) after every save that changed something.

const resetters = new Map();   // integration id → Set<fn>

export function onIntegrationChange(id, fn) {
  if (!resetters.has(id)) resetters.set(id, new Set());
  resetters.get(id).add(fn);
}

export function integrationChanged(id) {
  for (const fn of resetters.get(id) ?? []) {
    try { fn(); } catch (e) { console.error(`Resetting the ${id} client failed:`, e.message); }
  }
}

/** Run fn over items, at most `limit` at a time, keeping the input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** The service's own explanation of an error response, trimmed: " Dell said: …" or ''. */
export async function saidBy(res, who) {
  const raw = await res.text().catch(() => '');
  let msg = raw;
  try {
    const b = JSON.parse(raw);
    msg = b.message ?? b.error_description ?? b.errorMessage ?? b.data?.errorMessage ?? b.detail ?? b.error ?? raw;
  } catch { /* not JSON */ }
  msg = String(typeof msg === 'object' ? JSON.stringify(msg) : msg).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  return msg ? ` ${who} said: ${msg}` : '';
}

/**
 * fetch, retrying (up to 3 times) when the service says to slow down (429 / 503),
 * honouring Retry-After. A network failure throws `unreachable()`.
 */
export async function fetchWithRetry(url, init, unreachable) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw unreachable();
    }
    if (![429, 503].includes(res.status) || attempt >= 3) return res;
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1500 * 2 ** attempt);
  }
}
