import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { priceSyncPlan } from '../lib/service-sync.js';
import { coerceIntervalCount } from '../lib/cadence.js';

const router = Router();

const RECURRENCES = ['monthly', 'quarterly', 'semiannual', 'annual'];

// Free-text fields we suggest previously-entered values for. Whitelisted so the
// column name can never come from the query string.
const SUGGEST_FIELDS = ['category', 'unit_label'];

function normalize(body) {
  const billing_type = body.billing_type === 'one_time' ? 'one_time' : 'recurring';
  const recurrence = billing_type === 'recurring'
    ? (RECURRENCES.includes(body.recurrence) ? body.recurrence : 'monthly')
    : null;
  // How many periods between bills - 3 for something sold three years at a time.
  // Forced back to 1 for one-time services and any non-annual period.
  const recurrence_count = billing_type === 'recurring'
    ? coerceIntervalCount(body.recurrence_count, recurrence)
    : 1;
  const unit_price = body.unit_price != null && body.unit_price !== '' ? parseFloat(body.unit_price) : null;
  return { billing_type, recurrence, recurrence_count, unit_price };
}

// GET /api/service-catalog?q=&includeInactive=1 - list (active only by default),
// name-matched when ?q is given. Used both by the Services page and the WO autocomplete.
// Each row carries `linked_charge_count` - how many ACTIVE customer recurring charges
// are tied to it, i.e. how many billing lines a price change would move.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q, includeInactive } = req.query;
    const conds = [];
    const params = [];
    if (includeInactive !== '1' && includeInactive !== 'true') conds.push('sc.is_active = true');
    if (q) { params.push(`%${q}%`); conds.push(`sc.name ILIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT sc.*,
              (SELECT COUNT(*)::int FROM customer_recurring_charges rc
                WHERE rc.service_catalog_id = sc.id AND rc.is_active = true) AS linked_charge_count
         FROM service_catalog sc ${where} ORDER BY sc.name LIMIT 200`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/service-catalog/suggestions?field=category|unit_label&q= - distinct values
// already entered ANYWHERE (catalog services + customer recurring charges), so a
// category typed once on a customer suggests itself on the Services page and vice
// versa. Keeps naming consistent instead of "Antivirus"/"anti-virus"/"AV" drift.
router.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    const { field, q } = req.query;
    if (!SUGGEST_FIELDS.includes(field)) {
      return res.status(400).json({ error: `field must be one of: ${SUGGEST_FIELDS.join(', ')}` });
    }
    const params = [`%${q ?? ''}%`];
    const { rows } = await query(
      `SELECT value FROM (
         SELECT DISTINCT ${field} AS value FROM service_catalog
          WHERE ${field} IS NOT NULL AND ${field} <> ''
         UNION
         SELECT DISTINCT ${field} AS value FROM customer_recurring_charges
          WHERE ${field} IS NOT NULL AND ${field} <> ''
       ) s
       WHERE value ILIKE $1
       ORDER BY value LIMIT 20`, params
    );
    res.json(rows.map(r => r.value));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, notes, category, unit_label } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });
    const { billing_type, recurrence, recurrence_count, unit_price } = normalize(req.body ?? {});
    const { rows } = await query(
      `INSERT INTO service_catalog (name, unit_price, billing_type, recurrence, recurrence_count, notes, category, unit_label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name.trim(), unit_price, billing_type, recurrence, recurrence_count, notes || null, category || null, unit_label || null, req.user.sub]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'service', entityId: rows[0].id, entityName: rows[0].name, ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/service-catalog/:id
// Body may include `propagate_price` (default TRUE): when the unit price changes,
// every ACTIVE customer recurring charge linked to this service is re-priced in the
// same transaction - that's the whole point of the link. Pass propagate_price:false
// to change the catalog price for FUTURE customers only. Response carries
// `price_sync: { updated, skipped, from, to }` so the UI can report what moved.
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: before } = await query('SELECT * FROM service_catalog WHERE id = $1', [req.params.id]);
    if (!before[0]) return res.status(404).json({ error: 'Service not found.' });

    const updates = { updated_at: new Date() };
    if (req.body.name !== undefined) {
      if (!req.body.name?.trim()) return res.status(400).json({ error: 'name cannot be empty.' });
      updates.name = req.body.name.trim();
    }
    if (req.body.notes !== undefined) updates.notes = req.body.notes || null;
    if (req.body.category !== undefined) updates.category = req.body.category || null;
    if (req.body.unit_label !== undefined) updates.unit_label = req.body.unit_label || null;
    if (req.body.is_active !== undefined) updates.is_active = !!req.body.is_active;
    if (req.body.billing_type !== undefined || req.body.recurrence !== undefined
        || req.body.recurrence_count !== undefined || req.body.unit_price !== undefined) {
      const n = normalize(req.body);
      updates.billing_type = n.billing_type;
      updates.recurrence = n.recurrence;
      updates.recurrence_count = n.recurrence_count;
      updates.unit_price = n.unit_price;
    }
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Nothing to update.' });

    const oldPrice = before[0].unit_price == null ? null : parseFloat(before[0].unit_price);
    const priceChanged = updates.unit_price !== undefined && updates.unit_price !== oldPrice;
    const propagate = priceChanged && req.body.propagate_price !== false && req.body.propagate_price !== 'false';

    const client = await getClient();
    let service;
    let plan = [];
    let skipped = 0;
    try {
      await client.query('BEGIN');

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      const { rows } = await client.query(
        `UPDATE service_catalog SET ${setClauses} WHERE id = $1 RETURNING *`,
        [req.params.id, ...Object.values(updates)]
      );
      service = rows[0];

      if (propagate) {
        // Lock the linked charges so two simultaneous price edits can't interleave.
        const { rows: linked } = await client.query(
          `SELECT id, description, quantity, unit_price, amount, is_active
             FROM customer_recurring_charges WHERE service_catalog_id = $1 FOR UPDATE`,
          [req.params.id]
        );
        plan = priceSyncPlan(linked, updates.unit_price);
        skipped = linked.length - plan.length;
        for (const p of plan) {
          await client.query(
            `UPDATE customer_recurring_charges
                SET unit_price = $2, amount = $3, updated_at = NOW()
              WHERE id = $1`,
            [p.id, p.to, p.amountTo]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'service', entityId: service.id, entityName: service.name,
      changes: priceChanged
        ? { unit_price: { from: oldPrice, to: updates.unit_price },
            customer_charges_repriced: plan.length }
        : undefined,
      ipAddress: getClientIp(req) });
    // One audit entry per re-priced charge: this is money on a customer's account, so
    // each line has to be traceable on its own, not just as a count on the service.
    for (const p of plan) {
      await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
        entityType: 'recurring_charge', entityId: p.id, entityName: p.description,
        changes: { unit_price: { from: p.from, to: p.to },
                   amount: { from: p.amountFrom, to: p.amountTo },
                   repriced_by_service: service.name },
        ipAddress: getClientIp(req) });
    }

    res.json({
      ...service,
      price_sync: priceChanged
        ? { updated: plan.length, skipped, from: oldPrice, to: updates.unit_price, propagated: propagate }
        : null,
    });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM service_catalog WHERE id = $1 RETURNING name', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Service not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'service', entityId: req.params.id, entityName: rows[0].name, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
