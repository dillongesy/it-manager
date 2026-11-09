import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { coerceMoney, coerceQty, lineTotal } from '../lib/service-sync.js';
import { coerceIntervalCount, coerceBillingYear } from '../lib/cadence.js';

const router = Router({ mergeParams: true });

const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annually'];

// Normalize + validate the billing fields shared by create/update.
function coerceFrequency(v) {
  return FREQUENCIES.includes(v) ? v : 'monthly';
}
function coerceMonth(v, frequency) {
  // Monthly charges bill every month — no anchor month. Periodic charges keep 1..12.
  if (frequency === 'monthly') return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

// Frequency, interval count and the two anchor fields are one unit — a charge's
// schedule. Resolving them together (rather than field by field) is what stops a
// half-applied PATCH leaving, say, 'every 3 years' on a charge switched back to
// monthly, or a multi-year charge with no year to count from.
//
//   monthly            → no anchor at all
//   quarterly/semi     → anchor month only; the cycle repeats within the year
//   annually  ×1       → anchor month only
//   annually  ×N (N>1) → anchor month AND year: 'November' alone can't say whether
//                        the next domain renewal is 2027 or 2029
function coerceSchedule(body, current = {}) {
  const pick = (key) => (body[key] !== undefined ? body[key] : current[key]);
  const frequency = coerceFrequency(pick('frequency'));
  const interval_count = coerceIntervalCount(pick('interval_count'), frequency);
  const billing_month = coerceMonth(pick('billing_month'), frequency);
  const billing_year = billing_month == null
    ? null
    : coerceBillingYear(pick('billing_year'), frequency, interval_count);
  return { frequency, interval_count, billing_month, billing_year };
}

// Money/quantity coercion and the derived line total live in lib/service-sync.js —
// shared with the catalog price roll-out so both compute `amount` the same way.

router.get('/', requireAuth, async (req, res, next) => {
  try {
    // service_name comes along so the tab can show "linked to the Services catalog"
    // (and flag a link whose catalog entry was since deleted/renamed).
    const { rows } = await query(
      `SELECT rc.*, sc.name AS service_name, sc.unit_price AS service_unit_price
         FROM customer_recurring_charges rc
         LEFT JOIN service_catalog sc ON sc.id = rc.service_catalog_id
        WHERE rc.customer_id = $1 ORDER BY rc.description`,
      [req.params.customerId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { description, category, quantity, unit_price, unit_label, is_active, notes, location_id, service_catalog_id } = req.body ?? {};
    if (!description?.trim()) return res.status(400).json({ error: 'description is required.' });
    const schedule = coerceSchedule(req.body ?? {});
    const qty = coerceQty(quantity);
    const unitPrice = coerceMoney(unit_price);
    const { rows } = await query(
      `INSERT INTO customer_recurring_charges
         (customer_id, location_id, description, category, quantity, unit_price, unit_label, amount, frequency, interval_count, billing_month, billing_year, is_active, notes, service_catalog_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        req.params.customerId,
        location_id || null,
        description.trim(),
        category || null,
        qty,
        unitPrice,
        unit_label || null,
        lineTotal(qty, unitPrice),
        schedule.frequency,
        schedule.interval_count,
        schedule.billing_month,
        schedule.billing_year,
        is_active === undefined ? true : !!is_active,
        notes || null,
        service_catalog_id || null,
        req.user.sub,
      ]
    );
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'recurring_charge', entityId: rows[0].id, entityName: rows[0].description,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:chargeId', requireAuth, async (req, res, next) => {
  try {
    const { rows: before } = await query(
      'SELECT * FROM customer_recurring_charges WHERE id = $1 AND customer_id = $2',
      [req.params.chargeId, req.params.customerId]
    );
    if (!before[0]) return res.status(404).json({ error: 'Charge not found.' });

    const updates = {};
    if (req.body.description !== undefined) {
      if (!req.body.description?.trim()) return res.status(400).json({ error: 'description is required.' });
      updates.description = req.body.description.trim();
    }
    if (req.body.category   !== undefined) updates.category   = req.body.category || null;
    if (req.body.unit_label !== undefined) updates.unit_label = req.body.unit_label || null;
    if (req.body.notes      !== undefined) updates.notes      = req.body.notes || null;
    if (req.body.location_id!== undefined) updates.location_id= req.body.location_id || null;
    if (req.body.is_active  !== undefined) updates.is_active  = !!req.body.is_active;
    // Clearing the link ('' → null) unlinks the charge: it keeps its price but stops
    // following catalog price changes.
    if (req.body.service_catalog_id !== undefined) updates.service_catalog_id = req.body.service_catalog_id || null;
    // Quantity/unit price are coupled to the derived line total (amount).
    if (req.body.quantity !== undefined || req.body.unit_price !== undefined) {
      const qty       = req.body.quantity   !== undefined ? coerceQty(req.body.quantity)     : parseFloat(before[0].quantity);
      const unitPrice = req.body.unit_price !== undefined ? coerceMoney(req.body.unit_price) : (before[0].unit_price == null ? null : parseFloat(before[0].unit_price));
      updates.quantity   = qty;
      updates.unit_price = unitPrice;
      updates.amount     = lineTotal(qty, unitPrice);
    }
    // The whole schedule is re-resolved as a unit whenever any part of it is sent, so
    // the four fields can never end up disagreeing (see coerceSchedule).
    if (req.body.frequency !== undefined || req.body.interval_count !== undefined
        || req.body.billing_month !== undefined || req.body.billing_year !== undefined) {
      Object.assign(updates, coerceSchedule(req.body, before[0]));
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_recurring_charges SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.chargeId, req.params.customerId, ...Object.values(updates)]
    );
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'recurring_charge', entityId: rows[0].id, entityName: rows[0].description,
      ipAddress: getClientIp(req),
    });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:chargeId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM customer_recurring_charges WHERE id = $1 AND customer_id = $2 RETURNING description',
      [req.params.chargeId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Charge not found.' });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'recurring_charge', entityId: req.params.chargeId, entityName: rows[0].description,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
