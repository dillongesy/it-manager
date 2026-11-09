import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { makeBearer, makeCache, onIntegrationChange } from './integration-util.js';

/**
 * Thin, READ-ONLY client for the ConnectWise RMM platform API ("ConnectWise Platform
 * APIs", a.k.a. Asio). Credentials come from ConnectWise RMM → Integrations → API Access.
 *
 *   POST {base}/v1/token   { grant_type: client_credentials, client_id, client_secret, scope }
 *   GET  {base}/api/platform/v1/company/companies
 *   GET  {base}/api/platform/v1/company/companies/{companyId}/sites
 *   POST {base}/api/platform/v2/device/categories/all/endpoints?limit=&cursor=
 *                          { resourceType: 'site' | 'company' | …, resources: [id] }
 *   GET  {base}/api/platform/v2/device/companies/{c}/sites/{s}/endpoints/{endpointId}
 *   GET  {base}/api/platform/v1/device/endpoints/{endpointId}
 *
 * What's known from real tenants (ConnectWise publishes the schemas only behind a
 * partner login — see scripts/connectwise-probe.js to inspect yours):
 *   - resourceType must be SINGULAR ("site", not "sites" — the plural is rejected by
 *     name). Which one a tenant accepts isn't documented, so the device list tries each
 *     request shape in turn and keeps the first that works.
 *   - The device list is grouped by category — { platform: [...], network: [...] } —
 *     and each record is a short summary (endpointID, deviceName, friendlyName,
 *     endpointType) with NO site ID.
 *   - The v2 details put the device's fields under its category key: { companyID,
 *     siteID, endpointID, platform: { deviceName, ipAddress, macAddress, … } }. They
 *     answer 404 when asked about the wrong site, which is how a device's site is found
 *     when the list couldn't be scoped by site.
 *   - A 404 on the list means "no devices", not an error.
 *   - Signing in too often locks the key (423), so one token is shared and reused.
 *
 * The token request only asks for read scopes, so even an API key generated with every
 * scope ticked can't be used by the Portal to change anything in ConnectWise.
 */

export const SCOPES = 'platform.companies.read platform.sites.read platform.devices.read';
// Optional: unlocks the v1 asset inventory (processor, installed RAM, physical disks,
// local accounts, shares). A key without it can't even be asked for it — the token
// request is refused — so sign-in retries without it.
export const ASSET_SCOPE = 'platform.asset.read';

// Three regional servers; the first characters of the Client ID say which one a
// partner lives on.
export const REGION_BASE = {
  na: 'https://openapi.service.itsupport247.net',
  eu: 'https://openapi.service.euplatform.connectwise.com',
  au: 'https://openapi.service.auplatform.connectwise.com',
};
const PREFIX_REGION = { '0e30': 'na', '0e31': 'eu', '0e32': 'au' };

export function baseUrlFor(clientId, override) {
  if (override) return String(override).replace(/\/+$/, '');
  const region = PREFIX_REGION[String(clientId ?? '').slice(0, 4).toLowerCase()] ?? 'na';
  return REGION_BASE[region];
}

export function isConnectWiseConfigured() {
  return Boolean(config.connectWise.clientId && config.connectWise.clientSecret);
}

// `status` is what the Portal answers its own caller with; `upstream` is what
// ConnectWise itself returned (400 = request shape rejected, 404 = not found, …).
export class ConnectWiseError extends Error {
  constructor(message, status = 502, upstream = null) {
    super(message);
    this.status = status;
    this.upstream = upstream;
  }
}

const base = () => baseUrlFor(config.connectWise.clientId, config.connectWise.baseUrl);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ConnectWise's own explanation of an error, trimmed.
async function said(res) {
  const raw = await res.text().catch(() => '');
  let msg = raw;
  try {
    const b = JSON.parse(raw);
    msg = b.message ?? b.description ?? b.error_description ?? b.detail ?? b.error ?? raw;
  } catch { /* not JSON */ }
  msg = String(msg).replace(/\s+/g, ' ').trim().slice(0, 220);
  return msg ? ` ConnectWise said: ${msg}` : '';
}

