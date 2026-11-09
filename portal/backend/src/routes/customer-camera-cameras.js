import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';
import { assertDateFields } from '../lib/dates.js';

// The individual cameras hanging off one camera system (NVR/DVR).
// Mounted at /api/customers/:customerId/cameras/:cameraId/cameras
const router = Router({ mergeParams: true });

const FIELDS = [
  'name', 'channel', 'ip_address', 'mac_address', 'manufacturer', 'model',
  'serial_number', 'camera_type', 'resolution', 'firmware', 'connected_to',
  'install_date', 'username', 'notes',
];

// Empty strings from the form would fail DATE parsing, so blank them to NULL; a real
// date is validated (and normalized to YYYY-MM-DD) by assertDateFields — an
// out-of-range year would otherwise store fine and lock the record. See lib/dates.js.
const clean = (k, v, dates) => (k === 'install_date' ? (dates.install_date ?? null) : v);

export function sanitizeCamera(row) {
  return { ...row, has_password: hasValue(row.password_enc), password_enc: undefined };
}

const name = (row) => row.name || row.model || 'Camera';

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_cameras WHERE camera_system_id = $1 ORDER BY sort_order, name`,
      [req.params.cameraId]
    );
    res.json(rows.map(sanitizeCamera));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const dates = assertDateFields(req.body ?? {}, ['install_date']);
    const values = FIELDS.map(f => clean(f, req.body?.[f] ?? null, dates));
    // Append to the end of the system's current list.
    const { rows: last } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) AS max FROM customer_cameras WHERE camera_system_id = $1`,
      [req.params.cameraId]
    );
    const cols = FIELDS.join(', ');
    const ph   = FIELDS.map((_, i) => `$${i + 2}`).join(', ');
    const { rows } = await query(
      `INSERT INTO customer_cameras (camera_system_id, ${cols}, password_enc, sort_order)
       VALUES ($1, ${ph}, $${FIELDS.length + 2}, $${FIELDS.length + 3}) RETURNING *`,
      [req.params.cameraId, ...values, encrypt(req.body?.password), Number(last[0].max) + 10]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'camera', entityId: rows[0].id, entityName: name(rows[0]),
      ipAddress: getClientIp(req) });
    res.status(201).json(sanitizeCamera(rows[0]));
  } catch (err) { next(err); }
});

// Persisted drag/sort order — body { ids: [cameraId, …] } in the new order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE customer_cameras SET sort_order = $3 WHERE id = $1 AND camera_system_id = $2`,
        [ids[i], req.params.cameraId, (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'camera', entityId: req.params.cameraId, entityName: 'Cameras reordered',
      changes: { order: ids }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const updates = {};
    const dates = assertDateFields(req.body, ['install_date']);
    for (const f of FIELDS) { if (req.body[f] !== undefined) updates[f] = clean(f, req.body[f], dates); }
    if (req.body.password !== undefined) updates.password_enc = encrypt(req.body.password);
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    const { rows: before } = await query(
      'SELECT * FROM customer_cameras WHERE id = $1 AND camera_system_id = $2',
      [req.params.id, req.params.cameraId]
    );
    if (!before[0]) return res.status(404).json({ error: 'Camera not found.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_cameras SET ${setClauses} WHERE id = $1 AND camera_system_id = $2 RETURNING *`,
      [req.params.id, req.params.cameraId, ...Object.values(updates)]
    );
    const changes = diffChanges(before[0], rows[0], Object.keys(updates).filter(k => k !== 'updated_at'));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'camera', entityId: rows[0].id, entityName: name(rows[0]),
      changes, ipAddress: getClientIp(req) });
    res.json(sanitizeCamera(rows[0]));
  } catch (err) { next(err); }
});

router.post('/:id/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT password_enc, name, model FROM customer_cameras WHERE id = $1 AND camera_system_id = $2`,
      [req.params.id, req.params.cameraId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Camera not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'camera', entityId: req.params.id,
      entityName: name(rows[0]), ipAddress: getClientIp(req) });
    res.json({ value: decrypt(rows[0].password_enc) });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_cameras WHERE id = $1 AND camera_system_id = $2 RETURNING name, model`,
      [req.params.id, req.params.cameraId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Camera not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'camera', entityId: req.params.id, entityName: name(rows[0]),
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
