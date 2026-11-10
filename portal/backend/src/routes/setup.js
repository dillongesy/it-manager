import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getClient, query } from '../db/index.js';
import { config } from '../config/index.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { getSetting, setSetting, sanitizeBranding, getBranding } from '../lib/settings.js';
import { SETUP_CODE, BUNDLE, oneTimeExists, peekOneTime, destroyOneTime, safeEqual, generateSetupCode, writeOneTime } from '../lib/one-time.js';
import { fieldPlatform, isFieldConfigured } from '../lib/field-client.js';
import { pushBrandingToField } from '../lib/branding-sync.js';

// First-run setup wizard (public until the first admin exists, then permanently closed).
//
//   GET  /api/setup/status → { needsSetup, setupCodeRequired, secretsPending, services? }
//   POST /api/setup        → { setupCode, companyName, productName, admin: { full_name, username, email, password } }
//                          ← { ok, steps: [{ id, label, ok, error? }] }
//
// The setup code is printed in the Portal API's log on every start until setup is
// complete, so only someone who can see the server's container logs can claim a fresh
// install; nobody else on the network can race to create the first admin.
const router = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many setup attempts. Try again later.' } });

async function userCount() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  return rows[0].n;
}

/**
 * Print the setup code to the log while setup is pending, creating one if none exists.
 * Called on start-up.
 */
export async function announceSetupCode() {
  if (!config.revealDir || (await userCount()) > 0) return;
  let code = await peekOneTime(SETUP_CODE);
  if (!code) {
    code = generateSetupCode();
    await writeOneTime(SETUP_CODE, code);
  }
  const line = '='.repeat(64);
  console.log([
    line,
    ' Setup is not complete.',
    ` SETUP CODE: ${code}`,
    ' Open https://<server>:8443 in a browser and enter this code.',
    line,
  ].join('\n'));
}

// Readiness of the parts of the stack the wizard depends on. Reported only while setup
// is pending; the Portal API and its database are implicitly ready if this runs.
async function serviceStatus() {
  const field = { configured: isFieldConfigured(), reachable: false };
  if (field.configured) {
    try { await fieldPlatform.health(); field.reachable = true; } catch (err) { field.error = err.message; }
  }
  return { portal: { reachable: true }, field };
}

router.get('/status', async (_req, res, next) => {
  try {
    const system = await getSetting('system', {});
    const needsSetup = (await userCount()) === 0;
    res.json({
      needsSetup,
      setupCodeRequired: Boolean(config.revealDir),
      secretsPending: !system.secretsRevealedAt && oneTimeExists(BUNDLE),
      ...(needsSetup ? { services: await serviceStatus() } : {}),
    });
  } catch (err) { next(err); }
});

// Check the setup code before the rest of the form is filled in. Rate-limited with setup.
router.post('/verify-code', limiter, async (req, res, next) => {
  try {
    if ((await userCount()) > 0) return res.status(409).json({ error: 'Setup has already been completed.' });
    if (!config.revealDir) return res.json({ ok: true });
    const expected = await peekOneTime(SETUP_CODE);
    if (!expected) {
      return res.status(503).json({ error: 'No setup code is available. Restart the stack to print a new one in the Portal API log.' });
    }
    if (!safeEqual(String(req.body?.setupCode ?? '').trim().toUpperCase(), expected.toUpperCase())) {
      return res.status(403).json({ error: 'Setup code is incorrect.' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function initialsOf(name) {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 3).toUpperCase() || 'AD';
}

router.post('/', limiter, async (req, res, next) => {
  const { setupCode, companyName, productName, admin = {} } = req.body ?? {};
  const full_name = String(admin.full_name ?? '').trim();
  const username = String(admin.username ?? '').toLowerCase().trim();
  const email = String(admin.email ?? '').toLowerCase().trim();
  const password = String(admin.password ?? '');

  if (!full_name || !username || !email || !password) {
    return res.status(400).json({ error: 'Name, username, email and password are required.' });
  }
  if (!/^[a-z0-9._-]{2,50}$/.test(username)) {
    return res.status(400).json({ error: 'Username: 2–50 characters, letters, numbers, dot, dash or underscore.' });
  }
  if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters.' });

  if (config.revealDir) {
    const expected = await peekOneTime(SETUP_CODE);
    if (!expected) {
      return res.status(503).json({ error: 'No setup code is available. Restart the stack to print a new one in the Portal API log.' });
    }
    if (!safeEqual(String(setupCode ?? '').trim().toUpperCase(), expected.toUpperCase())) {
      return res.status(403).json({ error: 'Setup code is incorrect.' });
    }
  }

  const client = await getClient();
  let user;
  let passwordHash;
  try {
    await client.query('BEGIN');
    // Serialize concurrent setup attempts; only the first can see zero users.
    await client.query('SELECT pg_advisory_xact_lock(727001)');
    const { rows: c } = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (c[0].n > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Setup has already been completed.' });
    }

    passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const { rows } = await client.query(
      `INSERT INTO users (username, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id, username, full_name, role`,
      [username, email, full_name, passwordHash]
    );
    user = rows[0];

    const branding = sanitizeBranding({ companyName, productName }, await getBranding());
    await setSetting('branding', branding, user.id, client);
    const system = await getSetting('system', {});
    await setSetting('system', { ...system, setupCompletedAt: new Date().toISOString(), setupCompletedBy: full_name }, user.id, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists.' });
    return next(err);
  }
  client.release();

  await destroyOneTime(SETUP_CODE);
  await logAudit({ userId: user.id, userName: user.full_name, action: 'CREATE', entityType: 'user',
    entityId: user.id, entityName: `${user.full_name} — first admin (setup wizard)`, ipAddress: getClientIp(req) });

  const steps = [
    { id: 'admin', label: 'Create the Portal admin account', ok: true },
    { id: 'company', label: 'Save company details', ok: true },
  ];

  // Same login on the Field App (bcrypt hash only; the password never crosses the bridge).
  if (isFieldConfigured()) {
    try {
      await fieldPlatform.bootstrapAdmin({ username, full_name, initials: initialsOf(full_name), email, password_hash: passwordHash });
      steps.push({ id: 'field-admin', label: 'Create the same login on the Field App', ok: true });
    } catch (err) {
      steps.push({ id: 'field-admin', label: 'Create the same login on the Field App', ok: false, error: err.message });
    }
    const pushed = await pushBrandingToField();
    steps.push({ id: 'field-branding', label: 'Send company details to the Field App', ok: pushed.ok, ...(pushed.ok ? {} : { error: pushed.error }) });
  }

  res.status(201).json({ ok: true, user: { username: user.username }, steps });
});

export default router;
