import { config } from '../config/index.js';
import { saidBy, fetchWithRetry, makeCache, makeBearer, onIntegrationChange } from './integration-util.js';

/**
 * Thin client for one Outlook calendar through Microsoft Graph - the team's shared calendar,
 * which lives in its owner's mailbox (whoever sent the sharing invite). App-only sign-in
 * (client credentials), so nobody has to stay signed in on the server.
 *
 *   POST   https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token   (scope …/.default)
 *   GET    /users/{owner}/calendars?$select=id,name                       (find the calendar by name)
 *   GET    /users/{owner}/calendars/{id}/calendarView?startDateTime=&endDateTime=
 *   GET    /users/{owner}/events/{id}                                     (one event / a series)
 *   PATCH  /users/{owner}/events/{id}                                     (edits made in the Portal)
 *   POST   /users/{owner}/calendars/{id}/events                           ("Add to Outlook" on a task)
 *   DELETE /users/{owner}/events/{id}                                     (only events a task put there)
 *
 * Event IDs are Graph's immutable IDs (Prefer: IdType="ImmutableId"), so a task can keep its
 * event's ID. Edits send the event's etag (If-Match), so a change someone made in Outlook in the
 * meantime is never silently overwritten. Reads are cached 10 seconds per range; every write
 * clears the cache so the change shows at once.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const PAGE_LIMIT = 10;   // × 250 events — far more than a 6-week calendar holds
const PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"';
const cache = makeCache(10_000);

export function isOutlookConfigured() {
  const o = config.outlook;
  return Boolean(o.tenantId && o.clientId && o.clientSecret && o.owner);
}

export class OutlookError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const unreachable = () => new OutlookError('Microsoft 365 could not be reached. Check this server\'s internet access.');
const owner = () => encodeURIComponent(config.outlook.owner.trim());
const eventUrl = (id) => `${GRAPH}/users/${owner()}/events/${encodeURIComponent(id)}`;

let calendarPath = null;

async function signIn() {
  if (!isOutlookConfigured()) {
    throw new OutlookError('The Outlook calendar is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const { tenantId, clientId, clientSecret } = config.outlook;
  const res = await fetchWithRetry(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  }, unreachable);
  if ([400, 401].includes(res.status)) {
    throw new OutlookError(`Microsoft rejected the app's sign-in — check the tenant ID, client ID (Admin → Integrations → Outlook) and that the client secret hasn't expired.${await saidBy(res, 'Microsoft')}`);
  }
  if (!res.ok) throw new OutlookError(`Microsoft returned ${res.status} when signing in.${await saidBy(res, 'Microsoft')}`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new OutlookError('Microsoft did not return an access token.');
  return { value: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

const bearer = makeBearer(signIn);

/** One Graph call. `etag` makes an edit conditional; `prefer` adds to the Prefer header. */
async function call(method, url, { body, etag, prefer } = {}) {
  const attempt = async () => fetchWithRetry(url, {
    method,
    headers: {
      Authorization: `Bearer ${await bearer()}`,
      Accept: 'application/json',
      Prefer: prefer ? `${PREFER}, ${prefer}` : PREFER,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(etag ? { 'If-Match': etag } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }, unreachable);
  let res = await attempt();
  if (res.status === 401) { bearer.expire(); res = await attempt(); }   // token expired early — once
  const writing = method !== 'GET';
  if (res.status === 403) {
    throw new OutlookError(writing
      ? `Microsoft refused to change ${config.outlook.owner}'s calendar — the app has read-only access. Grant it Calendars.ReadWrite (see Admin → Integrations → Outlook).${await saidBy(res, 'Microsoft')}`
      : `Microsoft refused to show ${config.outlook.owner}'s calendars — the app needs Calendars.Read or Calendars.ReadWrite (with admin consent), or an Exchange role assignment covering that mailbox.${await saidBy(res, 'Microsoft')}`, 403);
  }
  if (res.status === 412) throw new OutlookError('Someone changed this event in Outlook since it was loaded. Reload and try again.', 409);
  if (res.status === 404) {
    throw new OutlookError(url.includes('/events/')
      ? 'That event no longer exists in Outlook.'
      : `Microsoft 365 has no mailbox for ${config.outlook.owner} — the calendar owner (Admin → Integrations → Outlook) should be the email of whoever shared the calendar.${await saidBy(res, 'Microsoft')}`, 404);
  }
  if (!res.ok) throw new OutlookError(`Microsoft returned ${res.status} ${writing ? 'changing' : 'reading'} the calendar.${await saidBy(res, 'Microsoft')}`);
  if (writing) cache.clear();
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** The owner's calendar named OUTLOOK_CALENDAR_NAME, or their main calendar when it's blank. */
async function calendar() {
  if (calendarPath) return calendarPath;
  const name = String(config.outlook.calendarName ?? '').trim();
  if (!name) return (calendarPath = `${GRAPH}/users/${owner()}/calendar`);
  const body = await call('GET', `${GRAPH}/users/${owner()}/calendars?$select=id,name&$top=100`);
  const list = body?.value ?? [];
  const found = list.filter(c => String(c.name ?? '').trim().toLowerCase() === name.toLowerCase());
  if (found.length !== 1) {
    const names = list.map(c => `"${c.name}"`).join(', ') || 'none';
    throw new OutlookError(found.length
      ? `${config.outlook.owner} has ${found.length} calendars named "${name}" — rename one in Outlook.`
      : `${config.outlook.owner} has no calendar named "${name}". Their calendars: ${names}. Set the calendar name in Admin → Integrations to one of these (blank = their main calendar).`);
  }
  return (calendarPath = `${GRAPH}/users/${owner()}/calendars/${encodeURIComponent(found[0].id)}`);
}

const LIST_FIELDS = 'id,subject,start,end,isAllDay,location,showAs,sensitivity,isCancelled,categories,type,seriesMasterId';

/** Raw Graph events overlapping [startIso, endIso) - repeating events expanded into occurrences. */
export function calendarEvents(startIso, endIso, refresh = false) {
  return cache.get(`${startIso}|${endIso}`, refresh, async () => {
    let url = `${await calendar()}/calendarView?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}`
      + `&$select=${LIST_FIELDS}&$orderby=start/dateTime&$top=250`;
    const out = [];
    for (let page = 0; url && page < PAGE_LIMIT; page++) {
      const body = await call('GET', url);
      out.push(...(body?.value ?? []));
      url = body?.['@odata.nextLink'] ?? null;
    }
    return out;
  });
}

/** One event (or series) with its description as plain text and, for a series, its pattern. */
export function getEvent(id) {
  return call('GET', `${eventUrl(id)}?$select=${LIST_FIELDS},body,recurrence,isReminderOn,reminderMinutesBeforeStart`, { prefer: 'outlook.body-content-type="text"' });
}

export const updateEvent = (id, patch, etag) => call('PATCH', eventUrl(id), { body: patch, etag });
export const deleteEvent = (id) => call('DELETE', eventUrl(id));
export async function createEvent(payload) { return call('POST', `${await calendar()}/events`, { body: payload }); }

/** For scripts/integrations-check.js. */
/** Forget the token, the cached events and which calendar the old owner had. */
function reset() { bearer.reset(); cache.clear(); calendarPath = null; }
onIntegrationChange('outlook', reset);

export const _raw = { bearer, calendar, reset };
