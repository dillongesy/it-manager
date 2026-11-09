import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';

const router = Router();

const VALID_ROLES = ['admin', 'camera_tech', 'biller'];

// GET /api/users - any authenticated user (powers the technician picker).
// ?active=true returns only active accounts.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = req.query.active === 'true' ? 'WHERE is_active = true' : '';
    const { rows } = await query(
      `SELECT id, username, full_name, initials, role, is_active, created_at
       FROM users ${where} ORDER BY full_name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/users/me/password - change own password
router.post('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, config.bcryptRounds);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.sub]);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'user', entityId: req.user.sub, entityName: 'changed own password', ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/users - admin only
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { username, password, full_name, initials, role } = req.body ?? {};
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'username, full_name, and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const hash = await bcrypt.hash(password, config.bcryptRounds);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, initials, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, initials, role, is_active, created_at`,
      [
        username.toLowerCase().trim(),
        hash,
        full_name.trim(),
        initials ? initials.toUpperCase().trim() : null,
        role ?? 'camera_tech',
      ]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'user', entityId: rows[0].id, entityName: `${rows[0].full_name} (${rows[0].username})`,
      ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
    next(err);
  }
});

// PATCH /api/users/:id - admin only
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { full_name, initials, role, is_active, password } = req.body ?? {};
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (initials !== undefined) updates.initials = initials ? initials.toUpperCase().trim() : null;
    if (is_active !== undefined) updates.is_active = is_active;
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
      updates.role = role;
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      updates.password_hash = await bcrypt.hash(password, config.bcryptRounds);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE users SET ${setClauses} WHERE id = $1
       RETURNING id, username, full_name, initials, role, is_active, created_at`,
      [req.params.id, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    // Record which fields changed; never log the password hash itself.
    const changedFields = Object.keys(updates)
      .filter((k) => k !== 'updated_at')
      .map((k) => (k === 'password_hash' ? 'password' : k));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'user', entityId: rows[0].id, entityName: `${rows[0].full_name} (${rows[0].username})`,
      changes: { fields: changedFields }, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
