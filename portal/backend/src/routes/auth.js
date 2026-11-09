import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, fullName: user.full_name },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );
}

function issueRefreshToken(user) {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = hashToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiryDays);
  return { token, hash, expiresAt };
}

function setRefreshCookie(res, token, expiresAt) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'strict',
    expires: expiresAt,
    path: '/api/auth',
  });
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const { rows } = await query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username.toLowerCase().trim()]
    );
    const user = rows[0];

    // Constant-time check even on miss to prevent user enumeration
    const hash = user?.password_hash ?? '$2a$12$invalidhashpaddingtomakeconstanttime00000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      await logAudit({
        action: 'LOGIN_FAILED',
        entityName: username,
        ipAddress: getClientIp(req),
      });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const accessToken = issueAccessToken(user);
    const { token: refreshToken, hash: refreshHash, expiresAt } = issueRefreshToken(user);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshHash, expiresAt]
    );

    setRefreshCookie(res, refreshToken, expiresAt);

    // Stamp last login (best-effort; never block sign-in on this).
    query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]).catch(() => {});

    await logAudit({
      userId: user.id,
      userName: user.full_name,
      action: 'LOGIN',
      ipAddress: getClientIp(req),
    });

    res.json({
      accessToken,
      // Field names match GET /api/auth/me so the UI (initials, etc.) is consistent
      // whether the session was just created here or restored via refresh.
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const incoming = req.cookies?.refresh_token;
    if (!incoming) {
      return res.status(401).json({ error: 'No refresh token.' });
    }

    const hash = hashToken(incoming);
    const { rows } = await query(
      `SELECT rt.*, u.username, u.full_name, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.is_revoked = false
         AND rt.expires_at > NOW()`,
      [hash]
    );
    const record = rows[0];

    if (!record || !record.is_active) {
      // Possible token theft — revoke all tokens for this user if record found
      if (record) {
        await query('UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1', [record.user_id]);
      }
      res.clearCookie('refresh_token', { path: '/api/auth' });
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    // Rotate: revoke old, issue new
    await query('UPDATE refresh_tokens SET is_revoked = true WHERE id = $1', [record.id]);

    const user = { id: record.user_id, username: record.username, full_name: record.full_name, role: record.role };
    const accessToken = issueAccessToken(user);
    const { token: newRefresh, hash: newHash, expiresAt } = issueRefreshToken(user);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, newHash, expiresAt]
    );

    setRefreshCookie(res, newRefresh, expiresAt);
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const incoming = req.cookies?.refresh_token;
    if (incoming) {
      const hash = hashToken(incoming);
      await query('UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1', [hash]);
    }

    res.clearCookie('refresh_token', { path: '/api/auth' });

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'LOGOUT',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, username, email, full_name, role FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
