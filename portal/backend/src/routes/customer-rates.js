import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';

const router = Router({ mergeParams: true });

// Drag-reorder billing rates — body { ids: [rateId, …] } in the new order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE customer_billing_rates SET sort_order = $3 WHERE id = $1 AND customer_id = $2`,
        [ids[i], req.params.customerId, (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'billing_rate', entityId: req.params.customerId, entityName: 'Billing rates reordered',
      changes: { order: ids }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { label, rate, notes } = req.body ?? {};
    if (!label?.trim()) return res.status(400).json({ error: 'label is required.' });
    if (isNaN(parseFloat(rate))) return res.status(400).json({ error: 'rate must be a number.' });
    const { rows } = await query(
      `INSERT INTO customer_billing_rates (customer_id, label, rate, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.customerId, label.trim(), parseFloat(rate), notes]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'billing_rate', entityId: rows[0].id, entityName: rows[0].label, ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:rateId', requireAuth, async (req, res, next) => {
  try {
    const { label, rate, notes } = req.body ?? {};
    const updates = {};
    if (label !== undefined) updates.label = label.trim();
    if (rate  !== undefined) {
      if (isNaN(parseFloat(rate))) return res.status(400).json({ error: 'rate must be a number.' });
      updates.rate = parseFloat(rate);
    }
    if (notes !== undefined) updates.notes = notes;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    const { rows: before } = await query('SELECT * FROM customer_billing_rates WHERE id = $1 AND customer_id = $2', [req.params.rateId, req.params.customerId]);
    if (!before[0]) return res.status(404).json({ error: 'Rate not found.' });
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_billing_rates SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.rateId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Rate not found.' });
    const changes = diffChanges(before[0], rows[0], Object.keys(updates));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'billing_rate', entityId: rows[0].id, entityName: rows[0].label, changes, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:rateId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_billing_rates WHERE id = $1 AND customer_id = $2 RETURNING label`,
      [req.params.rateId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Rate not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'billing_rate', entityId: req.params.rateId, entityName: rows[0].label, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
