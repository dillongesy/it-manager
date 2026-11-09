import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { parsePaging, setTotalCount } from '../lib/pagination.js';

const router = Router();

// GET /api/audit - any signed-in user (read-only; all staff see the same screens)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId, action, entityType } = req.query;
    // The viewer pages 50 at a time; the total lets it show "1–50 of 1,284" and
    // disable Next on the last page instead of guessing from a short result.
    const { limit, offset } = parsePaging(req.query, { defaultLimit: 50 });

    // FROM/WHERE is built once and shared by the page query and the count, so the
    // two can never drift apart as filters are added.
    let from = `
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE 1=1
    `;
    const params = [];

    if (userId)     { params.push(userId);     from += ` AND al.user_id    = $${params.length}`; }
    if (action)     { params.push(action);     from += ` AND al.action     = $${params.length}`; }
    if (entityType) { params.push(entityType); from += ` AND al.entity_type= $${params.length}`; }

    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total ${from}`, params);
    setTotalCount(res, countRows[0].total);

    const { rows } = await query(
      `SELECT al.id, al.action, al.entity_type, al.entity_name,
              al.changes, al.ip_address, al.created_at,
              al.user_id, COALESCE(al.user_name, u.full_name, 'System') AS user_name
       ${from}
       ORDER BY al.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
