import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import * as td from '../lib/tdsynnex-client.js';
import {
  customerOf, subscriptionOf, notImportable, invoiceIndex, chargeFields, findChargeMatch, planCharge,
} from '../lib/tdsynnex.js';
import { lineTotal } from '../lib/service-sync.js';
import { saveLink, linksFor, customersLinkedTo } from '../lib/integration-links.js';

// TD SYNNEX Microsoft subscriptions → a customer's Billing tab.
//
//   GET  /api/tdsynnex/customers                                   — TD SYNNEX end customers
//   GET  /api/customers/:customerId/tdsynnex/preview?customerNo=    — what an import would do
//   POST /api/customers/:customerId/tdsynnex/import                 — { customerNo, keys, location_id }
//
// Read-only against TD SYNNEX. Mapping and merge rules: lib/tdsynnex.js.

const NOT_CONFIGURED = {
  error: 'TD SYNNEX is not configured. An admin can set it up in Admin → Integrations.',
  configured: false,
};

function sendError(res, next, err) {
  if (err instanceof td.TdSynnexError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

export const tdSynnexRouter = Router();

tdSynnexRouter.get('/customers', requireAuth, async (req, res, next) => {
  if (!td.isTdSynnexConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const [rows, linked] = await Promise.all([td.customers({ refresh: req.query.refresh === '1' }), customersLinkedTo('tdsynnex')]);
    const customers = rows.map(customerOf).filter(c => c.id)
      .map(c => ({ ...c, linked: linked.get(c.id) ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    res.json({ customers });
  } catch (err) { sendError(res, next, err); }
});

async function buildPlan(customerId, customerNo, refresh) {
  const [tdCustomers, subs, invoices, { rows: charges }] = await Promise.all([
    td.customers({ refresh }),
    td.subscriptions(customerNo, { refresh }),
    td.invoices({ refresh }),
    query('SELECT * FROM customer_recurring_charges WHERE customer_id = $1 ORDER BY description', [customerId]),
  ]);
  const tdCustomer = tdCustomers.map(customerOf).find(c => c.id === String(customerNo));
  if (!tdCustomer) throw new td.TdSynnexError('That customer is no longer on the TD SYNNEX account.', 404);
  const invoiced = invoiceIndex(invoices);
  const claimed = new Set();
  const items = [];
  const skipped = [];
  for (const sub of subs.map(subscriptionOf)) {
    const why = notImportable(sub);
    if (why) { skipped.push({ name: sub.product, reason: why }); continue; }
    const fields = chargeFields(sub, invoiced.get(sub.vendor_subscription_id));
    const match = findChargeMatch(sub, charges, claimed);
    let preview = { action: 'create', charge: null, reason: null, changes: [] };
    if (match.charge) {
      claimed.add(match.charge.id);
      const { updates, changes } = planCharge(match.charge, fields);
      preview = { action: changes.length ? 'update' : 'unchanged', charge: { id: match.charge.id, name: match.charge.description }, reason: match.reason, changes, updates };
    } else if (match.ambiguous) {
      preview = { action: 'ambiguous', charge: null, reason: null, changes: [], candidates: match.ambiguous.map(c => ({ id: c.id, name: c.description })) };
    } else if (!sub.active) {
      // Cancelled / suspended / expired and not on the Billing tab: nothing to record.
      skipped.push({ name: sub.product, reason: `${sub.status.toLowerCase()} in TD SYNNEX` });
      continue;
    }
    items.push({ ...sub, fields, preview });
  }
  return { tdCustomer, items, skipped };
}

const publicItem = ({ preview: { updates, ...preview }, ...item }) => ({ ...item, preview });

export const customerTdSynnexRouter = Router({ mergeParams: true });

customerTdSynnexRouter.get('/preview', requireAuth, async (req, res, next) => {
  if (!td.isTdSynnexConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    if (!req.query.customerNo) return res.status(400).json({ error: 'customerNo is required.' });
    const plan = await buildPlan(req.params.customerId, req.query.customerNo, req.query.refresh === '1');
    res.json({
      customer: plan.tdCustomer,
      items: plan.items.map(publicItem),
      skipped: plan.skipped,
      links: await linksFor(req.params.customerId, 'tdsynnex'),
    });
  } catch (err) { sendError(res, next, err); }
});

customerTdSynnexRouter.post('/import', requireAuth, async (req, res, next) => {
  if (!td.isTdSynnexConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { customerId } = req.params;
    const customerNo = req.body?.customerNo;
    const keys = new Set(Array.isArray(req.body?.keys) ? req.body.keys.map(String) : []);
    const locationId = req.body?.location_id || null;
    if (!customerNo) return res.status(400).json({ error: 'customerNo is required.' });
    if (!keys.size) return res.status(400).json({ error: 'Pick at least one subscription to import.' });
    const { rows: cust } = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!cust[0]) return res.status(404).json({ error: 'Customer not found.' });

    const plan = await buildPlan(customerId, customerNo, false);
    const result = { created: [], updated: [], unchanged: [], skipped: [], failed: [] };
    const audit = (action, entityId, entityName, changes) => logAudit({
      userId: req.user.sub, userName: req.user.fullName, action, entityType: 'recurring_charge', entityId, entityName, changes, ipAddress: getClientIp(req) });
    const link = (sub) => ({ source: 'tdsynnex', external_id: sub.key, synced_at: new Date() });

    for (const sub of plan.items.filter(i => keys.has(i.key))) {
      const p = sub.preview;
      try {
        if (p.action === 'ambiguous') {
          result.skipped.push({ key: sub.key, name: sub.description, reason: `${p.candidates.length} charges look like "${sub.description}" — rename one, then try again` });
          continue;
        }
        if (p.charge) {
          const set = { ...p.updates, ...link(sub) };
          if (p.changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          await query(
            `UPDATE customer_recurring_charges SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND customer_id = $2`,
            [p.charge.id, customerId, ...cols.map(c => set[c])]);
          if (p.changes.length) {
            await audit('UPDATE', p.charge.id, `${p.charge.name} — updated from TD SYNNEX (${p.reason})`,
              Object.fromEntries(p.changes.map(c => [c.field, { from: c.from, to: c.to }])));
            result.updated.push({ key: sub.key, name: p.charge.name, changes: p.changes });
          } else {
            result.unchanged.push({ key: sub.key, name: p.charge.name });
          }
          continue;
        }
        const f = sub.fields;
        const { rows } = await query(
          `INSERT INTO customer_recurring_charges
             (customer_id, location_id, description, category, quantity, unit_price, unit_label, amount, frequency, interval_count,
              billing_month, billing_year, is_active, notes, created_by, source, external_id, vendor_cost, vendor_msrp, term_end_date,
              external_status, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,NULL,$11,$12,$13,'tdsynnex',$14,$15,$16,$17,$18,NOW()) RETURNING id, description`,
          [customerId, locationId, f.description, f.category, f.quantity, f.unit_price, f.unit_label, lineTotal(f.quantity, f.unit_price),
            f.frequency, f.billing_month, f.is_active, f.notes || null, req.user.sub, sub.key, f.vendor_cost, f.vendor_msrp, f.term_end_date,
            f.external_status]);
        await audit('CREATE', rows[0].id, `${rows[0].description} — imported from TD SYNNEX`);
        result.created.push({ key: sub.key, name: rows[0].description });
      } catch (e) {
        result.failed.push({ key: sub.key, name: sub.description, error: e.message });
      }
    }

    await saveLink({ customerId, provider: 'tdsynnex', externalId: customerNo, externalName: plan.tdCustomer.name, locationId, userId: req.user.sub });
    res.json(result);
  } catch (err) { sendError(res, next, err); }
});