// Send, waiting and retrying (up to 3 times) when ConnectWise asks to slow down.
async function send(request) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await request();
    } catch {
      throw new ConnectWiseError(`ConnectWise could not be reached (${base()}). Check this server's internet access.`, 502);
    }
    if (![423, 429, 503].includes(res.status) || attempt >= 3) return res;
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1500 * 2 ** attempt);
  }
}

// ─── Auth — one shared token; concurrent callers share a single sign-in ───────

let assetScope = null; // true/false once known: does the key have platform.asset.read?
export const hasAssetScope = () => assetScope === true;

async function signIn(isCurrent) {
  if (!isConnectWiseConfigured()) {
    throw new ConnectWiseError('ConnectWise is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const fields = (scope) => ({
    grant_type: 'client_credentials',
    client_id: config.connectWise.clientId,
    client_secret: config.connectWise.clientSecret,
    scope,
  });
  const post = (body, type) => send(() => fetch(`${base()}/v1/token`, {
    // ConnectWise answers 400 "unexpected response status" without the Accept header.
    method: 'POST', headers: { 'Content-Type': type, Accept: 'application/json' }, body,
    signal: AbortSignal.timeout(20_000),
  }));
  const request = async (scope) => {
    let r = await post(JSON.stringify(fields(scope)), 'application/json');
    if (r.status === 415) r = await post(new URLSearchParams(fields(scope)).toString(), 'application/x-www-form-urlencoded');
    return r;
  };
  // Ask for the asset inventory too, unless we already know the key doesn't have it.
  let res;
  if (assetScope !== false) {
    res = await request(`${SCOPES} ${ASSET_SCOPE}`);
    if (res.ok) { if (isCurrent()) assetScope = true; }
    else if (res.status === 400) { if (isCurrent()) assetScope = false; res = null; }
  }
  if (!res) res = await request(SCOPES);
  if (res.status === 423) {
    throw new ConnectWiseError('ConnectWise has temporarily locked this API key after too many sign-ins. Wait a few minutes and try again.', 502, 423);
  }
  if ([400, 401, 403].includes(res.status)) {
    throw new ConnectWiseError(`ConnectWise rejected the Client ID / Client Secret, or the key is missing a read scope.${await said(res)}`, 502, res.status);
  }
  if (!res.ok) throw new ConnectWiseError(`ConnectWise returned ${res.status} when signing in.${await said(res)}`, 502, res.status);
  const body = await res.json().catch(() => ({}));
  const value = body.access_token ?? body.accessToken;
  if (!value) throw new ConnectWiseError('ConnectWise did not return an access token.', 502);
  const seconds = Number(body.expires_in ?? body.expiresIn) || 3600;
  return { value, expires: Date.now() + seconds * 1000 };
}

const bearer = makeBearer(signIn);

// ─── Requests ─────────────────────────────────────────────────────────────────

async function call(method, path, body) {
  const url = `${base()}${path}`;
  const where = path.split('?')[0];
  const attempt = async () => {
    const t = await bearer();
    return send(() => fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/json',
        // Some platform endpoints document these as required.
        Origin: base(),
        'User-Agent': 'it-manager-portal',
        'X-Request-ID': randomUUID(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    }));
  };
  let res = await attempt();
  if (res.status === 401) { bearer.expire(); res = await attempt(); }   // token expired early — sign in again once
  if (res.status === 401 || res.status === 403) {
    throw new ConnectWiseError(`ConnectWise refused ${where}. Check the API key's scopes in Integrations → API Access.${await said(res)}`, 502, res.status);
  }
  if (!res.ok) {
    throw new ConnectWiseError(`ConnectWise returned ${res.status} for ${where}.${await said(res)}`,
      res.status === 404 ? 404 : 502, res.status);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// The list inside a response, whatever the envelope calls it.
export function listOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const k of ['data', 'items', 'results', 'companies', 'sites', 'endpoints', 'devices', 'records']) {
      if (Array.isArray(body[k])) return body[k];
    }
  }
  return [];
}

const ID_KEYS = ['endpointID', 'endpointId', 'endpoint_id', 'deviceID', 'deviceId', 'resourceId', 'agentId', 'id'];
export const recordId = (r) => {
  for (const k of ID_KEYS) if (r?.[k] != null && r[k] !== '') return String(r[k]);
  if (r?.endpoint?.id != null) return String(r.endpoint.id);
  return '';
};

