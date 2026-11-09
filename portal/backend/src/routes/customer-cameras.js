import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';
import { sanitizeCamera } from './customer-camera-cameras.js';
import { coerceDateFields } from '../lib/dates.js';

const router = Router({ mergeParams: true });

function sanitize(row) {
  return { ...row, has_password: hasValue(row.password_enc), password_enc: undefined };
}

// Each system carries its cameras inline. One extra query for the whole tab (rather
// than one per system), and it keeps the client-side deep search working — a camera's
// name/IP/MAC is part of its system's searchable text.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_camera_systems WHERE customer_id = $1 ORDER BY label`,
      [req.params.customerId]
    );
    if (!rows.length) return res.json([]);
    const { rows: cams } = await query(
      `SELECT * FROM customer_cameras WHERE camera_system_id = ANY($1::uuid[])
       ORDER BY sort_order, name`,
      [rows.map(r => r.id)]
    );
    const bySystem = {};
    for (const c of cams) (bySystem[c.camera_system_id] ||= []).push(sanitizeCamera(c));
    res.json(rows.map(r => ({ ...sanitize(r), cameras: bySystem[r.id] ?? [] })));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { label, channel_count, system_type, model, serial_number, ip_address, username, password, shared_with, notes, location_id, system_location } = req.body ?? {};
    const dates = coerceDateFields(req.body ?? {}, ['install_date']);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    const { rows } = await query(
      `INSERT INTO customer_camera_systems
         (customer_id, label, channel_count, system_type, model, serial_number, ip_address, username, password_enc, shared_with, notes, location_id, install_date, system_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.params.customerId, label, channel_count || null, system_type ?? 'NVR', model, serial_number, ip_address, username, encrypt(password), shared_with, notes, location_id || null, dates.values.install_date ?? null, system_location]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'camera_system', entityId: rows[0].id, entityName: rows[0].label ?? rows[0].model,
      ipAddress: getClientIp(req) });
    res.status(201).json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:camId', requireAuth, async (req, res, next) => {
  try {
    const fields = ['label','channel_count','system_type','model','serial_number','ip_address','username','shared_with','notes','location_id','install_date','system_location'];
    const updates = {};
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    if (updates.location_id === '') updates.location_id = null;
    const dates = coerceDateFields(req.body, ['install_date']);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    Object.assign(updates, dates.values);
    if (req.body.password !== undefined) updates.password_enc = encrypt(req.body.password);
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    const { rows: before } = await query('SELECT * FROM customer_camera_systems WHERE id = $1 AND customer_id = $2', [req.params.camId, req.params.customerId]);
    if (!before[0]) return res.status(404).json({ error: 'Camera system not found.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_camera_systems SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.camId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Camera system not found.' });
    const changes = diffChanges(before[0], rows[0], Object.keys(updates).filter(k => k !== 'updated_at'));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'camera_system', entityId: rows[0].id, entityName: rows[0].label ?? rows[0].model,
      changes, ipAddress: getClientIp(req) });
    res.json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.post('/:camId/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT password_enc, label, model FROM customer_camera_systems WHERE id = $1 AND customer_id = $2`,
      [req.params.camId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Camera system not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'camera_system', entityId: req.params.camId,
      entityName: rows[0].label ?? rows[0].model, ipAddress: getClientIp(req) });
    res.json({ value: decrypt(rows[0].password_enc) });
  } catch (err) { next(err); }
});

router.delete('/:camId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_camera_systems WHERE id = $1 AND customer_id = $2 RETURNING label, model`,
      [req.params.camId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Camera system not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'camera_system', entityId: req.params.camId,
      entityName: rows[0].label ?? rows[0].model, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
