import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import {
  listIntegrations, saveIntegration, getBranding, getPublicBranding, sanitizeBranding, setSetting,
  getSetting, saveAsset, deleteAsset, ASSET_KINDS,
} from '../lib/settings.js';
import { BUNDLE, oneTimeExists, consumeOneTime } from '../lib/one-time.js';
import { pushBrandingToField } from '../lib/branding-sync.js';
import { fieldPlatform, isFieldConfigured } from '../lib/field-client.js';

// Admin → everything that used to be server configuration.
//
//   GET    /api/admin/integrations              list (secret values never returned)
//   PUT    /api/admin/integrations/:id          { enabled?, values? }
//   GET    /api/admin/branding                  full branding + asset URLs
//   PUT    /api/admin/branding                  partial branding update
//   POST   /api/admin/branding/assets/:kind     multipart "file"
//   DELETE /api/admin/branding/assets/:kind
//   GET    /api/admin/security                  setup / recovery-secret status
//   POST   /api/admin/security/reveal           { password } → secrets, exactly once, ever
//   GET    /api/admin/system                    version + Field bridge health
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const audit = (req, action, entityType, entityName, extra = {}) => logAudit({
  userId: req.user.sub, userName: req.user.fullName, action, entityType,
  entityName, ipAddress: getClientIp(req), ...extra,
});

// ─── Integrations ────────────────────────────────────────────────────────────

adminRouter.get('/integrations', async (_req, res, next) => {
  try { res.json(await listIntegrations()); } catch (err) { next(err); }
});

adminRouter.put('/integrations/:id', async (req, res, next) => {
  try {
    const { def, changed } = await saveIntegration(req.params.id, req.body ?? {}, req.user.sub);
    if (changed.length) await audit(req, 'UPDATE', 'integration', `${def.label} — ${changed.join(', ')}`);
    res.json((await listIntegrations()).find(i => i.id === def.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── Branding ────────────────────────────────────────────────────────────────

adminRouter.get('/branding', async (_req, res, next) => {
  try {
    const assetsMeta = Object.entries(ASSET_KINDS).map(([kind, v]) => ({ kind, label: v.label, maxBytes: v.maxBytes }));
    res.json({ ...(await getPublicBranding()), assetKinds: assetsMeta });
  } catch (err) { next(err); }
});

adminRouter.put('/branding', async (req, res, next) => {
  try {
    const next_ = sanitizeBranding(req.body ?? {}, await getBranding());
    await setSetting('branding', next_, req.user.sub);
    await audit(req, 'UPDATE', 'branding', 'Branding settings');
    const field = await pushBrandingToField();
    res.json({ ...(await getPublicBranding()), fieldSync: field });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

adminRouter.post('/branding/assets/:kind', (req, res, next) => {
  const kind = req.params.kind;
  if (!ASSET_KINDS[kind]) return res.status(404).json({ error: 'Unknown image type.' });
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
      if (req.file.size > ASSET_KINDS[kind].maxBytes) {
        return res.status(400).json({ error: `${ASSET_KINDS[kind].label} must be under ${Math.round(ASSET_KINDS[kind].maxBytes / 1024)} KB.` });
      }
      await saveAsset(kind, req.file.buffer, req.user.sub);
      await audit(req, 'UPDATE', 'branding', `${ASSET_KINDS[kind].label} uploaded`);
      const field = await pushBrandingToField();
      res.json({ ...(await getPublicBranding()), fieldSync: field });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });
});

adminRouter.delete('/branding/assets/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind;
    if (!ASSET_KINDS[kind]) return res.status(404).json({ error: 'Unknown image type.' });
    if (await deleteAsset(kind)) await audit(req, 'DELETE', 'branding', `${ASSET_KINDS[kind].label} removed`);
    const field = await pushBrandingToField();
    res.json({ ...(await getPublicBranding()), fieldSync: field });
  } catch (err) { next(err); }
});

// ─── Security: reveal-once recovery secrets ──────────────────────────────────

async function securityStatus() {
  const system = await getSetting('system', {});
  return {
    setupCompletedAt: system.setupCompletedAt ?? null,
    secretsRevealedAt: system.secretsRevealedAt ?? null,
    secretsRevealedBy: system.secretsRevealedBy ?? null,
    // True only until the one reveal happens. Afterwards there is no file and no
    // code path that can produce the secrets again.
    secretsAvailable: !system.secretsRevealedAt && oneTimeExists(BUNDLE),
    managedSecrets: Boolean(config.revealDir),
  };
}

adminRouter.get('/security', async (_req, res, next) => {
  try { res.json(await securityStatus()); } catch (err) { next(err); }
});

adminRouter.post('/security/reveal', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const status = await securityStatus();
    if (status.secretsRevealedAt) {
      return res.status(410).json({ error: `These secrets were already revealed on ${new Date(status.secretsRevealedAt).toLocaleString()} by ${status.secretsRevealedBy}. They can never be shown again through the app.` });
    }

    // Re-authenticate: a stolen session alone must not be enough.
    const { password } = req.body ?? {};
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1 AND is_active = true', [req.user.sub]);
    if (!rows[0] || !password || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
      await audit(req, 'VIEW', 'recovery_secrets', 'Recovery secret reveal refused — wrong password');
      return res.status(401).json({ error: 'Password is incorrect.' });
    }

    const raw = await consumeOneTime(BUNDLE);   // read once, then shredded
    const system = await getSetting('system', {});
    await setSetting('system', {
      ...system,
      secretsRevealedAt: new Date().toISOString(),
      secretsRevealedBy: req.user.fullName,
    }, req.user.sub);

    if (!raw) {
      await audit(req, 'VIEW', 'recovery_secrets', 'Recovery secret reveal attempted — bundle no longer exists');
      return res.status(410).json({ error: 'The recovery secrets no longer exist on the server. They can only be recovered by root on the host.' });
    }

    await audit(req, 'VIEW', 'recovery_secrets', 'Recovery secrets revealed (one time) — bundle destroyed');
    let secrets;
    try { secrets = JSON.parse(raw); } catch { secrets = { raw }; }
    res.json({ secrets, revealedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ─── System ──────────────────────────────────────────────────────────────────

adminRouter.get('/system', async (_req, res, next) => {
  try {
    let field = { configured: isFieldConfigured(), reachable: false };
    if (field.configured) {
      try { await fieldPlatform.health(); field.reachable = true; }
      catch (err) { field.error = err.message; }
    }
    res.json({ version: config.appVersion, nodeEnv: config.nodeEnv, field });
  } catch (err) { next(err); }
});

// Retry of the setup wizard's Field admin creation, using the signed-in admin's own
// login (bcrypt hash only). The Field App refuses once it has any real user.
adminRouter.post('/system/field-admin', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT username, full_name, email, password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    const u = rows[0];
    const initials = u.full_name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 3).toUpperCase();
    await fieldPlatform.bootstrapAdmin({ username: u.username, full_name: u.full_name, initials, email: u.email, password_hash: u.password_hash });
    await audit(req, 'CREATE', 'user', `${u.full_name} — Field App admin login`);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
    next(err);
  }
});
