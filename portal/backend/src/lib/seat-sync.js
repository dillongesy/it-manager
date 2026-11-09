// Seat counts from a security vendor (currently ThreatLocker) → the customer's Billing
// tab. Pure functions only.
//
// Each vendor account boils down to "products": { key, name, units, unit_label,
// frequency, term_end, status, active }. Each product updates the Billing-tab charge it
// is (or creates one). The price is ours, and lives on the Services tab: each product is
// linked to its Services entry ("ThreatLocker Complete (Monthly)"), so a new charge takes
// that price and a Services price change rolls down to it (lib/service-sync.js). An
// existing charge's different price is only replaced when the biller ticks "use the
// Services price". Seats, term end and status follow the vendor.

import { lineTotal } from './service-sync.js';
import { coerceDate } from './dates.js';

const str = (v) => (v == null ? '' : String(v).trim());
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ');
const key = (v) => norm(v).replace(/[^a-z0-9]+/g, '');
const dateText = (v) => { const r = coerceDate(v); return r.ok && r.value ? r.value : ''; };

export const VENDOR_WORD = { threatlocker: 'threatlocker' };

/**
 * The charge a product already is: linked by an earlier sync, else an unlinked charge
 * naming the vendor (and, when the vendor has several products, this product too). Two
 * candidates are never guessed between.
 */
export function findSeatCharge(provider, product, charges, claimed = new Set(), { manyProducts = false } = {}) {
  const pool = (charges ?? []).filter(c => !claimed.has(c.id));
  const linked = pool.find(c => c.source === provider && c.external_id === product.key);
  if (linked) return { charge: linked, reason: 'previous sync' };
  const word = VENDOR_WORD[provider] ?? provider;
  const productKey = key(product.name).replace(word, '');
  const hits = pool.filter(c => !c.external_id && key(c.description).includes(word)
    && (!manyProducts || !productKey || key(c.description).includes(productKey)));
  if (hits.length === 1) return { charge: hits[0], reason: 'name' };
  if (hits.length > 1) return { charge: null, ambiguous: hits };
  return { charge: null };
}

/**
 * The Services catalog entry a product is: the one whose name contains the product's (or
 * vice versa) - "ThreatLocker Complete (Monthly)" for "ThreatLocker Complete". When several
 * match ("… (Monthly)" and "… (Annual)"), the one on the product's cadence wins.
 */
export function findCatalogService(product, catalog) {
  const p = key(product.name);
  const hits = (catalog ?? []).filter(s => s.is_active !== false && key(s.name) && (p.includes(key(s.name)) || key(s.name).includes(p)));
  if (hits.length === 1) return hits[0];
  const freq = product.frequency || 'monthly';
  const sameCadence = hits.filter(s => (s.recurrence === 'annual' ? 'annually' : s.recurrence) === freq);
  return sameCadence.length === 1 ? sameCadence[0] : null;
}

const show = (field, v) => {
  if (v == null || v === '') return '';
  if (field === 'is_active') return v ? 'active' : 'inactive';
  if (field === 'term_end_date') return dateText(v);
  if (field === 'unit_price') return `$${Number(v).toFixed(2)}`;
  return str(v);
};
const priceOf = (v) => (v == null || v === '' ? null : Number(v));

/**
 * What a sync does to one existing charge.
 *   - seats / term end / status follow the vendor
 *   - the charge is linked to its Services entry when it isn't linked to one yet (so a
 *     Services price change rolls down to it, like a charge picked off the catalog)
 *   - a blank price is filled from the Services entry; a different price is the biller's
 *     and only changes when they ask (`useCatalogPrice`) - `price_option` says so
 * @returns {{ updates, changes: [{ field, from, to, mode }], price_option }}
 */