/**
 * Every device record in a device-list response. ConnectWise groups them by category
 * ({ platform: [...], network: [...] }) and may nest them in an envelope, so every
 * array is gathered; a record without an ID of its own that holds a list (e.g. a site
 * with an endpoints list) is opened up.
 */
export function recordsOf(body, depth = 0) {
  if (depth > 4 || !body || typeof body !== 'object') return [];
  if (!Array.isArray(body)) return Object.values(body).flatMap(v => recordsOf(v, depth + 1));
  return body.filter(v => v && typeof v === 'object').flatMap(item => {
    if (recordId(item)) return [item];
    const inner = Object.values(item).flatMap(v => (Array.isArray(v) ? recordsOf(v, depth + 1) : []));
    return inner.length ? inner : [];
  });
}

// ─── Cached reads ─────────────────────────────────────────────────────────────

const cache = makeCache(2 * 60 * 1000);
const cached = (key, refresh, load) => cache.get(key, refresh, load);

export const companies = ({ refresh = false } = {}) =>
  cached('companies', refresh, async () => listOf(await call('GET', '/api/platform/v1/company/companies')));

export const sites = (companyId, { refresh = false } = {}) =>
  cached(`sites:${companyId}`, refresh, async () =>
    listOf(await call('GET', `/api/platform/v1/company/companies/${encodeURIComponent(companyId)}/sites`)));

// ─── Devices ──────────────────────────────────────────────────────────────────

// Device-list request shapes, most specific first. The first one the tenant accepts is
// remembered for the life of the process.
export const DEVICE_SHAPES = [
  { kind: 'v2', resourceType: 'site' },
  { kind: 'v2', resourceType: 'company' },
  { kind: 'v2', resourceType: 'client' },
  { kind: 'v2', resourceType: 'partner' },
  { kind: 'v1' },
];
const shapeName = (s) => (s.kind === 'v2' ? `v2 by ${s.resourceType}` : 'v1 list');
let workingShape = null;
export const deviceListShape = () => (workingShape ? shapeName(workingShape) : null);

const PAGE = 100;
async function listPages(shape, companyId, siteId) {
  const out = [];
  for (let cursor = 0, pages = 0; pages < 100; pages++) {
    const qs = `limit=${PAGE}&cursor=${cursor}`;
    let body;
    try {
      body = shape.kind === 'v2'
        ? await call('POST', `/api/platform/v2/device/categories/all/endpoints?${qs}`, {
            resourceType: shape.resourceType,
            resources: shape.resourceType === 'site' ? [siteId] : shape.resourceType === 'partner' ? [] : [companyId],
          })
        : await call('GET', `/api/platform/v1/device/endpoints?${qs}&clientId=${encodeURIComponent(companyId)}`);
    } catch (e) {
      // 404 = no (more) devices. The request itself was accepted.
      if (e instanceof ConnectWiseError && e.upstream === 404) break;
      throw e;
    }
    const page = recordsOf(body);
    out.push(...page);
    if (page.length < PAGE) break;
    const next = Number(body?.nextCursor ?? body?.pageInfo?.nextCursor ?? body?.cursor?.next);
    cursor = Number.isFinite(next) && next > cursor ? next : cursor + page.length;
  }
  return out;
}

// Device summaries, via the first request shape this tenant accepts.
async function listDevices(companyId, siteId) {
  const shapes = workingShape ? [workingShape] : DEVICE_SHAPES;
  const tried = [];
  for (const shape of shapes) {
    try {
      const rows = await listPages(shape, companyId, siteId);
      workingShape = shape;
      return { rows, shape };
    } catch (e) {
      // Only a rejected request (400) is worth trying another shape for.
      if (!(e instanceof ConnectWiseError && e.upstream === 400)) throw e;
      tried.push(`${shapeName(shape)}: ${(/ConnectWise said: (.*)$/.exec(e.message)?.[1] ?? e.message).slice(0, 120)}`);
    }
  }
  throw new ConnectWiseError(`ConnectWise wouldn't list devices. Tried ${tried.join('; ')}`, 502, 400);
}

