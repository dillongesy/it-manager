import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const UPLOAD = join(__dir, '..', '..', 'uploads', 'photos');
if (!existsSync(UPLOAD)) mkdirSync(UPLOAD, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD),
  filename:    (_req, file, cb) => {
    const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

// GET — filter by customer or work order
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { workOrderId, customerName, limit = 50, offset = 0 } = req.query;
    let sql = `SELECT p.*, u.full_name AS uploader_name
               FROM field_photos p LEFT JOIN users u ON u.id=p.uploaded_by WHERE 1=1`;
    const params = [];
    if (workOrderId)  { params.push(workOrderId);  sql += ` AND p.work_order_id=$${params.length}`; }
    if (customerName) { params.push(`%${customerName}%`); sql += ` AND p.customer_name ILIKE $${params.length}`; }
    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// Upload one or more photos
router.post('/', requireAuth, upload.array('photos', 20), async (req, res, next) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });
  try {
    const { work_order_id, customer_name, customer_address, notes } = req.body ?? {};
    const inserted = [];
    for (const file of req.files) {
      const { rows } = await query(
        `INSERT INTO field_photos (work_order_id, customer_name, customer_address, stored_name, original_name, mime_type, size_bytes, notes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [work_order_id || null, customer_name, customer_address, file.filename, file.originalname, file.mimetype, file.size, notes, req.user.sub]
      );
      inserted.push(rows[0]);
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'photo', entityId: inserted[0]?.id ?? null,
      entityName: `${inserted.length} photo(s) uploaded${customer_name ? ` — ${customer_name}` : ''}`,
      ipAddress: getClientIp(req) });
    res.status(201).json(inserted);
  } catch (err) {
    for (const f of req.files) { try { unlinkSync(f.path); } catch {} }
    next(err);
  }
});

// Serve a photo
router.get('/:id/view', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM field_photos WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Photo not found.' });
    const path = join(UPLOAD, rows[0].stored_name);
    if (!existsSync(path)) return res.status(404).json({ error: 'File missing.' });
    res.setHeader('Content-Type', rows[0].mime_type ?? 'image/jpeg');
    res.sendFile(path);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM field_photos WHERE id=$1 RETURNING stored_name, original_name', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Photo not found.' });
    try { unlinkSync(join(UPLOAD, rows[0].stored_name)); } catch {}
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'photo', entityId: req.params.id, entityName: rows[0].original_name || 'photo',
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
