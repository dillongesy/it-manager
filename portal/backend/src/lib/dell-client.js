import { config } from '../config/index.js';
import { saidBy, fetchWithRetry, makeBearer, onIntegrationChange } from './integration-util.js';
import { normalizeTag, isValidServiceTag } from './dell.js';

/**
 * Thin, READ-ONLY client for Dell's TechDirect warranty API. Credentials come from
 * techdirect.dell.com → APIs → Manage API Keys (API Key = Client ID).
 *
 *   POST {base}/auth/oauth/v2/token                       { grant_type: client_credentials }
 *   GET  {base}/PROD/sbil/eapi/v5/asset-entitlements?servicetags=TAG1,TAG2   (≤ 100 tags)
 *
 * Results are cached per tag for 12 hours: a warranty doesn't change by the minute, and
 * Dell rate-limits keys that ask too often.
 */

const DEFAULT_BASE = 'https://apigtwb2c.us.dell.com';
const BATCH = 100;
const TTL = 12 * 3600 * 1000;

export function isDellConfigured() {
  return Boolean(config.dell.clientId && config.dell.clientSecret);
}

export class DellError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const base = () => String(config.dell.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
const unreachable = () => new DellError(`Dell's warranty API could not be reached (${base()}). Check this server's internet access.`);


async function signIn() {
  if (!isDellConfigured()) {
    throw new DellError('Dell warranty lookup is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const res = await fetchWithRetry(`${base()}/auth/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.dell.clientId,
      client_secret: config.dell.clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  }, unreachable);
  if ([400, 401, 403].includes(res.status)) {
    throw new DellError(`Dell rejected the Client ID / Client Secret (check the key is approved for the Warranty API in TechDirect).${await saidBy(res, 'Dell')}`);
  }
  if (!res.ok) throw new DellError(`Dell returned ${res.status} when signing in.${await saidBy(res, 'Dell')}`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new DellError('Dell did not return an access token.');
  return { value: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

const bearer = makeBearer(signIn);

async function entitlements(tags) {
  const url = `${base()}/PROD/sbil/eapi/v5/asset-entitlements?servicetags=${tags.map(encodeURIComponent).join(',')}`;
  const attempt = async () => fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${await bearer()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  }, unreachable);
  let res = await attempt();
  if (res.status === 401) { bearer.expire(); res = await attempt(); }   // token expired early — once
  if (res.status === 401 || res.status === 403) {
    throw new DellError(`Dell refused the warranty lookup — the key may not be approved for the Warranty API yet.${await saidBy(res, 'Dell')}`);
  }
  if (!res.ok) throw new DellError(`Dell returned ${res.status} for the warranty lookup.${await saidBy(res, 'Dell')}`);
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body : [];
}

const results = new Map();   // tag → { at, asset }

/**
 * Warranty records for these service tags (invalid tags are ignored).
 * @returns {Promise<Map<string, object>>} tag → Dell asset; tags Dell doesn't know are absent
 */
export async function lookup(tags, { refresh = false } = {}) {
  const want = [...new Set((tags ?? []).map(normalizeTag).filter(isValidServiceTag))];
  const out = new Map();
  const missing = [];
  for (const t of want) {
    const hit = results.get(t);
    if (!refresh && hit && Date.now() - hit.at < TTL) { if (hit.asset) out.set(t, hit.asset); }
    else missing.push(t);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const found = new Set();
    for (const asset of await entitlements(batch)) {
      const t = normalizeTag(asset?.serviceTag);
      if (!t) continue;
      found.add(t);
      results.set(t, { at: Date.now(), asset });
      out.set(t, asset);
    }
    // Remember "Dell doesn't know this tag" too, so it isn't asked again and again.
    for (const t of batch) if (!found.has(t)) results.set(t, { at: Date.now(), asset: null });
  }
  return out;
}

// For the probe script / tests.
function reset() { bearer.reset(); results.clear(); }
onIntegrationChange('dell', reset);

export const _raw = { bearer, reset };
