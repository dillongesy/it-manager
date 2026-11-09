import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/audit - admin only. Read-only view of the Field audit log
// (inventory, work orders, photos, users).
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { action, entityType, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT al.id, al.action, al.entity_type, al.entity_name,
             al.changes, al.created_at,
             al.user_id, COALESCE(al.user_name, u.full_name, 'System') AS user_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE 1=1
    `;
    const params = [];
    if (action)     { params.push(action);     sql += ` AND al.action      = $${params.length}`; }
    if (entityType) { params.push(entityType); sql += ` AND al.entity_type = $${params.length}`; }

    sql += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
