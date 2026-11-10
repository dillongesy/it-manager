import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import {
  getMfaPolicy, issueChallenge, readChallenge, recordFailedAttempt, mfaStatus, startEnrollment,
  confirmEnrollment, verifySecondFactor, newRecoveryCodes, disableMfa,
} from '../lib/mfa.js';

// Authentication.
//
//   POST /api/auth/login                 { username, password }
//        → { accessToken, user }                         signed in
//        → { mfa: 'verify', mfaToken }                   enter a 2FA code next
//        → { mfa: 'enroll', mfaToken }                   2FA is required: set it up next
//   POST /api/auth/login/mfa             { mfaToken, code }  (code or recovery code)
//   POST /api/auth/refresh | /logout,  GET /api/auth/me
//
//   Two-factor authentication (signed in, or with an 'enroll' mfaToken while signing in):
//   GET  /api/auth/mfa                   policy and status
//   POST /api/auth/mfa/enroll/start      → { secret, otpauthUri, qr }
//   POST /api/auth/mfa/enroll/confirm    { code } → { recoveryCodes } (+ session when signing in)
//   POST /api/auth/mfa/recovery-codes    { password } → { recoveryCodes }
//   POST /api/auth/mfa/disable           { password }
const router = Router();

function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function issueAccess(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, fullName: user.full_name, initials: user.initials },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );
}

function issueRefresh() {
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

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sendError = (res, err, next) => (err.status ? res.status(err.status).json({ error: err.message }) : next(err));

/** Create a session for `user`: refresh cookie and access token. */
async function startSession(res, user, extra = {}) {
  const accessToken = issueAccess(user);
  const { token: rt, hash: rh, expiresAt } = issueRefresh();
  await query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [user.id, rh, expiresAt]);
  setCookie(res, rt, expiresAt);
  res.json({
    accessToken,
    user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role, initials: user.initials },
    ...extra,
  });
}

async function activeUser(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [id]);
  return rows[0] ?? null;
}

const auditUser = (req, user, entityName) => logAudit({
  userId: user.id, userName: user.full_name, action: 'UPDATE', entityType: 'user',
  entityId: user.id, entityName, ipAddress: getClientIp(req),
});

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

    const policy = await getMfaPolicy();
    if (policy !== 'off' && user.totp_secret) {
      return res.json({ mfa: 'verify', mfaToken: issueChallenge(user, 'verify') });
    }
    if (policy === 'required') {
      return res.json({ mfa: 'enroll', mfaToken: issueChallenge(user, 'enroll') });
    }
    await startSession(res, user);
  } catch (err) { next(err); }
});

// Second step of sign-in.
router.post('/login/mfa', async (req, res, next) => {
  try {
    const challenge = readChallenge(req.body?.mfaToken, 'verify');
    const user = await activeUser(challenge.sub);
    if (!user) throw httpError(401, 'The sign-in step has expired. Sign in again.');

    const method = await verifySecondFactor(user.id, req.body?.code);
    if (!method) {
      recordFailedAttempt(challenge.jti);
      return res.status(401).json({ error: 'That code is not valid.' });
    }
    if (method === 'recovery') await auditUser(req, user, `${user.full_name} - signed in with a recovery code`);
    await startSession(res, user, { recoveryCodesLeft: (await mfaStatus(user.id)).recoveryCodesLeft });
  } catch (err) { sendError(res, err, next); }
});

// Who is setting up 2FA: a signed-in user (access token), or someone mid-sign-in with an
// 'enroll' challenge token.
async function enrollmentActor(req) {
  if (req.body?.mfaToken) {
    const challenge = readChallenge(req.body.mfaToken, 'enroll');
    const user = await activeUser(challenge.sub);
    if (!user) throw httpError(401, 'The sign-in step has expired. Sign in again.');
    return { user, challenge };
  }
  let payload;
  try {
    payload = jwt.verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), config.jwt.accessSecret);
  } catch {
    throw httpError(401, 'Authentication required.');
  }
  const user = await activeUser(payload.sub);
  if (!user) throw httpError(401, 'Authentication required.');
  return { user, challenge: null };
}

router.post('/mfa/enroll/start', async (req, res, next) => {
  try {
    const { user } = await enrollmentActor(req);
    if ((await getMfaPolicy()) === 'off') throw httpError(403, 'Two-factor authentication is turned off by your administrator.');
    res.json(await startEnrollment(user.id));
  } catch (err) { sendError(res, err, next); }
});

router.post('/mfa/enroll/confirm', async (req, res, next) => {
  try {
    const { user, challenge } = await enrollmentActor(req);
    const recoveryCodes = await confirmEnrollment(user.id, req.body?.code);
    if (!recoveryCodes) {
      if (challenge) recordFailedAttempt(challenge.jti);
      return res.status(400).json({ error: 'That code is not valid. Check the time on your phone and try again.' });
    }
    await auditUser(req, user, `${user.full_name} - two-factor authentication turned on`);
    if (challenge) return startSession(res, user, { recoveryCodes });
    res.json({ recoveryCodes });
  } catch (err) { sendError(res, err, next); }
});

router.get('/mfa', requireAuth, async (req, res, next) => {
  try {
    res.json({ policy: await getMfaPolicy(), ...(await mfaStatus(req.user.sub)) });
  } catch (err) { next(err); }
});

async function checkPassword(userId, password) {
  const user = await activeUser(userId);
  if (!user || !password || !(await bcrypt.compare(String(password), user.password_hash))) {
    throw httpError(403, 'Password is incorrect.');
  }
  return user;
}

router.post('/mfa/recovery-codes', requireAuth, async (req, res, next) => {
  try {
    const user = await checkPassword(req.user.sub, req.body?.password);
    if (!user.totp_secret) throw httpError(400, 'Two-factor authentication is not turned on.');
    const recoveryCodes = await newRecoveryCodes(user.id);
    await auditUser(req, user, `${user.full_name} - new two-factor recovery codes`);
    res.json({ recoveryCodes });
  } catch (err) { sendError(res, err, next); }
});

router.post('/mfa/disable', requireAuth, async (req, res, next) => {
  try {
    if ((await getMfaPolicy()) === 'required') throw httpError(403, 'Your administrator requires two-factor authentication.');
    const user = await checkPassword(req.user.sub, req.body?.password);
    await disableMfa(user.id);
    await auditUser(req, user, `${user.full_name} - two-factor authentication turned off`);
    res.json({ ok: true });
  } catch (err) { sendError(res, err, next); }
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
    const { token: nt, hash: nh, expiresAt } = issueRefresh();
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