export function planSeatCharge(charge, product, service = null, { useCatalogPrice = false } = {}) {
  const updates = {};
  const changes = [];
  const set = (field, to, compare = (a, b) => str(a) === str(b)) => {
    if (to == null || to === '') return;
    const from = charge?.[field];
    if (from == null || from === '') { updates[field] = to; changes.push({ field, from: null, to: show(field, to), mode: 'fill' }); }
    else if (!compare(from, to)) { updates[field] = to; changes.push({ field, from: show(field, from), to: show(field, to), mode: 'update' }); }
  };
  set('quantity', product.units, (a, b) => Number(a) === Number(b));
  set('term_end_date', product.term_end ? dateText(product.term_end) : null, (a, b) => dateText(a) === dateText(b));
  set('external_status', product.status);
  if (product.active === false && charge?.is_active) { updates.is_active = false; changes.push({ field: 'is_active', from: 'active', to: 'inactive', mode: 'update' }); }
  if (!str(charge?.unit_label) && product.unit_label) { updates.unit_label = product.unit_label; changes.push({ field: 'unit_label', from: null, to: product.unit_label, mode: 'fill' }); }

  let price_option = null;
  if (service) {
    if (!charge?.service_catalog_id) {
      updates.service_catalog_id = service.id;
      changes.push({ field: 'service_catalog_id', from: null, to: service.name, mode: 'fill' });
    }
    const catalogPrice = priceOf(service.unit_price);
    const current = priceOf(charge?.unit_price);
    if (catalogPrice != null && current == null) set('unit_price', catalogPrice);
    else if (catalogPrice != null && Math.abs(current - catalogPrice) >= 0.005) {
      price_option = { from: current, to: catalogPrice, service: service.name };
      if (useCatalogPrice) { updates.unit_price = catalogPrice; changes.push({ field: 'unit_price', from: show('unit_price', current), to: show('unit_price', catalogPrice), mode: 'update' }); }
    }
  }
  if ('quantity' in updates || 'unit_price' in updates) {
    const qty = 'quantity' in updates ? updates.quantity : Number(charge?.quantity ?? 0);
    updates.amount = lineTotal(qty, 'unit_price' in updates ? updates.unit_price : priceOf(charge?.unit_price));
  }
  return { updates, changes, price_option };
}

/** A new charge for a product, named and priced after its Services entry when one matches (else price blank). */
export function newSeatCharge(provider, product, catalog, category) {
  const service = findCatalogService(product, catalog);
  const unitPrice = priceOf(service?.unit_price);
  const frequency = product.frequency || (service?.recurrence === 'annual' ? 'annually' : service?.recurrence) || 'monthly';
  // An annual charge renews the month after its term ends.
  const end = product.term_end ? dateText(product.term_end) : '';
  const renews = end ? new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10) + 1)).getUTCMonth() + 1 : null;
  return {
    description: service?.name ?? product.name,
    category,
    quantity: product.units,
    unit_label: product.unit_label,
    unit_price: unitPrice,
    amount: lineTotal(product.units, unitPrice),
    frequency,
    billing_month: frequency === 'monthly' ? null : renews,
    service_catalog_id: service?.id ?? null,
    service_name: service?.name ?? null,
    term_end_date: product.term_end ? dateText(product.term_end) || null : null,
    external_status: product.status || null,
    is_active: product.active !== false,
  };
}

/**
 * The whole plan for one customer. A product with 0 seats (e.g. no Protect computers in the
 * picked orgs) only touches a charge an earlier sync linked to it - never a charge matched by
 * name, which may belong to an org that just isn't picked - and that drop to 0 is flagged
 * (`to_zero`) so it isn't pre-ticked.
 */
export function planSeatSync(provider, products, charges, catalog, category, { useCatalogPrice = false } = {}) {
  const claimed = new Set();
  const manyProducts = (products ?? []).length > 1;
  return (products ?? []).map(product => {
    const match = findSeatCharge(provider, product, charges, claimed, { manyProducts });
    const none = Number(product.units) === 0;
    if (match.charge && (!none || match.reason === 'previous sync')) {
      claimed.add(match.charge.id);
      const service = findCatalogService(product, catalog);
      const { updates, changes, price_option } = planSeatCharge(match.charge, product, service, { useCatalogPrice });
      return { ...product, preview: {
        action: changes.length ? 'update' : 'unchanged',
        charge: { id: match.charge.id, name: match.charge.description, unit_price: priceOf(match.charge.unit_price) },
        reason: match.reason, changes, updates, price_option,
        to_zero: none && changes.some(c => c.field === 'quantity'),
        service: service ? { id: service.id, name: service.name, unit_price: priceOf(service.unit_price) } : null,
      } };
    }
    if (none) return { ...product, preview: { action: 'skip', charge: null, changes: [], reason: 'none' } };
    if (match.ambiguous) {
      return { ...product, preview: { action: 'ambiguous', charge: null, changes: [], candidates: match.ambiguous.map(c => ({ id: c.id, name: c.description })) } };
    }
    if (product.active === false) return { ...product, preview: { action: 'skip', charge: null, changes: [], reason: 'not active' } };
    return { ...product, preview: { action: 'create', charge: null, changes: [], create: newSeatCharge(provider, product, catalog, category) } };
  });
}
