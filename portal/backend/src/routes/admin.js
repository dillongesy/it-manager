import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { query, getClient } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import {
  listIntegrations, saveIntegration, getBranding, getPublicBranding, sanitizeBranding, setSetting,
  getSetting, saveAsset, deleteAsset, ASSET_KINDS,
} from '../lib/settings.js';
import { BUNDLE, oneTimeExists, consumeOneTime } from '../lib/one-time.js';
import { pushBrandingToField, pushSecurityToField } from '../lib/branding-sync.js';
import { getMfaPolicy, saveMfaPolicy } from '../lib/mfa.js';
import { fieldPlatform, isFieldConfigured } from '../lib/field-client.js';
import { getDefaultRates, saveDefaultRates, RATE_LIMITS } from '../lib/billing-rates.js';
import { storageReport } from '../lib/storage.js';
import { hostStatus, hostLog, requestHostChange, backupList, LOGS, BACKUP_NAME } from '../lib/host-control.js';
import { ipInCidr } from '../lib/cidr.js';

// Admin API (admin role only).
//
//   GET    /api/admin/integrations              list (secret values never returned)
//   PUT    /api/admin/integrations/:id          { enabled?, values? }
//   GET    /api/admin/branding                  full branding + asset URLs
//   PUT    /api/admin/branding                  partial branding update
//   POST   /api/admin/branding/assets/:kind     multipart "file"
//   DELETE /api/admin/branding/assets/:kind
//   GET    /api/admin/security                  setup / recovery-secret status
//   POST   /api/admin/security/reveal           { password } → secrets, exactly once, ever
//   PUT    /api/admin/security/mfa              { portal?, field? } two-factor policy per app
//   GET    /api/admin/system                    version + Field bridge health
//   GET    /api/admin/storage                   disk, database and file sizes + forecast
//   GET    /api/admin/host                      firewall and update status (host helper)
//   PUT    /api/admin/host/updates              { schedule } automatic update schedule
//   POST   /api/admin/host/update-now           start an update now
//   PUT    /api/admin/host/network              { lan: [cidr], names: [host] } office network
//   GET    /api/admin/host/logs/:name           install, update, network, backup, verify or restore log
//   GET    /api/admin/backups                   backup settings, status and the list of backups
//   PUT    /api/admin/backups/settings          schedule, retention, storage and options
//   POST   /api/admin/backups/run               back up now
//   POST   /api/admin/backups/refresh           re-read the backup storage
//   POST   /api/admin/backups/:name/verify      check a backup
//   PUT    /api/admin/backups/:name/protect     { protected } never pruned or deleted
//   DELETE /api/admin/backups/:name
//   POST   /api/admin/backups/:name/restore     { password } replace all data with the backup
//   GET    /api/admin/billing-rates             default hourly rates for new customers
//   PUT    /api/admin/billing-rates             { rates: [{ label, rate }], applyToExisting? }
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const audit = (req, action, entityType, entityName, extra = {}) => logAudit({
  userId: req.user.sub, userName: req.user.fullName, action, entityType,
  entityName, ipAddress: getClientIp(req), ...extra,
});

// --- Integrations ------------------------------------------------------------

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

// --- Branding ----------------------------------------------------------------

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

// --- Security: reveal-once recovery secrets ----------------------------------

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
    mfa: await getMfaPolicy(),
  };
}

adminRouter.get('/security', async (_req, res, next) => {
  try { res.json(await securityStatus()); } catch (err) { next(err); }
});

