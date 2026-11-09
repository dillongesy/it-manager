import { config } from '../config/index.js';
import { makeCache, saidBy, fetchWithRetry, onIntegrationChange } from './integration-util.js';
import { sessionOf, joinUrl } from './screenconnect.js';

/**
 * READ-ONLY client for ScreenConnect's RESTful API Manager extension.
 *
 *   POST {instance}/App_Extensions/{extensionId}/Service.ashx/GetSessionsByFilter
 *        header CTRLAuthHeader: <RESTfulAuthenticationSecret>   body ["SessionType = 'Access'"]
 *
 * The extension's one shared secret also unlocks methods that run commands on every
 * machine. This client only ever calls GetSessionsByFilter, and the secret never leaves
 * the backend — the browser gets plain join links.
 *
 * One call returns every machine (a few hundred); it's cached for 3 minutes and shared
 * by every customer's Devices tab.
 */

export function isScreenConnectConfigured() {
  return Boolean(config.screenConnect.url && config.screenConnect.secret);
}

export class ScreenConnectError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const instance = () => String(config.screenConnect.url ?? '').replace(/\/+$/, '');
const unreachable = () => new ScreenConnectError(`ScreenConnect could not be reached (${instance()}).`);

async function call(method, args) {
  if (!isScreenConnectConfigured()) {
    throw new ScreenConnectError('ScreenConnect is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const res = await fetchWithRetry(`${instance()}/App_Extensions/${config.screenConnect.extensionId}/Service.ashx/${method}`, {
    method: 'POST',
    headers: {
      CTRLAuthHeader: config.screenConnect.secret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: instance(),
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  }, unreachable);
  if (res.status === 401 || res.status === 403) {
    throw new ScreenConnectError('ScreenConnect refused the API secret — the RESTful API secret in Admin → Integrations must match the RESTful API Manager\'s RESTfulAuthenticationSecret setting.');
  }
  if (res.status === 404) {
    throw new ScreenConnectError('ScreenConnect answered 404 — is the RESTful API Manager extension installed (Admin → Extensions)?');
  }
  if (!res.ok) throw new ScreenConnectError(`ScreenConnect returned ${res.status}.${await saidBy(res, 'ScreenConnect')}`);
  return res.json();
}

const cache = makeCache(3 * 60 * 1000);

/** Every live Access session, as small sessionOf() records. */
export const sessions = ({ refresh = false } = {}) =>
  cache.get('sessions', refresh, async () => {
    const raw = await call('GetSessionsByFilter', ["SessionType = 'Access'"]);
    return (Array.isArray(raw) ? raw : []).map(sessionOf).filter(s => s.id && !s.ended);
  });

export const joinUrlFor = (sessionId) => joinUrl(instance(), config.screenConnect.group, sessionId);
// Opens ScreenConnect's Join-with-options dialog, where Backstage is picked.
export const optionsUrlFor = (sessionId) => joinUrl(instance(), config.screenConnect.group, sessionId, 'JoinWithOptions');

onIntegrationChange('screenconnect', () => cache.clear());

export const _raw = { call, reset: () => cache.clear() };
