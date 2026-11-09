// TD SYNNEX (StreamOne Stellr) Microsoft subscriptions → the customer's Billing tab.
// Pure functions only (no I/O). Response shapes from api.us.tdsynnex.com:
//
//   GET /api/v1/customers                     → { data: { total, records: [{ customerNo, companyName, city, state, status }] } }
//   GET /api/v1/customers/{no}/subscriptions  → { data: [{ subscriptionId, productName, mfgPartNo, quantity,
//        billingFrequency: month|year|one_time, billingModel: fixed|usage, unitPrice (our cost),
//        customerPrice (the customer price set in Stellr), startDate, endDate (term end),
//        status: Activated|Suspend|Cancel|Expire|Open, vendorSubscriptionId }] }
//   GET /api/v1/cloud/invoices                → { data: { records: [{ issueDate, invoiceDetails: [{
//        vendorSubscriptionId, unitPrice, customerPrice, msrp, billingPeriod }] }] } }
//
// What the Billing tab keeps: unit_price = what we bill the customer (set from the Stellr
// customer price when a charge is first created, then the biller's to change); vendor_cost
// and vendor_msrp sit beside it, and seats / cost / term / status follow TD SYNNEX.

import { coerceDate } from './dates.js';
import { lineTotal } from './service-sync.js';

const str = (v) => (v == null ? '' : String(v).trim());
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ');
const num = (v) => { const n = Number(v); return v === null || v === '' || !Number.isFinite(n) ? null : n; };
const cents = (v) => (v == null ? null : Math.round(v * 100) / 100);
const dateText = (v) => { const r = coerceDate(v); return r.ok && r.value ? r.value : ''; };

export const FREQUENCY = { month: 'monthly', year: 'annually' };

export function customerOf(raw) {
  return {
    id: str(raw?.customerNo),
    name: str(raw?.companyName),
    city: str(raw?.city),
    state: str(raw?.state),
    status: str(raw?.status),
  };
}

// Commitment terms as TD SYNNEX writes them at the end of a product name.
const TERMS = [
  [/[\s\-–]*Annual Paid Monthly$/i, 'Annual commitment, billed monthly'],
  [/[\s\-–]*Annual Commit(ment)?$/i, 'Annual commitment'],
  [/[\s\-–]*Annual$/i, 'Annual commitment'],
  [/[\s\-–]*Monthly Commit(ment)?$/i, 'Monthly commitment'],
  [/[\s\-–]*Monthly$/i, 'Monthly commitment'],
  [/[\s\-–]*(Triennial|3[\s-]?Year)[^)]*$/i, '3-year commitment'],
];

/** "NCE Microsoft 365 Business Standard Annual Paid Monthly" → { description: "Microsoft 365 Business Standard", term: "Annual commitment, billed monthly" } */
export function cleanProduct(name) {
  let description = str(name).replace(/\s+/g, ' ').replace(/^NCE\s+/i, '');
  let term = '';
  for (const [re, label] of TERMS) {
    if (re.test(description)) { description = description.replace(re, '').trim(); term = label; break; }
  }
  return { description: description.replace(/[\s\-–]+$/, ''), term };
}

export function subscriptionOf(raw) {
  const r = raw ?? {};
  const { description, term } = cleanProduct(r.productName);
  return {
    key: str(r.subscriptionId),
    vendor_subscription_id: str(r.vendorSubscriptionId).toLowerCase(),
    product: str(r.productName),
    description,
    term,
    sku: str(r.mfgPartNo),
    quantity: num(r.quantity) ?? 0,
    frequency: FREQUENCY[r.billingFrequency] ?? null,
    billing_frequency: str(r.billingFrequency),
    billing_model: str(r.billingModel),
    cost: num(r.unitPrice),
    customer_price: num(r.customerPrice),
    term_end: str(r.endDate).slice(0, 10) || null,     // local date — TD SYNNEX writes the offset
    status: str(r.status),
    active: str(r.status) === 'Activated',
    parent: str(r.parentId),
    placeholder: /csp transfer/i.test(str(r.productName)) || /^dummy/i.test(str(r.offerId)),
  };
}

/** Why a subscription can't become a Billing-tab charge (null = it can). */
export function notImportable(sub) {
  if (sub.placeholder) return 'transfer placeholder, not a product';
  if (sub.billing_frequency === 'one_time') return 'one-time charge';
  if (sub.billing_model === 'usage') return 'usage-based (billed on consumption)';
  if (!sub.frequency) return `billed "${sub.billing_frequency || 'unknown'}"`;
  if (sub.status === 'Open') return 'still being provisioned';
  return null;
}

/**
 * MSRP (and the invoiced cost / customer price) for each subscription, from the newest
 * invoice line that billed it. Keyed by the Microsoft subscription ID, lower case.
 */
export function invoiceIndex(invoices) {
  const out = new Map();
  for (const inv of Array.isArray(invoices) ? invoices : []) {
    const issued = Date.parse(inv?.issueDate) || 0;
    for (const line of Array.isArray(inv?.invoiceDetails) ? inv.invoiceDetails : []) {
      const key = str(line?.vendorSubscriptionId).toLowerCase();
      if (!key) continue;
      const prev = out.get(key);
      if (prev && prev.issued >= issued) continue;
      out.set(key, { issued, msrp: num(line.msrp), cost: num(line.unitPrice), customer_price: num(line.customerPrice), period: str(line.billingPeriod) });
    }
  }
  return out;
}

