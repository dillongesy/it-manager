import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';

const router = Router({ mergeParams: true });

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, customer_id, title, created_by, updated_by, created_at, updated_at
       FROM customer_guides WHERE customer_id = $1 ORDER BY updated_at DESC`,
      [req.params.customerId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:guideId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_guides WHERE id = $1 AND customer_id = $2`,
      [req.params.guideId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Guide not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, content } = req.body ?? {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required.' });
    const { rows } = await query(
      `INSERT INTO customer_guides (customer_id, title, content, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$4) RETURNING *`,
      [req.params.customerId, title.trim(), content ?? '', req.user.sub]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'guide', entityId: rows[0].id, entityName: rows[0].title, ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:guideId', requireAuth, async (req, res, next) => {
  try {
    const { title, content } = req.body ?? {};
    const updates = { updated_by: req.user.sub, updated_at: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (content !== undefined) updates.content = content;

    // Snapshot title only — guide content is large (can hold base64 images), so we
    // never store it in the audit diff; we just flag that it changed.
    const { rows: before } = await query('SELECT title, content FROM customer_guides WHERE id = $1 AND customer_id = $2', [req.params.guideId, req.params.customerId]);
    if (!before[0]) return res.status(404).json({ error: 'Guide not found.' });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_guides SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.guideId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Guide not found.' });
    const changes = {};
    if (updates.title !== undefined && before[0].title !== rows[0].title) changes.title = { from: before[0].title, to: rows[0].title };
    if (updates.content !== undefined && before[0].content !== rows[0].content) changes.content = { changed: true };
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'guide', entityId: rows[0].id, entityName: rows[0].title,
      changes: Object.keys(changes).length ? changes : null, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:guideId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_guides WHERE id = $1 AND customer_id = $2 RETURNING title`,
      [req.params.guideId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Guide not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'guide', entityId: req.params.guideId, entityName: rows[0].title,
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
