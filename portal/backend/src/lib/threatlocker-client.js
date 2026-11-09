import { config } from '../config/index.js';
import { makeCache, saidBy, fetchWithRetry, onIntegrationChange } from './integration-util.js';
import { rowsOf } from './threatlocker.js';

/**
 * READ-ONLY client for the ThreatLocker Portal API. The key comes from an API user with a
 * view-only role (Portal → Users → API Users). Requests go to
 * https://portalapi.<THREATLOCKER_INSTANCE>.threatlocker.com/portalapi/… with the raw key in
 * Authorization and the organization in ManagedOrganizationId. Only list calls are made.
 */

export function isThreatLockerConfigured() {
  return Boolean(config.threatlocker.apiKey && config.threatlocker.instance && config.threatlocker.organizationId);
}

export class ThreatLockerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const base = () => `https://portalapi.${String(config.threatlocker.instance).trim().toLowerCase()}.threatlocker.com/portalapi`;
const unreachable = () => new ThreatLockerError(`ThreatLocker could not be reached (${base()}). Check THREATLOCKER_INSTANCE.`);

async function post(path, body, orgId) {
  if (!isThreatLockerConfigured()) {
    throw new ThreatLockerError('ThreatLocker is not configured. An admin can set it up in Admin → Integrations.', 503);
  }
  const res = await fetchWithRetry(`${base()}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: config.threatlocker.apiKey,
      ManagedOrganizationId: orgId || config.threatlocker.organizationId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  }, unreachable);
  if (res.status === 401 || res.status === 403) {
    throw new ThreatLockerError(`ThreatLocker refused the request — check the API key, its role (View Organization / View Computers) and THREATLOCKER_ORGANIZATION_ID.${await saidBy(res, 'ThreatLocker')}`);
  }
  if (!res.ok) throw new ThreatLockerError(`ThreatLocker returned ${res.status}.${await saidBy(res, 'ThreatLocker')}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const PAGE = 500;
async function allPages(path, body, orgId) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const rows = rowsOf(await post(path, { ...body, pageNumber: page, pageSize: PAGE }, orgId));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const cache = makeCache(10 * 60 * 1000);

/** Every customer organization under the MSP's parent org. */
export const organizations = ({ refresh = false } = {}) =>
  cache.get('orgs', refresh, () => allPages('Organization/OrganizationGetChildOrganizationsByParameters', {
    orderBy: 'name', isAscending: true, includeAllChildren: true, includeProductBundles: true, searchText: '',
  }));

/** One organization's computers. */
export const computers = (orgId, { refresh = false } = {}) =>
  cache.get(`computers:${orgId}`, refresh, () => allPages('Computer/ComputerGetByAllParameters', {
    orderBy: 'computername', isAscending: true, childOrganizations: false, showLastCheckIn: true, showDeleted: false,
    searchText: '', action: '', kindOfAction: '',
  }, orgId));

onIntegrationChange('threatlocker', () => cache.clear());

export const _raw = { post, reset: () => cache.clear() };