// The day after a date, as YYYY-MM-DD → month number (an annual charge renews the day after its term ends).
function renewalMonth(termEnd) {
  const m = str(termEnd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.getUTCMonth() + 1;
}

/** A subscription → customer_recurring_charges columns. */
export function chargeFields(sub, invoiced) {
  const price = sub.customer_price ?? invoiced?.customer_price ?? null;
  return {
    description: sub.description,
    category: /azure/i.test(sub.product) ? 'Microsoft Azure' : 'Microsoft 365',
    quantity: sub.quantity,
    unit_label: 'licenses',
    unit_price: cents(price),
    frequency: sub.frequency,
    billing_month: sub.frequency === 'annually' ? renewalMonth(sub.term_end) : null,
    is_active: sub.active,
    vendor_cost: sub.cost ?? invoiced?.cost ?? null,
    vendor_msrp: invoiced?.msrp ?? null,
    term_end_date: sub.term_end,
    external_status: sub.status,
    notes: [sub.term, sub.sku && `SKU ${sub.sku}`].filter(Boolean).join(' · '),
  };
}

// Product names compared loosely: "M365 Business Standard" ≈ "Microsoft 365 Business Standard".
export const productKey = (v) => norm(v)
  .replace(/\bnce\b/g, ' ')
  .replace(/\b(m|o)365\b/g, 'microsoft 365')
  .replace(/\boffice 365\b/g, 'microsoft 365')
  .replace(/[^a-z0-9]+/g, '');

/**
 * The Billing-tab charge a subscription already is: an earlier import's link, then the
 * same product on the same cadence among charges not linked to anything else. Two
 * charges that both look like it are never guessed between.
 */
export function findChargeMatch(sub, charges, claimed = new Set()) {
  const pool = (charges ?? []).filter(c => !claimed.has(c.id));
  const linked = pool.find(c => c.source === 'tdsynnex' && c.external_id === sub.key);
  if (linked) return { charge: linked, reason: 'previous import' };
  const key = productKey(sub.description);
  if (!key) return { charge: null };
  const hits = pool.filter(c => !c.external_id && productKey(c.description) === key && (!sub.frequency || c.frequency === sub.frequency));
  if (hits.length === 1) return { charge: hits[0], reason: 'product name' };
  if (hits.length > 1) return { charge: null, ambiguous: hits };
  return { charge: null };
}

// FILL   - only written when blank: names, prices and notes belong to the biller.
// UPDATE - what TD SYNNEX knows better: seats, cadence, cost, MSRP, term, status.
export const CHARGE_FILL = ['description', 'category', 'unit_label', 'unit_price', 'notes'];
export const CHARGE_UPDATE = ['quantity', 'frequency', 'billing_month', 'is_active', 'vendor_cost', 'vendor_msrp', 'term_end_date', 'external_status'];
const MONEY = new Set(['unit_price', 'vendor_cost', 'vendor_msrp']);

const show = (field, v) => {
  if (v == null || v === '') return '';
  // Costs can carry fractions of a cent (11.723214) - up to 4 places, never fewer than 2.
  if (MONEY.has(field)) return `$${Number(v).toFixed(4).replace(/(\.\d\d\d*?)0+$/, '$1')}`;
  if (field === 'is_active') return v ? 'active' : 'inactive';
  if (field === 'term_end_date') return dateText(v);
  return str(v);
};
const blank = (v) => v == null || v === '';
const same = (field, a, b) => {
  if (MONEY.has(field) || field === 'quantity') return Math.abs(Number(a) - Number(b)) < 0.00005;
  if (field === 'is_active') return Boolean(a) === Boolean(b);
  if (field === 'term_end_date') return dateText(a) === dateText(b);
  return norm(a) === norm(b);
};

/**
 * What an import would change on an existing charge. `amount` (the line total) is
 * recomputed whenever seats or price move.
 * @returns {{ updates, changes: [{ field, from, to, mode }] }}
 */
export function planCharge(charge, fields) {
  const updates = {};
  const changes = [];
  for (const field of [...CHARGE_FILL, ...CHARGE_UPDATE]) {
    const to = fields[field];
    if (field === 'billing_month' && fields.frequency !== 'annually') continue;   // only annual charges anchor to a month
    if (blank(to) && field !== 'is_active') continue;                           // a blank from TD SYNNEX never erases
    const from = charge?.[field];
    if (blank(from)) {
      updates[field] = to;
      changes.push({ field, from: null, to: show(field, to), mode: 'fill' });
    } else if (CHARGE_UPDATE.includes(field) && !same(field, from, to)) {
      updates[field] = to;
      changes.push({ field, from: show(field, from), to: show(field, to), mode: 'update' });
    }
  }
  if ('quantity' in updates || 'unit_price' in updates) {
    const qty = updates.quantity ?? charge?.quantity;
    const price = updates.unit_price ?? (blank(charge?.unit_price) ? null : Number(charge.unit_price));
    updates.amount = lineTotal(qty, price);
  }
  if ('frequency' in updates && updates.frequency !== 'annually') updates.billing_month = null;
  return { updates, changes };
}

/** Margin per license per billing period, when both prices are known. */
export const marginOf = (unitPrice, cost) => (unitPrice == null || cost == null ? null : cents(Number(unitPrice) - Number(cost)));
