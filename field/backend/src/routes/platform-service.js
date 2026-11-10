import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireService } from '../middleware/requireService.js';
import { logAudit } from '../middleware/audit.js';
import { directorySize, UPLOADS_ROOT } from '../lib/storage.js';
import { setMfaPolicy } from '../lib/mfa.js';

// Platform endpoints on the one-way bridge (Portal → Field only, service token).
//   GET  /api/service/health           - bridge check for the Portal's Admin → System
//   PUT  /api/service/branding         - the Portal pushes a full copy of its branding
//   POST /api/service/bootstrap-admin  - setup wizard: first Field admin (same login)
//   GET  /api/service/storage          - database and uploaded-file sizes, in bytes
//   PUT  /api/service/security         - { mfa } the Field App's two-factor policy
const router = Router();
router.use(requireService);

router.get('/health', (_req, res) => res.json({ ok: true }));

router.put('/security', async (req, res, next) => {
  try {
    await setMfaPolicy(req.body?.mfa);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/storage', async (_req, res, next) => {
  try {
    const [{ rows }, files] = await Promise.all([
      query('SELECT pg_database_size(current_database())::bigint AS bytes'),
      directorySize(UPLOADS_ROOT),
    ]);
    res.json({ database: Number(rows[0].bytes), files });
  } catch (err) { next(err); }
});

const KINDS = new Set(['logo', 'logo_full', 'favicon', 'login_background']);
const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/svg+xml']);

router.put('/branding', async (req, res, next) => {
  const { branding, assets = [] } = req.body ?? {};
  if (!branding || typeof branding !== 'object') return res.status(400).json({ error: 'branding is required.' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('branding', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(branding)]
    );
    // Mirror the Portal exactly: anything it no longer has is removed here too.
    const keep = assets.filter(a => KINDS.has(a.kind) && MIMES.has(a.mime));
    await client.query('DELETE FROM branding_assets WHERE NOT (kind = ANY($1))', [keep.map(a => a.kind)]);
    for (const a of keep) {
      await client.query(
        `INSERT INTO branding_assets (kind, mime, data, sha256, updated_at) VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, sha256 = EXCLUDED.sha256, updated_at = NOW()`,
        [a.kind, a.mime, Buffer.from(String(a.data), 'base64'), String(a.sha256).slice(0, 64)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.post('/bootstrap-admin', async (req, res, next) => {
  try {
    const { username, full_name, initials, email, password_hash } = req.body ?? {};
    if (!username || !full_name || !password_hash || !/^\$2[aby]\$\d{2}\$/.test(password_hash)) {
      return res.status(400).json({ error: 'username, full_name and a bcrypt password_hash are required.' });
    }
    // Only on a brand-new Field App (the bridge's own service account doesn't count).
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE username <> 'it-portal-service'`);
    if (rows[0].n > 0) return res.status(409).json({ error: 'The Field App already has users.' });

    const { rows: created } = await query(
      `INSERT INTO users (username, email, full_name, initials, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING id, full_name`,
      [String(username).toLowerCase().trim(), email || null, String(full_name).trim(),
        String(initials || '').toUpperCase().slice(0, 5) || null, password_hash]
    );
    await logAudit({ userId: created[0].id, userName: created[0].full_name, action: 'CREATE',
      entityType: 'user', entityId: created[0].id, entityName: `${created[0].full_name} — first admin (Portal setup)` });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
