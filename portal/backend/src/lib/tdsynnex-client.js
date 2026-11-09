import { config } from '../config/index.js';
import { makeCache, saidBy, fetchWithRetry, makeBearer, onIntegrationChange } from './integration-util.js';

/**
 * READ-ONLY client for the TD SYNNEX Partner API (StreamOne Stellr).
 *
 *   POST https://sso.us.tdsynnex.com/oauth2/v1/token   { grant_type: client_credentials }  (2-hour token)
 *   GET  {api}/api/v1/customers                         paged: pageNo / pageSize, data.total
 *   GET  {api}/api/v1/customers/{customerNo}/subscriptions
 *   GET  {api}/api/v1/cloud/invoices                    paged — MSRP per subscription line
 *
 * Credentials come from EC Express → StreamOne → Integration → Developer API's → Developer
 * Portal → Client Credentials (PROD). Sandbox credentials only work against the sandbox
 * servers (TDSYNNEX_API_URL / TDSYNNEX_TOKEN_URL).
 */

export function isTdSynnexConfigured() {
  return Boolean(config.tdSynnex.clientId && config.tdSynnex.clientSecret);
}

export class TdSynnexError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const api = () => String(config.tdSynnex.apiUrl).replace(/\/+$/, '');
const unreachable = () => new TdSynnexError(`TD SYNNEX could not be reached (${api()}). Check this server's internet access.`);


async function signIn() {
  if (!isTdSynnexConfigured()) {
    throw new TdSynnexError('TD SYNNEX is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const res = await fetchWithRetry(config.tdSynnex.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.tdSynnex.clientId,
      client_secret: config.tdSynnex.clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  }, unreachable);
  if ([400, 401, 403].includes(res.status)) {
    throw new TdSynnexError(`TD SYNNEX rejected the Client ID / Client Secret (production and sandbox credentials are separate).${await saidBy(res, 'TD SYNNEX')}`);
  }
  if (!res.ok) throw new TdSynnexError(`TD SYNNEX returned ${res.status} when signing in.${await saidBy(res, 'TD SYNNEX')}`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new TdSynnexError('TD SYNNEX did not return an access token.');
  return { value: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

const bearer = makeBearer(signIn);

async function get(path) {
  const where = path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/…');
  const attempt = async () => fetchWithRetry(`${api()}${path}`, {
    headers: { Authorization: `Bearer ${await bearer()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  }, unreachable);
  let res = await attempt();
  if (res.status === 401) { bearer.expire(); res = await attempt(); }
  if (res.status === 401 || res.status === 403) {
    throw new TdSynnexError(`TD SYNNEX refused ${where} — the API key may not be subscribed to that API in the Developer Portal.${await saidBy(res, 'TD SYNNEX')}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new TdSynnexError(`TD SYNNEX returned ${res.status} for ${where}.${await saidBy(res, 'TD SYNNEX')}`);
  return res.json();
}

// Every record of a paged list ({ data: { total, records } }).
async function allPages(path) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await get(`${path}${sep}pageNo=${page}&pageSize=100`);
    const rows = Array.isArray(body?.data?.records) ? body.data.records : [];
    out.push(...rows);
    if (!rows.length || out.length >= (body?.data?.total ?? 0)) break;
  }
  return out;
}

const cache = makeCache(10 * 60 * 1000);

export const customers = ({ refresh = false } = {}) => cache.get('customers', refresh, () => allPages('/api/v1/customers'));

export const subscriptions = (customerNo, { refresh = false } = {}) =>
  cache.get(`subs:${customerNo}`, refresh, async () => {
    const body = await get(`/api/v1/customers/${encodeURIComponent(customerNo)}/subscriptions`);
    return Array.isArray(body?.data) ? body.data : [];
  });

/** Every cloud invoice (for MSRP). Cached 30 minutes across all customers. */
const invoiceCache = makeCache(30 * 60 * 1000);
export const invoices = ({ refresh = false } = {}) => invoiceCache.get('invoices', refresh, () => allPages('/api/v1/cloud/invoices'));

function reset() { bearer.reset(); cache.clear(); invoiceCache.clear(); }
onIntegrationChange('tdsynnex', reset);

export const _raw = { get, bearer, reset };
