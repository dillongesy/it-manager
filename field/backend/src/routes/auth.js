import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function issueAccess(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, fullName: user.full_name, initials: user.initials },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );
}

function issueRefresh(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  const hash  = hashToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiryDays);
  return { token, hash, expiresAt };
}

function setCookie(res, token, exp) {
  res.cookie('refresh_token', token, {
    httpOnly: true, secure: !config.isDev, sameSite: 'strict',
    expires: exp, path: '/api/auth',
  });
}

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    const { rows } = await query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username.toLowerCase().trim()]
    );
    const user = rows[0];
    const hash = user?.password_hash ?? '$2a$12$invalidhash000000000000000000000000000000000000000000000';
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) return res.status(401).json({ error: 'Invalid username or password.' });

    const accessToken = issueAccess(user);
    const { token: rt, hash: rh, expiresAt } = issueRefresh(user.id);
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [user.id, rh, expiresAt]
    );
    setCookie(res, rt, expiresAt);
    res.json({ accessToken, user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role, initials: user.initials } });
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const incoming = req.cookies?.refresh_token;
    if (!incoming) return res.status(401).json({ error: 'No refresh token.' });

    const hash = hashToken(incoming);
    const { rows } = await query(
      `SELECT rt.*, u.username, u.full_name, u.role, u.initials, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.is_revoked = false AND rt.expires_at > NOW()`,
      [hash]
    );
    const r = rows[0];
    if (!r || !r.is_active) {
      if (r) await query('UPDATE refresh_tokens SET is_revoked=true WHERE user_id=$1', [r.user_id]);
      res.clearCookie('refresh_token', { path: '/api/auth' });
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    await query('UPDATE refresh_tokens SET is_revoked=true WHERE id=$1', [r.id]);
    const user = { id: r.user_id, username: r.username, full_name: r.full_name, role: r.role, initials: r.initials };
    const accessToken = issueAccess(user);
    const { token: nt, hash: nh, expiresAt } = issueRefresh(user.id);
    await query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [user.id, nh, expiresAt]);
    setCookie(res, nt, expiresAt);
    res.json({ accessToken });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const inc = req.cookies?.refresh_token;
    if (inc) await query('UPDATE refresh_tokens SET is_revoked=true WHERE token_hash=$1', [hashToken(inc)]);
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, username, full_name, role, initials, email FROM users WHERE id=$1',
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

export default router;