// Run fn over items, a few at a time (ConnectWise throttles bursts).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// v2 details for one device at one site.
//   { data }       — found at this site
//   { notHere }    — 404: the device lives at another site
//   { error }      — anything else; the device's site can't be confirmed
let detailsNote = null;
async function v2Details(companyId, siteId, endpointId) {
  try {
    return { data: await call('GET', `/api/platform/v2/device/companies/${encodeURIComponent(companyId)}/sites/${encodeURIComponent(siteId)}/endpoints/${encodeURIComponent(endpointId)}`) };
  } catch (e) {
    if (!(e instanceof ConnectWiseError)) throw e;
    if (e.upstream === 404) return { notHere: true };
    detailsNote = e.message;
    return { error: e.message };
  }
}
export const lastDetailsNote = () => detailsNote;

// ─── v1 asset inventory (needs platform.asset.read) ──────────────────────────
//
// The v1 device routes carry the full asset collection — processors, physicalMemory,
// drives (physical disks), networks, users, shares, installed software, … — but under
// DIFFERENT endpoint IDs than v2 uses for the same machine (confirmed on a live
// tenant). The v1 list says which site each device is at; the Portal pairs v1 records
// with v2 devices by serial number, then computer name (lib/connectwise.js).
//   GET /api/platform/v1/device/endpoints?clientId=   → { endpoints: [{ endpointId, siteId, … }] }
//   GET /api/platform/v1/device/endpoints/{v1 id}     → { friendlyName, system, processors, … }

let hardwareNote = null;
export const lastHardwareNote = () => hardwareNote;
const NO_ASSET_SCOPE = 'Processor, installed RAM, physical disks, local accounts and shares need the '
  + 'Platform → Assets – Read permission on the ConnectWise API key.';

async function v1SiteInventory(companyId, siteId) {
  let list;
  try {
    list = listOf(await call('GET', `/api/platform/v1/device/endpoints?clientId=${encodeURIComponent(companyId)}`));
  } catch (e) {
    if (!(e instanceof ConnectWiseError)) throw e;
    hardwareNote = e.upstream === 403 ? NO_ASSET_SCOPE : e.message;
    return [];
  }
  const here = list.filter(r => String(r.siteId ?? r.siteID ?? '') === String(siteId)
    && String(r.clientId ?? r.clientID ?? companyId) === String(companyId));
  const details = await mapLimit(here, 4, async (r) => {
    const id = r.endpointId ?? r.endpointID;
    try {
      const d = await call('GET', `/api/platform/v1/device/endpoints/${encodeURIComponent(id)}`);
      // Drop the bulky lists the Portal doesn't use (a record is ~150 KB with them).
      if (d && typeof d === 'object') {
        for (const k of ['services', 'installedSoftwares', 'rolesFeatures', 'usbs', 'softwareLicenses', 'bluetooth', 'diagnostic']) delete d[k];
        // Never keep license keys around, even in the 2-minute cache.
        if (d.os) { delete d.os.productKey; }
      }
      return d;
    } catch (e) {
      if (!(e instanceof ConnectWiseError)) throw e;
      hardwareNote = e.upstream === 403 ? NO_ASSET_SCOPE : e.message;
      return null;
    }
  });
  return details.filter(Boolean);
}

// Live-usage routes that also carry the fixed facts the Portal wants:
//   memory-usage → [{ physicalTotalBytes, … }]              (installed RAM)
//   disk-usage   → [{ storages: [{ name: "0 C:", metric: { totalSpaceBytes }, partitions: [{ name: "C:" }] }] }]
// Best effort — a failure just leaves RAM / drives blank.
async function usage(endpointId, kind) {
  try {
    return await call('GET', `/api/platform/v2/device/endpoints/${encodeURIComponent(endpointId)}/${kind}`);
  } catch (e) {
    if (e instanceof ConnectWiseError) return null;
    throw e;
  }
}

/**
 * Every device at one site: the list summary merged with its v2 details (IP, MAC,
 * type) and v1 details (OS, serial, hardware). Each record is returned as
 * { summary, v2, v1 } so the mapper (lib/connectwise.js) can flatten them in order.
 *
 * When the list couldn't be scoped to the site, each device's v2 details are asked for
 * AT this site — ConnectWise answers 404 for a device that lives elsewhere, and those
 * are dropped.
 */
