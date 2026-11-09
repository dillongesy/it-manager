// ThreatLocker → seat counts for the Billing tab. Pure functions only.
//
// Portal API (spec: https://portalapi.<instance>.threatlocker.com/swagger/public/swagger.json):
//   POST /portalapi/Organization/OrganizationGetChildOrganizationsByParameters
//        { orderBy: 'name', pageNumber, pageSize, includeAllChildren, includeProductBundles }
//   POST /portalapi/Computer/ComputerGetByAllParameters   (header ManagedOrganizationId = the org)
//        { orderBy: 'computername', pageNumber, pageSize, childOrganizations, showLastCheckIn, showDeleted }
// The spec documents requests but not responses, so fields are read from the first of
// several likely names (scripts/integrations-check.js prints a real record once a key is set).

const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);
const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

/** The list inside a response, whatever the envelope calls it. */
export function rowsOf(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['data', 'items', 'results', 'organizations', 'computers', 'records']) if (Array.isArray(body?.[k])) return body[k];
  return [];
}

// Every organization lists the full product catalog in `products`, with isEnabledProduct
// set on the ones it actually has, so only enabled products count as bundles.
// billingMethod is "device" or "user".
const BILLING = { device: 'per device', user: 'per user' };

export function orgOf(raw) {
  const bundles = list(pick(raw, 'productBundles', 'packages', 'products', 'bundles'))
    .filter(b => typeof b === 'string' || b?.isEnabledProduct !== false)
    .map(b => str(typeof b === 'string' ? b : (b?.displayName ?? b?.productBundleName ?? b?.name))).filter(Boolean);
  const count = Number(pick(raw, 'computerCount', 'computersCount', 'numberOfComputers', 'totalComputers', 'computers'));
  const billing = str(pick(raw, 'billingMethod', 'billingModel', 'licenseMethod'));
  return {
    id: str(pick(raw, 'organizationId', 'id', 'organizationID')),
    name: str(pick(raw, 'name', 'displayName', 'organizationName')),
    parent_id: str(pick(raw, 'parentId', 'parentOrganizationId')),
    is_msp: /msp/i.test(str(raw?.businessClassificationName)),
    billing: BILLING[billing.toLowerCase()] ?? billing,
    bundles,
    computer_count: Number.isFinite(count) ? count : null,
  };
}

export function computerOf(raw) {
  const caps = raw?.maintenanceCapabilities ?? {};
  return {
    id: str(pick(raw, 'computerId', 'id')),
    name: str(pick(raw, 'computerName', 'hostname', 'name')),
    mode: str(pick(raw, 'action', 'computerMode', 'mode', 'maintenanceTypeName')),
    last_checkin: str(pick(raw, 'lastCheckin', 'lastCheckIn', 'lastCheckinDate')) || null,
    version: str(pick(raw, 'threatLockerVersion', 'threatlockerVersion', 'agentVersion')),
    deleted: Boolean(pick(raw, 'isDeleted', 'deleted')),
    org_id: str(raw?.organizationId),
    caps: {
      allowlisting: Boolean(caps.applicationControl),
      network: Boolean(caps.networkControl),
      storage: Boolean(caps.storageControl),
      detect: Boolean(caps.detect),
      elevation: Boolean(caps.elevation),
    },
  };
}

// The bundles sold. Complete = Allowlisting, Ringfencing, Network Control, Configuration Manager,
// Elevation, Storage Control, Endpoint Detect. Protect = the first four. ThreatLocker reports
// each computer's modules in `maintenanceCapabilities` (Ringfencing rides with allowlisting,
// Configuration Manager isn't listed), so a computer with any Complete-only module is Complete.
export const PACKAGES = [
  { key: 'complete', name: 'ThreatLocker Complete', modules: ['elevation', 'storage', 'detect'] },
  { key: 'protect', name: 'ThreatLocker Protect', modules: ['allowlisting', 'network'] },
];
const MODULE_LABEL = { elevation: 'Elevation', storage: 'Storage Control', detect: 'Endpoint Detect', allowlisting: 'Allowlisting', network: 'Network Control' };

/**
 * Which package one computer is billed as, plus the Complete modules it's missing (seen
 * live: a Complete customer with Elevation switched off). null = no protection modules.
 */
export function packageOf(computer) {
  const caps = computer?.caps ?? {};
  const complete = PACKAGES[0].modules;
  if (complete.some(m => caps[m])) return { key: 'complete', missing: complete.filter(m => !caps[m]).map(m => MODULE_LABEL[m]) };
  if (PACKAGES[1].modules.some(m => caps[m])) return { key: 'protect', missing: [] };
  return null;
}

/**
 * The customer's ThreatLocker org(s) → one seat line per package, adding up computers across
 * every org linked to the customer (a customer with both packages usually has two orgs, e.g.
 * "NORTHWIND-C" + "NORTHWIND-P"). Both packages are always returned - a 0 tells the planner there's
 * nothing to bill, so it can leave an unlinked charge alone (see lib/seat-sync.js).
 */
export function threatlockerProducts(orgs, computers) {
  const many = list(orgs).length > 1;
  const orgName = new Map(list(orgs).map(o => [o.id, o.name]));
  const live = list(computers).filter(c => !c.deleted);
  const unprotected = live.filter(c => !packageOf(c));
  return PACKAGES.map(pkg => {
    const mine = live.map(c => ({ c, p: packageOf(c) })).filter(x => x.p?.key === pkg.key);
    const missing = new Map();
    for (const { p } of mine) for (const m of p.missing) missing.set(m, (missing.get(m) ?? 0) + 1);
    const notes = [...missing].map(([m, n]) => `${n} without ${m} turned on`);
    if (pkg.key === 'complete' && unprotected.length) notes.push(`${unprotected.length} computer${unprotected.length !== 1 ? 's' : ''} with no protection modules (not counted)`);
    return {
      key: pkg.key,
      name: pkg.name,
      units: mine.length,
      unit_label: 'computers',
      frequency: 'monthly',
      term_end: null,
      status: null,
      active: true,
      notes,
      detail: mine.map(({ c, p }) => [
        c.name,
        many && orgName.get(c.org_id) ? `· ${orgName.get(c.org_id)}` : '',
        c.mode ? `(${c.mode})` : '',
        p.missing.length ? `— no ${p.missing.join(', ')}` : '',
      ].filter(Boolean).join(' ')),
    };
  });
}
