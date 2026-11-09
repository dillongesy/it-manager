import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';

// Branch offices — extra locations linked to a customer, each with its own
// business name, address, phone, static WAN IP, firewall link, and notes.
const router = Router({ mergeParams: true });

const FIELDS = [
  'label', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'wan_ip', 'firewall_link', 'notes',
  'billing_contact_name', 'billing_contact_email', 'billing_contact_phone',
];

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const v = Object.fromEntries(FIELDS.map(f => [f, req.body?.[f] ?? null]));
    const cols = ['customer_id', ...FIELDS];
    const vals = [req.params.customerId, ...FIELDS.map(f => v[f])];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO customer_locations (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'location', entityId: rows[0].id, entityName: rows[0].business_name || rows[0].label || 'Branch office',
      ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:locationId', requireAuth, async (req, res, next) => {
  try {
    const updates = { updated_at: new Date() };
    for (const f of FIELDS) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    const { rows: before } = await query('SELECT * FROM customer_locations WHERE id = $1 AND customer_id = $2', [req.params.locationId, req.params.customerId]);
    if (!before[0]) return res.status(404).json({ error: 'Branch office not found.' });
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_locations SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.locationId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Branch office not found.' });
    const changes = diffChanges(before[0], rows[0], FIELDS);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'location', entityId: rows[0].id, entityName: rows[0].business_name || rows[0].label || 'Branch office',
      changes, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:locationId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_locations WHERE id = $1 AND customer_id = $2 RETURNING business_name, label`,
      [req.params.locationId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Branch office not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'location', entityId: req.params.locationId,
      entityName: rows[0].business_name || rows[0].label || 'Branch office', ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
