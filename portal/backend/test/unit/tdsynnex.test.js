// TD SYNNEX Microsoft subscriptions → the Billing tab. Fixtures are shaped like what
// api.us.tdsynnex.com returned for a live MSP account (2026-10-26). The failures this prevents: a seat
// change that never reaches the Billing tab, a biller's own price overwritten by TD
// SYNNEX's, and a cancelled subscription still counted as revenue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanProduct, subscriptionOf, notImportable, invoiceIndex, chargeFields, findChargeMatch, planCharge, productKey, marginOf,
} from '../../src/lib/tdsynnex.js';

const raw = (o = {}) => ({
  subscriptionId: '1926227_2', productName: 'NCE Microsoft 365 Business Standard Annual Paid Monthly', mfgPartNo: 'C0LDPB-0001-1Y1M',
  offerId: 'CFQ7TTC0LDPB:0001', quantity: 5, billingFrequency: 'month', billingModel: 'fixed', unitPrice: 12.23, customerPrice: 14.7,
  startDate: '2026-10-08T07:58:28.000-0700', endDate: '2027-06-26T16:59:59.000-0700', status: 'Activated',
  vendorSubscriptionId: '5C414DB6-F62B-4107-C21B-7EB3B4B028B2', parentId: '', ...o,
});

test('product names lose the NCE prefix and the term moves to its own field', () => {
  assert.deepEqual(cleanProduct('NCE Microsoft 365 Business Standard Annual Paid Monthly'), { description: 'Microsoft 365 Business Standard', term: 'Annual commitment, billed monthly' });
  assert.deepEqual(cleanProduct('NCE Exchange Online (Plan 1) Annual'), { description: 'Exchange Online (Plan 1)', term: 'Annual commitment' });
  assert.deepEqual(cleanProduct('NCE Microsoft Teams Essentials  Monthly Commit'), { description: 'Microsoft Teams Essentials', term: 'Monthly commitment' });
  assert.equal(cleanProduct('NCE Microsoft 365 Business Premium (Nonprofit Staff Pricing)- Annual Paid Monthly').description, 'Microsoft 365 Business Premium (Nonprofit Staff Pricing)');
  assert.deepEqual(cleanProduct('M365 Business Standard'), { description: 'M365 Business Standard', term: '' });
});

test('placeholders, one-time, usage-based and pending lines are not Billing-tab charges', () => {
  assert.equal(notImportable(subscriptionOf(raw())), null);
  assert.match(notImportable(subscriptionOf(raw({ productName: 'CSP Transfer', offerId: 'dummy_csp_transfer_offerID', billingFrequency: 'one_time' }))), /placeholder/);
  assert.match(notImportable(subscriptionOf(raw({ productName: 'MICROSOFT AZURE PLAN', billingModel: 'usage' }))), /usage/);
  assert.match(notImportable(subscriptionOf(raw({ status: 'Open' }))), /provisioned/);
});

test('MSRP comes from the newest invoice line for that subscription', () => {
  const idx = invoiceIndex([
    { issueDate: '2026-09-15T00:00:00-0700', invoiceDetails: [{ vendorSubscriptionId: '5c414db6-f62b-4107-c21b-7eb3b4b028b2', msrp: 12.5, unitPrice: 12.0 }] },
    { issueDate: '2026-10-15T00:00:00-0700', invoiceDetails: [{ vendorSubscriptionId: '5C414DB6-F62B-4107-C21B-7EB3B4B028B2', msrp: 13.13, unitPrice: 12.23, customerPrice: 14.7 }] },
  ]);
  assert.equal(idx.get('5c414db6-f62b-4107-c21b-7eb3b4b028b2').msrp, 13.13);
});

