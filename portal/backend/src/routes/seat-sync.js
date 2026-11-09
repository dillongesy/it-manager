import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { config } from '../config/index.js';
import * as tl from '../lib/threatlocker-client.js';
import { orgOf, computerOf, threatlockerProducts } from '../lib/threatlocker.js';
import { planSeatSync } from '../lib/seat-sync.js';
import { saveLink, linksFor, customersLinkedTo } from '../lib/integration-links.js';

// Seat counts from ThreatLocker → a customer's Billing tab.
//
//   GET  /api/seat-sync/:provider/accounts                          — the vendor's customers
//   GET  /api/customers/:customerId/seat-sync/:provider/preview?account=<id>[,<id>…]
//   POST /api/customers/:customerId/seat-sync/:provider/apply       — { account, keys, location_id, use_catalog_price }
//
// `account` may name several vendor accounts — one Portal customer can be two ThreatLocker
// orgs (e.g. "NORTHWIND-C" for its Complete computers, "NORTHWIND-P" for Protect); seats are added
// up across them and each one is linked to the customer.
// Read-only against the vendors. Planning rules: lib/seat-sync.js (seats / term / status
// follow the vendor; the price comes from the Services tab).

const MAX_ACCOUNTS = 10;
const accountIds = (v) => [...new Set(String(v ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, MAX_ACCOUNTS);

class ProviderError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const PROVIDERS = {
  threatlocker: {
    label: 'ThreatLocker',
    category: 'Security',
    configured: tl.isThreatLockerConfigured,
    Err: tl.ThreatLockerError,
    notConfigured: 'ThreatLocker is not configured. An admin can set it up in Admin → Integrations.',
    async accounts(refresh) {
      // The list includes the MSP's own (parent, "MSP") organization — not a customer.
      return (await tl.organizations({ refresh })).map(orgOf).filter(o => o.id && o.name && !o.is_msp && o.id !== config.threatlocker.organizationId)
        .map(o => ({ id: o.id, name: o.name, detail: [o.bundles.join(', '), o.computer_count != null ? `${o.computer_count} computers` : null, o.billing].filter(Boolean).join(' · ') }));
    },
    async products(ids, refresh) {
      const all = (await tl.organizations({ refresh })).map(orgOf);
      const orgs = ids.map(id => all.find(o => o.id === id));
      if (orgs.some(o => !o)) throw new ProviderError('One of those organizations is no longer under your ThreatLocker account.', 404);
      const computers = (await Promise.all(orgs.map(o => tl.computers(o.id, { refresh })))).flat().map(computerOf);
      return {
        account: { id: ids.join(','), name: orgs.map(o => o.name).join(' + '), parts: orgs.map(o => ({ id: o.id, name: o.name })) },
        products: threatlockerProducts(orgs, computers),
      };
    },
  },
};

function provider(req, res) {
  const p = PROVIDERS[req.params.provider];
  if (!p) { res.status(404).json({ error: 'Unknown provider.' }); return null; }
  if (!p.configured()) { res.status(503).json({ error: p.notConfigured, configured: false }); return null; }
  return p;
}

function sendError(p, res, next, err) {
  if (err instanceof ProviderError || (p && err instanceof p.Err)) return res.status(err.status).json({ error: err.message });
  return next(err);
}

export const seatSyncRouter = Router();

seatSyncRouter.get('/:provider/accounts', requireAuth, async (req, res, next) => {
  const p = provider(req, res); if (!p) return;
  try {
    const [accounts, linked] = await Promise.all([p.accounts(req.query.refresh === '1'), customersLinkedTo(req.params.provider)]);
    accounts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    res.json({ label: p.label, accounts: accounts.map(a => ({ ...a, linked: linked.get(a.id) ?? [] })) });
  } catch (err) { sendError(p, res, next, err); }
});

async function buildPlan(p, providerKey, customerId, ids, refresh, opts = {}) {
  const [{ account, products }, { rows: charges }, { rows: catalog }] = await Promise.all([
    p.products(ids, refresh),
    query('SELECT * FROM customer_recurring_charges WHERE customer_id = $1 ORDER BY description', [customerId]),
    query('SELECT id, name, unit_price, recurrence, is_active FROM service_catalog'),
  ]);
  return { account, items: planSeatSync(providerKey, products, charges, catalog, p.category, opts) };
}

const publicItem = ({ preview: { updates, ...preview }, ...item }) => ({ ...item, preview });

export const customerSeatSyncRouter = Router({ mergeParams: true });

customerSeatSyncRouter.get('/:provider/preview', requireAuth, async (req, res, next) => {
  const p = provider(req, res); if (!p) return;
  try {
    if (!accountIds(req.query.account).length) return res.status(400).json({ error: 'account is required.' });
    const plan = await buildPlan(p, req.params.provider, req.params.customerId, accountIds(req.query.account), req.query.refresh === '1');
    res.json({ label: p.label, account: plan.account, items: plan.items.map(publicItem), links: await linksFor(req.params.customerId, req.params.provider) });
  } catch (err) { sendError(p, res, next, err); }
});

customerSeatSyncRouter.post('/:provider/apply', requireAuth, async (req, res, next) => {
  const p = provider(req, res); if (!p) return;
  try {
    const { customerId, provider: providerKey } = req.params;
    const ids = accountIds(req.body?.account);
    const keys = new Set(Array.isArray(req.body?.keys) ? req.body.keys.map(String) : []);
    const locationId = req.body?.location_id || null;
    if (!ids.length) return res.status(400).json({ error: 'account is required.' });
    if (!keys.size) return res.status(400).json({ error: 'Pick at least one product to sync.' });
    const { rows: cust } = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!cust[0]) return res.status(404).json({ error: 'Customer not found.' });

    const plan = await buildPlan(p, providerKey, customerId, ids, false, { useCatalogPrice: req.body?.use_catalog_price === true });
    const result = { created: [], updated: [], unchanged: [], skipped: [], failed: [] };
    const audit = (action, entityId, entityName, changes) => logAudit({
      userId: req.user.sub, userName: req.user.fullName, action, entityType: 'recurring_charge', entityId, entityName, changes, ipAddress: getClientIp(req) });

    for (const item of plan.items.filter(i => keys.has(i.key))) {
      const pv = item.preview;
      try {
        if (pv.action === 'ambiguous' || pv.action === 'skip') {
          result.skipped.push({ key: item.key, name: item.name, reason: pv.action === 'skip' ? (pv.reason === 'none' ? `no ${item.name} computers in ${plan.account.name}` : 'not active') :`${pv.candidates.length} charges look like it — rename one, then try again` });
          continue;
        }
        if (pv.charge) {
          const set = { ...pv.updates, source: providerKey, external_id: item.key, synced_at: new Date() };
          if (pv.changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          await query(`UPDATE customer_recurring_charges SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND customer_id = $2`,
            [pv.charge.id, customerId, ...cols.map(c => set[c])]);
          if (pv.changes.length) {
            await audit('UPDATE', pv.charge.id, `${pv.charge.name} — updated from ${p.label}`, Object.fromEntries(pv.changes.map(c => [c.field, { from: c.from, to: c.to }])));
            result.updated.push({ key: item.key, name: pv.charge.name, changes: pv.changes });
          } else {
            result.unchanged.push({ key: item.key, name: pv.charge.name });
          }
          continue;
        }
        const c = pv.create;
        const { rows } = await query(
          `INSERT INTO customer_recurring_charges
             (customer_id, location_id, description, category, quantity, unit_price, unit_label, amount, frequency, interval_count,
              billing_month, billing_year, is_active, service_catalog_id, created_by, source, external_id, term_end_date, external_status, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$17,NULL,$10,$11,$12,$13,$14,$15,$16,NOW()) RETURNING id, description`,
          [customerId, locationId, c.description, c.category, c.quantity, c.unit_price, c.unit_label, c.amount, c.frequency,
            c.is_active, c.service_catalog_id, req.user.sub, providerKey, item.key, c.term_end_date, c.external_status, c.billing_month]);
        await audit('CREATE', rows[0].id, `${rows[0].description} — added from ${p.label}`);
        result.created.push({ key: item.key, name: rows[0].description, priced: c.unit_price != null });
      } catch (e) {
        result.failed.push({ key: item.key, name: item.name, error: e.message });
      }
    }

    for (const part of plan.account.parts ?? [plan.account]) {
      await saveLink({ customerId, provider: providerKey, externalId: part.id, externalName: part.name, locationId, userId: req.user.sub });
    }
    res.json(result);
  } catch (err) { sendError(p, res, next, err); }
});
