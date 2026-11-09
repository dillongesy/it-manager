import { Router } from 'express';
import multer from 'multer';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dir, '..', '..', 'uploads');

function customerDir(customerId) {
  const dir = join(UPLOADS_ROOT, 'customers', customerId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, customerDir(req.params.customerId)),
  filename: (_req, file, cb) => {
    const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router({ mergeParams: true });

router.get('/', requireAuth, async (req, res, next) => {
  try {
    // ?kind=file (default) or ?kind=proposal — one table backs both tabs
    const kind = req.query.kind === 'proposal' ? 'proposal' : 'file';
    const { rows } = await query(
      `SELECT id, customer_id, original_name, mime_type, size_bytes, category, kind, notes, proposal_status, location_id, uploaded_by, created_at
       FROM customer_files WHERE customer_id = $1 AND kind = $2 ORDER BY created_at DESC`,
      [req.params.customerId, kind]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { category, notes, location_id } = req.body ?? {};
    const kind = req.body?.kind === 'proposal' ? 'proposal' : 'file';
    const { rows } = await query(
      `INSERT INTO customer_files
         (customer_id, stored_name, original_name, mime_type, size_bytes, category, kind, notes, location_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.params.customerId, req.file.filename, req.file.originalname,
        req.file.mimetype, req.file.size, category?.trim() || null, kind, notes, location_id || null, req.user.sub,
      ]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'file', entityId: rows[0].id, entityName: req.file.originalname,
      ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) {
    // clean up uploaded file if DB insert fails
    try { unlinkSync(req.file.path); } catch {}
    next(err);
  }
});

// Rename a category — body { kind, from, to }. Every file in it (on that tab only:
// Files and Proposals keep separate categories) moves to the new name. Categories
// are plain text on each file, so renaming onto an existing one simply merges them.
router.post('/categories/rename', requireAuth, async (req, res, next) => {
  try {
    const kind = req.body?.kind === 'proposal' ? 'proposal' : 'file';
    const from = (req.body?.from ?? '').trim();
    const to   = (req.body?.to ?? '').trim();
    if (!from) return res.status(400).json({ error: 'Category to rename is required.' });
    if (!to)   return res.status(400).json({ error: 'Category name is required.' });
    if (to.length > 100) return res.status(400).json({ error: 'Category name is too long (100 characters max).' });
    if (from === to) return res.json({ ok: true, updated: 0 });

    const { rowCount } = await query(
      `UPDATE customer_files SET category = $4
       WHERE customer_id = $1 AND kind = $2 AND category = $3`,
      [req.params.customerId, kind, from, to]
    );
    if (!rowCount) return res.status(404).json({ error: 'Category not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: kind === 'proposal' ? 'proposal' : 'file', entityId: req.params.customerId,
      entityName: `Category "${from}" renamed to "${to}"`,
      changes: { category: { from, to }, files_moved: rowCount }, ipAddress: getClientIp(req) });
    res.json({ ok: true, updated: rowCount });
  } catch (err) { next(err); }
});

// Serve a file. ?inline=1 shows it in the browser (images, PDFs); default downloads.
router.get('/:fileId/download', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_files WHERE id = $1 AND customer_id = $2`,
      [req.params.fileId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found.' });

    const filePath = join(customerDir(req.params.customerId), rows[0].stored_name);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk.' });

    const inline = !!req.query.inline;
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${rows[0].original_name}"`);
    res.setHeader('Content-Type', rows[0].mime_type ?? 'application/octet-stream');
    // Audit access the same way credential reveals are logged — who looked at / downloaded what.
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'READ',
      entityType: rows[0].kind === 'proposal' ? 'proposal' : 'file', entityId: rows[0].id,
      entityName: `${inline ? 'viewed' : 'downloaded'}: ${rows[0].original_name}`, ipAddress: getClientIp(req) });
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// Rename a file (display name only — the on-disk stored_name and extension never change)
router.patch('/:fileId', requireAuth, async (req, res, next) => {
  try {
    const { original_name, category, proposal_status, location_id } = req.body ?? {};
    const { rows: existing } = await query(
      `SELECT * FROM customer_files WHERE id = $1 AND customer_id = $2`,
      [req.params.fileId, req.params.customerId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'File not found.' });

    const updates = {};
    if (category !== undefined) updates.category = category?.trim() || null;
    if (location_id !== undefined) updates.location_id = location_id || null;
    const VALID_STATUSES = ['pending', 'accepted', 'rejected'];
    if (proposal_status !== undefined) {
      updates.proposal_status = VALID_STATUSES.includes(proposal_status) ? proposal_status : null;
    }
    if (original_name !== undefined && original_name.trim()) {
      // Preserve the original extension regardless of what the user typed.
      const oldName = existing[0].original_name;
      const ext = oldName.includes('.') ? oldName.slice(oldName.lastIndexOf('.')) : '';
      let base = original_name.trim();
      if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) base = base.slice(0, -ext.length);
      updates.original_name = base + ext;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_files SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.fileId, req.params.customerId, ...Object.values(updates)]
    );
    const changes = diffChanges(existing[0], rows[0], Object.keys(updates));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'file', entityId: rows[0].id, entityName: rows[0].original_name,
      changes, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:fileId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_files WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.fileId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found.' });

    try {
      unlinkSync(join(customerDir(req.params.customerId), rows[0].stored_name));
    } catch {}

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'file', entityId: req.params.fileId, entityName: rows[0].original_name,
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