adminRouter.put('/security/mfa', async (req, res, next) => {
  try {
    const policy = await saveMfaPolicy(req.body ?? {}, req.user.sub);
    await audit(req, 'UPDATE', 'security', `Two-factor authentication: Portal ${policy.portal}, Field App ${policy.field}`);
    const fieldSync = await pushSecurityToField();
    res.json({ mfa: policy, fieldSync });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
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

// --- Billing rates -----------------------------------------------------------

adminRouter.get('/billing-rates', async (_req, res, next) => {
  try { res.json({ rates: await getDefaultRates(), limits: RATE_LIMITS }); } catch (err) { next(err); }
});

adminRouter.put('/billing-rates', async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await saveDefaultRates(req.body?.rates, {
      applyToExisting: req.body?.applyToExisting === true, userId: req.user.sub, client,
    });
    await client.query('COMMIT');
    const summary = result.rates.map(r => `${r.label} ${r.rate.toFixed(2)}`).join(', ');
    await audit(req, 'UPDATE', 'billing_rates', `Default rates: ${summary}` +
      (result.customersUpdated ? ` (${result.customersUpdated} customer rates updated)` : ''));
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

// --- System ------------------------------------------------------------------

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

adminRouter.get('/storage', async (_req, res, next) => {
  try { res.json(await storageReport()); } catch (err) { next(err); }
});

// --- Server settings (host helper) -----------------------------------------------
// The firewall is shown here but not changed: it is chosen once in the setup wizard,
// or on the server with install.sh.

adminRouter.get('/host', async (_req, res, next) => {
  try {
    const status = await hostStatus();
    res.json(status ? { available: true, ...status } : { available: false });
  } catch (err) { next(err); }
});

const hostResult = async (req, res, label, change) => {
  const result = await requestHostChange(change);
  if (!result.ok) return res.status(400).json({ error: result.error || 'The server refused the change.' });
  await audit(req, 'UPDATE', 'server', label);
  res.json({ ok: true, status: await hostStatus() });
};

adminRouter.put('/host/updates', async (req, res, next) => {
  try {
    const schedule = String(req.body?.schedule ?? '');
    await hostResult(req, res, `Automatic updates: ${schedule}`, { updates: schedule });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

adminRouter.get('/host/logs/:name', async (req, res, next) => {
  try {
    if (!LOGS.includes(req.params.name)) return res.status(404).json({ error: 'Not found.' });
    res.json({ log: await hostLog(req.params.name) });
  } catch (err) { next(err); }
});

// The office network decides who may open the Portal, so a change that would shut out
// the admin making it is refused.
adminRouter.put('/host/network', async (req, res, next) => {
  try {
    const list = (v) => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean);
    const lan = [...new Set(list(req.body?.lan))];
    const names = [...new Set(list(req.body?.names).map(n => n.toLowerCase()))];
    if (!lan.length) return res.status(400).json({ error: 'Enter at least one office network.' });
    if (!lan.some(c => ipInCidr(req.ip, c))) {
      return res.status(400).json({ error: `Your computer (${String(req.ip).replace(/^::ffff:/, '')}) is not in any of these networks, so this change would lock you out of the Portal.` });
    }
    await hostResult(req, res, `Office network: ${lan.join(', ')}; Portal names: ${names.join(', ') || '(none)'}`, { network: { lan, names } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// --- Backups (host helper; see scripts/backup.sh) ----------------------------------------

const hostError = (res, next) => (err) => (err.status ? res.status(err.status).json({ error: err.message }) : next(err));

adminRouter.get('/backups', async (_req, res, next) => {
  try {
    const status = await hostStatus();
    if (!status?.backup) return res.json({ available: false });
    res.json({ available: true, settings: status.backup, updates: status.updates, nextUpdate: status.nextUpdate, list: await backupList() });
  } catch (err) { next(err); }
});

adminRouter.put('/backups/settings', async (req, res, next) => {
  const b = req.body ?? {};
  const where = b.storage === 'local' ? b.path : b.share;
  await hostResult(req, res, `Backups: ${b.schedule}, ${b.storage} ${where ?? ''}, keep ${Object.values(b.keep ?? {}).join('/')}, encryption ${b.encryption}`, { backup: b })
    .catch(hostError(res, next));
});

const backupTask = (task, label) => async (req, res, next) => {
  const name = req.params.name;
  if (name !== undefined && !BACKUP_NAME.test(name)) return res.status(400).json({ error: 'Invalid backup name.' });
  await hostResult(req, res, label(name, req.body ?? {}), { backupTask: { task: typeof task === 'function' ? task(req.body ?? {}) : task, name } })
    .catch(hostError(res, next));
};

adminRouter.post('/backups/run', backupTask('now', () => 'Backup started from the Portal'));
adminRouter.post('/backups/refresh', backupTask('refresh', () => 'Backup list refreshed'));
adminRouter.post('/backups/:name/verify', backupTask('verify', (n) => `Backup verification started: ${n}`));
adminRouter.put('/backups/:name/protect', backupTask((b) => (b.protected ? 'protect' : 'unprotect'), (n, b) => `Backup ${b.protected ? 'protected' : 'unprotected'}: ${n}`));
adminRouter.delete('/backups/:name', backupTask('delete', (n) => `Backup deleted: ${n}`));

// Restoring replaces every record and file, so the admin re-enters their password.
adminRouter.post('/backups/:name/restore', async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1 AND is_active = true', [req.user.sub]);
    if (!rows[0] || !password || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
      await audit(req, 'UPDATE', 'server', `Restore refused (wrong password): ${req.params.name}`);
      return res.status(401).json({ error: 'Password is incorrect.' });
    }
    return backupTask('restore', (n) => `Restore started from the Portal: ${n}`)(req, res, next);
  } catch (err) { next(err); }
});

adminRouter.post('/host/update-now', async (req, res, next) => {
  try {
    await hostResult(req, res, 'Update started from the Portal', { update: 'now' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
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
