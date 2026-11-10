import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { parsePaging, setTotalCount } from '../lib/pagination.js';
import { disableMfa } from '../lib/mfa.js';

const router = Router();

// GET /api/users - all authenticated users (needed for WO tech assignment)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, username, full_name, email, role, is_active, created_at, last_login,
              (totp_secret IS NOT NULL) AS mfa_enabled
       FROM users ORDER BY full_name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id/activity - recent audit entries for this user (admin only)
router.get('/:id/activity', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    // Pageable rather than a hard 50 - a busy tech's history is worth scrolling.
    const { limit, offset } = parsePaging(req.query, { defaultLimit: 100 });
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS total FROM audit_log WHERE user_id = $1', [req.params.id]
    );
    setTotalCount(res, countRows[0].total);

    const { rows } = await query(
      `SELECT id, action, entity_type, entity_name, created_at, ip_address
       FROM audit_log WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/users/me/password - change own password
router.post('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required.' });
    }
    if (new_password.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters.' });
    }

    const { rows } = await query(
      'SELECT password_hash FROM users WHERE id = $1', [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, config.bcryptRounds);
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.sub]
    );

    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'UPDATE', entityType: 'user', entityId: req.user.sub,
      entityName: `${req.user.fullName} — password changed`, ipAddress: getClientIp(req) });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/users - admin only
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { username, email, full_name, password, role } = req.body ?? {};

    if (!username || !email || !full_name || !password) {
      return res.status(400).json({ error: 'username, email, full_name, and password are required.' });
    }

    const validRoles = ['admin', 'technician', 'biller'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters.' });
    }

    const hash = await bcrypt.hash(password, config.bcryptRounds);

    const { rows } = await query(
      `INSERT INTO users (username, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, is_active, created_at`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), full_name.trim(), hash, role ?? 'technician']
    );

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'CREATE',
      entityType: 'user',
      entityId: rows[0].id,
      entityName: rows[0].full_name,
      ipAddress: getClientIp(req),
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists.' });
    }
    next(err);
  }
});

// PATCH /api/users/:id - admin, or self (limited fields)
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const isSelf = req.user.sub === targetId;
    const isAdmin = req.user.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    const allowed = isSelf && !isAdmin
      ? ['full_name', 'email', 'password']
      : ['full_name', 'email', 'password', 'role', 'is_active'];

    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.password) {
      if (updates.password.length < 12) {
        return res.status(400).json({ error: 'Password must be at least 12 characters.' });
      }
      updates.password_hash = await bcrypt.hash(updates.password, config.bcryptRounds);
      delete updates.password;
    }

    // Never lock everyone out: the last active admin can't be demoted or
    // deactivated, and nobody can deactivate their own account.
    if (isSelf && updates.is_active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }
    if ((updates.role !== undefined && updates.role !== 'admin') || updates.is_active === false) {
      const { rows: t } = await query('SELECT role, is_active FROM users WHERE id = $1', [targetId]);
      if (t[0]?.role === 'admin' && t[0]?.is_active) {
        const { rows: a } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = true`);
        if (a[0].n <= 1) return res.status(400).json({ error: 'This is the last active admin. Make someone else an admin first.' });
      }
    }
    if (updates.role !== undefined && !['admin', 'technician', 'biller'].includes(updates.role)) {
      return res.status(400).json({ error: 'Role must be one of: admin, technician, biller' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [targetId, ...Object.values(updates)];

    const { rows } = await query(
      `UPDATE users SET ${setClauses} WHERE id = $1
       RETURNING id, username, email, full_name, role, is_active, updated_at`,
      values
    );

    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'UPDATE',
      entityType: 'user',
      entityId: targetId,
      entityName: rows[0].full_name,
      ipAddress: getClientIp(req),
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/mfa/reset - turn off a user's two-factor authentication (admin only),
// e.g. after a lost phone. If 2FA is required they set it up again at their next sign-in.
router.post('/:id/mfa/reset', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, full_name FROM users WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    await disableMfa(rows[0].id);
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE', entityType: 'user',
      entityId: rows[0].id, entityName: `${rows[0].full_name} - two-factor authentication reset`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