export const siteEndpoints = (companyId, siteId, { refresh = false } = {}) =>
  cached(`endpoints:${companyId}:${siteId}`, refresh, async () => {
    const { rows, shape } = await listDevices(companyId, siteId);
    const bySite = shape.kind === 'v2' && shape.resourceType === 'site';
    // Partner-wide and v1 lists aren't per company: drop devices that say they belong elsewhere.
    const perCompany = shape.kind === 'v2' && shape.resourceType !== 'partner';
    const candidates = perCompany ? rows : rows.filter(r => {
      const owner = r.companyID ?? r.companyId ?? r.clientId ?? r.clientID;
      return owner == null || String(owner) === String(companyId);
    });
    // The same device can appear under two categories — keep one.
    const seen = new Set();
    const unique = candidates.filter(r => { const id = recordId(r); if (!id || seen.has(id)) return false; seen.add(id); return true; });

    hardwareNote = null;
    detailsNote = null;
    const merged = (await mapLimit(unique, 4, async (summary) => {
      const id = recordId(summary);
      const v2 = await v2Details(companyId, siteId, id);
      // A site-scoped list already placed the device here; otherwise the details decide.
      if (!bySite && !v2.data) return null;           // 404 = another site; error = can't confirm (lastDetailsNote)
      if (v2.data?.platform?.os) delete v2.data.platform.os.productKey;   // never keep license keys
      return { summary, v2: v2.data ?? null, v1: null };
    })).filter(Boolean);

    // Full inventory from the v1 asset routes, paired to the v2 devices.
    await bearer();                                   // settles whether the key has the asset scope
    if (hasAssetScope()) {
      const inventory = await v1SiteInventory(companyId, siteId);
      const { pairs, unpaired } = pairInventory(merged, inventory);
      for (const [rec, v1] of pairs) rec.v1 = v1;
      // A machine the v1 inventory knows but the v2 list didn't return is still a device here.
      for (const v1 of unpaired) merged.push({ summary: null, v2: null, v1 });
    } else {
      hardwareNote = NO_ASSET_SCOPE;
    }

    // Without an inventory record, fall back to the usage routes for RAM and drives.
    await mapLimit(merged.filter(r => !r.v1 && recordId(r.summary ?? {})), 4, async (rec) => {
      const id = recordId(rec.summary);
      [rec.memory, rec.disks] = await Promise.all([usage(id, 'memory-usage'), usage(id, 'disk-usage')]);
    });
    return merged;
  });

/**
 * Pair v1 inventory records with v2 device records. v1 and v2 give the same machine
 * different endpoint IDs, so they're joined on the machine itself: serial number
 * first, then computer name. A serial or name shared by two machines is never guessed.
 * @returns {{ pairs: [v2Record, v1Record][], unpaired: v1Record[] }}
 */
export function pairInventory(records, inventory) {
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const serialOf = (o) => norm(o?.system?.serialNumber ?? o?.bios?.serialNumber ?? o?.platform?.system?.serialNumber);
  const nameOf = (o) => norm(o?.system?.systemName ?? o?.platform?.system?.systemName ?? o?.platform?.deviceName ?? o?.deviceName ?? o?.friendlyName);
  const unique = (list, key) => {
    const m = new Map();
    for (const x of list) { const k = key(x); if (!k) continue; m.set(k, m.has(k) ? null : x); }
    return m;
  };
  const v1BySerial = unique(inventory, serialOf);
  const v1ByName = unique(inventory, nameOf);
  const used = new Set();
  const pairs = [];
  for (const rec of records) {
    const v2 = rec.v2 ?? {};
    const byName = nameOf(v2) || norm(rec.summary?.deviceName);
    const hit = v1BySerial.get(serialOf(v2)) ?? v1ByName.get(byName) ?? null;
    if (hit && !used.has(hit)) { used.add(hit); pairs.push([rec, hit]); }
  }
  return { pairs, unpaired: inventory.filter(v => !used.has(v)) };
}

// For the probe script / tests.
/** Forget the token, cached lists and everything learned about the old key. */
function reset() {
  bearer.reset(); cache.clear();
  workingShape = null; assetScope = null; detailsNote = null; hardwareNote = null;
}
onIntegrationChange('connectwise', reset);

export const _raw = { call, bearer, reset };
