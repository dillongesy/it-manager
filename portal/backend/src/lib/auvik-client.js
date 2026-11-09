import { config } from '../config/index.js';
import { makeCache, saidBy, fetchWithRetry, onIntegrationChange } from './integration-util.js';
import { apiBase, tenantOf, deviceOf } from './auvik.js';

/**
 * READ-ONLY client for the Auvik API. Credentials: the Auvik username (sign-in email) and
 * an API key generated on that user's profile; the region is the part of the Auvik
 * address before ".my.auvik.com" (us6 for https://us6.my.auvik.com).
 * Tenants cached 10 minutes, the device inventory 10 minutes.
 */

export function isAuvikConfigured() {
  return Boolean(config.auvik.username && config.auvik.apiKey);
}

export class AuvikError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const base = () => apiBase(config.auvik.region);
const unreachable = () => new AuvikError(`Auvik could not be reached (${base()}). Check AUVIK_REGION and this server's internet access.`);

async function get(url) {
  if (!isAuvikConfigured()) throw new AuvikError('Auvik is not configured. An admin can set it up in Admin → Integrations.', 503);
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.auvik.username}:${config.auvik.apiKey}`).toString('base64')}`,
      Accept: 'application/vnd.api+json',
    },
    signal: AbortSignal.timeout(45_000),
  }, unreachable);
  if (res.status === 401 || res.status === 403) {
    throw new AuvikError(`Auvik rejected the username / API key (check the settings in Admin → Integrations).${await saidBy(res, 'Auvik')}`);
  }
  if (!res.ok) throw new AuvikError(`Auvik returned ${res.status}.${await saidBy(res, 'Auvik')}`);
  return res.json();
}

// Every record of a JSON:API list, following links.next.
async function allPages(url) {
  const out = [];
  let next = url;
  for (let page = 0; next && page < 100; page++) {
    const body = await get(next);
    out.push(...(Array.isArray(body?.data) ? body.data : []));
    next = body?.links?.next || null;
  }
  return out;
}

const cache = makeCache(10 * 60 * 1000);

/** Every tenant (customer site) the user can see, with display names where Auvik gives them. */
export const tenants = ({ refresh = false } = {}) =>
  cache.get('tenants', refresh, async () => {
    const basic = (await allPages(`${base()}/tenants`)).map(tenantOf);
    // The detail call (asked of the top-level / multi-client tenant) carries display names.
    const top = basic.find(t => /multi/i.test(t.type)) ?? basic[0];
    if (!top?.domainPrefix) return basic;
    try {
      const detail = (await allPages(`${base()}/tenants/detail?tenantDomainPrefix=${encodeURIComponent(top.domainPrefix)}`)).map(tenantOf);
      const names = new Map(detail.map(t => [t.id, t.name]));
      return basic.map(t => ({ ...t, name: names.get(t.id) || t.name }));
    } catch {
      return basic;   // names fall back to the domain prefix
    }
  });

/** Every device Auvik knows, across all client tenants. */
export const devices = ({ refresh = false } = {}) =>
  cache.get('devices', refresh, async () => {
    const ts = await tenants({ refresh });
    const byId = new Map(ts.map(t => [t.id, t]));
    const clients = ts.filter(t => !/multi/i.test(t.type));
    const out = [];
    // The tenants filter takes a comma list; ask in batches so the URL stays short.
    for (let i = 0; i < clients.length; i += 25) {
      const ids = clients.slice(i, i + 25).map(t => t.id).join(',');
      out.push(...(await allPages(`${base()}/inventory/device/info?tenants=${encodeURIComponent(ids)}`)).map(d => deviceOf(d, byId)));
    }
    return out;
  });

export const region = () => config.auvik.region || 'us1';

onIntegrationChange('auvik', () => cache.clear());

export const _raw = { get, reset: () => cache.clear() };