test('a subscription → a charge: seats, cadence, cost, MSRP, term, and the Stellr customer price', () => {
  const f = chargeFields(subscriptionOf(raw()), { msrp: 13.13 });
  assert.deepEqual(
    { d: f.description, c: f.category, q: f.quantity, u: f.unit_label, p: f.unit_price, fr: f.frequency, m: f.billing_month, cost: f.vendor_cost, msrp: f.vendor_msrp, end: f.term_end_date, active: f.is_active },
    { d: 'Microsoft 365 Business Standard', c: 'Microsoft 365', q: 5, u: 'licenses', p: 14.7, fr: 'monthly', m: null, cost: 12.23, msrp: 13.13, end: '2027-06-26', active: true });
  assert.equal(f.notes, 'Annual commitment, billed monthly · SKU C0LDPB-0001-1Y1M');
  // Paid annually: anchored to the month it renews — the day after the term ends.
  const annual = chargeFields(subscriptionOf(raw({ billingFrequency: 'year', endDate: '2027-10-31T16:59:59.000-0700' })));
  assert.equal(annual.frequency, 'annually');
  assert.equal(annual.billing_month, 11);
  assert.equal(marginOf(14.7, 12.23), 2.47);
});

test('matching: an earlier import, else the same product on the same cadence', () => {
  const sub = subscriptionOf(raw());
  assert.equal(findChargeMatch(sub, [{ id: 'a', source: 'tdsynnex', external_id: '1926227_2', description: 'Office' }]).reason, 'previous import');
  assert.equal(findChargeMatch(sub, [{ id: 'a', description: 'M365 Business Standard', frequency: 'monthly' }]).reason, 'product name');
  assert.equal(findChargeMatch(sub, [{ id: 'a', description: 'Microsoft 365 Business Standard', frequency: 'annually' }]).charge, null);
  assert.equal(findChargeMatch(sub, [{ id: 'a', description: 'Microsoft 365 Business Standard', frequency: 'monthly', external_id: 'other' }]).charge, null);
  assert.equal(findChargeMatch(sub, [
    { id: 'a', description: 'Microsoft 365 Business Standard', frequency: 'monthly' },
    { id: 'b', description: 'microsoft 365 business standard', frequency: 'monthly' },
  ]).ambiguous.length, 2);
  assert.equal(productKey('NCE Office 365 E3'), productKey('Microsoft 365 E3'));
});

test('merge: seats, cost and term follow TD SYNNEX; the biller\'s price and name stay; the line total follows the seats', () => {
  const fields = chargeFields(subscriptionOf(raw({ quantity: 7 })), { msrp: 13.13 });
  const charge = { description: 'M365 Business Standard', quantity: '5', unit_price: '15.00', amount: '75.00', frequency: 'monthly', is_active: true,
    vendor_cost: null, term_end_date: new Date(2027, 5, 26), notes: 'priced per contract' };
  const { updates, changes } = planCharge(charge, fields);
  const by = Object.fromEntries(changes.map(c => [c.field, c]));
  assert.deepEqual([by.quantity.from, by.quantity.to, by.quantity.mode], ['5', '7', 'update']);
  assert.equal(by.unit_price, undefined);              // our $15.00 stays — not TD SYNNEX's $14.70
  assert.equal(by.description, undefined);
  assert.equal(by.notes, undefined);
  assert.equal(by.term_end_date, undefined);           // same day (pg Date vs string)
  assert.equal(by.vendor_cost.mode, 'fill');
  assert.equal(by.vendor_msrp.to, '$13.13');
  assert.equal(updates.amount, 105);                   // 7 × $15.00
  // Applying it and planning again changes nothing.
  assert.deepEqual(planCharge({ ...charge, ...updates }, fields).changes, []);
});

test('a cancelled subscription turns its charge inactive, so it drops out of the revenue totals', () => {
  const fields = chargeFields(subscriptionOf(raw({ status: 'Cancel' })));
  const { updates, changes } = planCharge({ description: 'x', quantity: 5, unit_price: 14.7, frequency: 'monthly', is_active: true, external_status: 'Activated' }, fields);
  assert.equal(updates.is_active, false);
  assert.ok(changes.some(c => c.field === 'is_active' && c.to === 'inactive'));
  assert.ok(changes.some(c => c.field === 'external_status' && c.to === 'Cancel'));
});
