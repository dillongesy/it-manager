import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';

const router = Router({ mergeParams: true });

// Drag-reorder contacts - body { ids: [contactId, …] } in the new order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE customer_contacts SET sort_order = $3 WHERE id = $1 AND customer_id = $2`,
        [ids[i], req.params.customerId, (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'contact', entityId: req.params.customerId, entityName: 'Contacts reordered',
      changes: { order: ids }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, title, phone, email, is_primary, notes, address, city, state, zip, location_id } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });
    const { rows } = await query(
      `INSERT INTO customer_contacts (customer_id, name, title, phone, email, is_primary, notes, address, city, state, zip, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.params.customerId, name.trim(), title, phone, email, is_primary ?? false, notes, address, city, state, zip, location_id || null]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'contact', entityId: rows[0].id, entityName: rows[0].name, ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:contactId', requireAuth, async (req, res, next) => {
  try {
    const fields = ['name','title','phone','email','is_primary','notes','address','city','state','zip','location_id'];
    const updates = { updated_at: new Date() };
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    if (updates.location_id === '') updates.location_id = null;
    const { rows: before } = await query('SELECT * FROM customer_contacts WHERE id = $1 AND customer_id = $2', [req.params.contactId, req.params.customerId]);
    if (!before[0]) return res.status(404).json({ error: 'Contact not found.' });
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_contacts SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.contactId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found.' });
    const changes = diffChanges(before[0], rows[0], fields);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'contact', entityId: rows[0].id, entityName: rows[0].name, changes, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:contactId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_contacts WHERE id = $1 AND customer_id = $2 RETURNING name`,
      [req.params.contactId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'contact', entityId: req.params.contactId, entityName: rows[0].name, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
