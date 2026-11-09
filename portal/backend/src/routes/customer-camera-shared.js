import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';

// Mounted at /api/customers/:customerId/cameras/:cameraId/shared
const router = Router({ mergeParams: true });

function sanitize(row) {
  return { ...row, has_password: hasValue(row.password_enc), password_enc: undefined };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_camera_shared_access
       WHERE camera_system_id = $1 ORDER BY label`,
      [req.params.cameraId]
    );
    res.json(rows.map(sanitize));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { label, username, password, notes } = req.body ?? {};
    if (!label?.trim()) return res.status(400).json({ error: 'label is required.' });
    const { rows } = await query(
      `INSERT INTO customer_camera_shared_access
         (camera_system_id, label, username, password_enc, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.cameraId, label.trim(), username, encrypt(password), notes]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'camera_shared_access', entityId: rows[0].id, entityName: rows[0].label,
      ipAddress: getClientIp(req) });
    res.status(201).json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:shareId', requireAuth, async (req, res, next) => {
  try {
    const fields = ['label', 'username', 'notes'];
    const updates = { updated_at: new Date() };
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    if (req.body.password !== undefined) updates.password_enc = encrypt(req.body.password);

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_camera_shared_access SET ${setClauses}
       WHERE id = $1 AND camera_system_id = $2 RETURNING *`,
      [req.params.shareId, req.params.cameraId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'camera_shared_access', entityId: rows[0].id, entityName: rows[0].label,
      ipAddress: getClientIp(req) });
    res.json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.post('/:shareId/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT password_enc, label FROM customer_camera_shared_access
       WHERE id = $1 AND camera_system_id = $2`,
      [req.params.shareId, req.params.cameraId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'camera_shared_access',
      entityId: req.params.shareId, entityName: rows[0].label, ipAddress: getClientIp(req) });
    res.json({ value: decrypt(rows[0].password_enc) });
  } catch (err) { next(err); }
});

router.delete('/:shareId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_camera_shared_access WHERE id = $1 AND camera_system_id = $2 RETURNING label`,
      [req.params.shareId, req.params.cameraId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'camera_shared_access', entityId: req.params.shareId, entityName: rows[0].label,
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
