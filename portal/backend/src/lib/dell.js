// Dell warranty → Portal device fields. Pure functions only (no I/O), unit-tested.
//
// Dell's TechDirect warranty API (v5 asset-entitlements) answers per service tag:
//   { serviceTag, shipDate, productLineDescription, systemDescription, invalid,
//     entitlements: [{ startDate, endDate, entitlementType, serviceLevelCode,
//                      serviceLevelDescription, serviceLevelGroup }] }
// A machine usually has several entitlements (the base warranty, an upgrade to
// ProSupport, an extension bought later…); the warranty ends when the LAST of them does.

import { coerceDate } from './dates.js';

const str = (v) => (v == null ? '' : String(v).trim());

export const normalizeTag = (v) => str(v).toUpperCase().replace(/\s+/g, '');
// Dell service tags are 7 characters (older machines: 5), letters and digits.
export const isValidServiceTag = (t) => /^[A-Z0-9]{5,7}$/.test(normalizeTag(t));

/** Is this a Dell machine? Judged by manufacturer, then the model text ("Dell OptiPlex 7090"). */
export function isDell(device) {
  return /\b(dell|alienware)\b/i.test(`${str(device?.manufacturer)} ${str(device?.model)}`);
}

/** The service tag of a Portal device (computers keep it in service_tag, other gear in serial_number). */
export const tagOf = (device) => normalizeTag(device?.service_tag || device?.serial_number);

/**
 * An entitlement's end date as the calendar day Dell means. Dell stamps end dates at
 * the end of the local business day, in UTC — "2027-05-01T05:59:59Z" is April 30th in
 * the US — so step back 12 hours before taking the date: a stamp late in the UTC day
 * stays on its own day, one in the small hours belongs to the day before. Doesn't
 * depend on the server's time zone.
 */
export function endDateOf(iso) {
  const t = Date.parse(str(iso));
  if (!Number.isFinite(t)) return null;
  return new Date(t - 12 * 3600 * 1000).toISOString().slice(0, 10);
}

// Entitlements that aren't hardware warranty (software delivery records).
const NOT_WARRANTY = /digital delivery|software/i;

/**
 * One Dell asset → what the Portal keeps.
 * @returns {{ tag, expires: 'YYYY-MM-DD'|null, coverage: string, ship_date: string|null, product: string, invalid: boolean }}
 */
export function warrantyFromAsset(asset) {
  const a = asset ?? {};
  const list = (Array.isArray(a.entitlements) ? a.entitlements : [])
    .filter(e => endDateOf(e?.endDate) && !NOT_WARRANTY.test(str(e?.serviceLevelDescription)) && e?.serviceLevelGroup !== -99999);
  // The entitlement that runs longest decides the date and names the coverage.
  const last = list.reduce((best, e) => (!best || endDateOf(e.endDate) > endDateOf(best.endDate) ? e : best), null);
  return {
    tag:       normalizeTag(a.serviceTag),
    expires:   last ? endDateOf(last.endDate) : null,
    coverage:  last ? str(last.serviceLevelDescription) : '',
    ship_date: a.shipDate ? str(a.shipDate).slice(0, 10) : null,
    product:   str(a.systemDescription || a.productLineDescription),
    invalid:   Boolean(a.invalid) || !list.length && !a.shipDate,
  };
}

/** A stored DATE (pg hands back a Date at local midnight) or a string → 'YYYY-MM-DD' or ''. */
export const dateText = (v) => {
  const r = coerceDate(v);
  return r.ok && r.value ? r.value : '';
};

/**
 * What a warranty check would do to each Dell device.
 * @param devices Portal devices (any type; non-Dell ones are skipped)
 * @param results Map tag → Dell asset (from the client)
 * @returns rows [{ device_id, name, tag, current, current_coverage, expires, coverage, product, action }]
 *   action: 'fill' (no date yet) | 'update' (date differs) | 'unchanged' | 'not_found' (Dell
 *   doesn't know the tag) | 'no_tag' (Dell machine without a usable service tag)
 */
export function warrantyPlan(devices, results) {
  const rows = [];
  for (const d of devices ?? []) {
    if (!isDell(d)) continue;
    const tag = tagOf(d);
    const base = {
      device_id: d.id,
      name: d.label || d.computer_name || d.model || 'Unnamed device',
      device_type: d.device_type,
      tag,
      current: dateText(d.warranty_expires),
      current_coverage: str(d.warranty_coverage),
    };
    if (!isValidServiceTag(tag)) { rows.push({ ...base, action: 'no_tag' }); continue; }
    const asset = results?.get(tag);
    const w = asset ? warrantyFromAsset(asset) : null;
    if (!w || !w.expires) { rows.push({ ...base, product: w?.product ?? '', action: 'not_found' }); continue; }
    const action = !base.current ? 'fill' : base.current !== w.expires ? 'update' : 'unchanged';
    rows.push({ ...base, expires: w.expires, coverage: w.coverage, product: w.product, ship_date: w.ship_date, action });
  }
  return rows;
}
