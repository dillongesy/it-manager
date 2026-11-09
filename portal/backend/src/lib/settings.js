// App settings stored in the database (app_settings / branding_assets).
//
//   Integrations - loaded into the live `config` object at start-up and after every
//                  save, so the existing integration clients keep reading config.*.
//   Branding     - company/product names, colors, print header, uploaded images.
//   System       - setup + recovery-secret reveal bookkeeping.
import crypto from 'crypto';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { encrypt, decrypt } from './encrypt.js';
import { INTEGRATIONS, integrationById } from './integration-registry.js';
import { integrationChanged } from './integration-util.js';

// --- Generic key/value -------------------------------------------------------

export async function getSetting(key, fallback = null) {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? fallback;
}

export async function setSetting(key, value, userId = null, db = { query }) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), userId]
  );
}

// --- Integrations ------------------------------------------------------------

const intKey = (id) => `integration:${id}`;

function isComplete(def, values) {
  return def.fields.filter(f => f.required).every(f => values[f.key]);
}

// Copy one integration's stored settings into config[section]. Disabled = every
// field falls back to its default (or null), so is<X>Configured() reports false
// and the app hides that integration's buttons.
function applyIntegration(def, stored) {
  const section = config[def.section];
  const enabled = Boolean(stored?.enabled);
  for (const f of def.fields) {
    const raw = stored?.values?.[f.key];
    const val = raw == null || raw === '' ? null : (f.secret ? decrypt(raw) : raw);
    section[f.key] = enabled ? (val ?? f.default ?? null) : (f.default ?? null);
  }
}

// Start-up: load every integration from the DB. If an integration has never been
// saved but its legacy .env variables are present (an upgraded install, or local
// dev), seed the DB from them once so nothing silently switches off.
//
// `persist: false` applies environment values without writing them (diagnostic scripts).
export async function loadIntegrations({ persist = true } = {}) {
  const { rows } = await query(`SELECT key, value FROM app_settings WHERE key LIKE 'integration:%'`);
  const byKey = new Map(rows.map(r => [r.key, r.value]));

  for (const def of INTEGRATIONS) {
    let stored = byKey.get(intKey(def.id));
    if (!stored) {
      const values = {};
      for (const f of def.fields) {
        const v = process.env[f.env];
        if (v) values[f.key] = f.secret ? encrypt(v) : v;
      }
      const plain = Object.fromEntries(def.fields.map(f => [f.key, process.env[f.env] || null]));
      if (Object.keys(values).length && isComplete(def, plain)) {
        stored = { enabled: true, values };
        if (persist) {
          await setSetting(intKey(def.id), stored);
          console.log(`Integration "${def.id}" seeded from legacy environment variables.`);
        }
      }
    }
    applyIntegration(def, stored);
  }
}

// Admin view - secret values are never returned, only whether one is stored.
export async function listIntegrations() {
  const { rows } = await query(`SELECT key, value, updated_at FROM app_settings WHERE key LIKE 'integration:%'`);
  const byKey = new Map(rows.map(r => [r.key, r]));
  return INTEGRATIONS.map(def => {
    const row = byKey.get(intKey(def.id));
    const stored = row?.value ?? { enabled: false, values: {} };
    const values = {};
    const plain = {};
    for (const f of def.fields) {
      const raw = stored.values?.[f.key];
      if (f.secret) {
        values[f.key] = { set: Boolean(raw) };
        plain[f.key] = raw ? 'x' : null;
      } else {
        values[f.key] = raw ?? '';
        plain[f.key] = raw || f.default || null;
      }
    }
    return {
      id: def.id, label: def.label, summary: def.summary, help: def.help,
      fields: def.fields.map(({ env: _env, ...f }) => f),
      enabled: Boolean(stored.enabled),
      complete: isComplete(def, plain),
      values,
      updated_at: row?.updated_at ?? null,
    };
  });
}

// Save one integration. For secret fields: undefined / '' keeps the stored value,
// null clears it, anything else replaces it. Returns the names of changed fields
// (for the audit log - never the values).
export async function saveIntegration(id, { enabled, values = {} }, userId) {
  const def = integrationById(id);
  if (!def) { const e = new Error('Unknown integration.'); e.status = 404; throw e; }

  const current = (await getSetting(intKey(id))) ?? { enabled: false, values: {} };
  const next = { enabled: enabled === undefined ? Boolean(current.enabled) : Boolean(enabled), values: { ...current.values } };
  const changed = [];

  for (const f of def.fields) {
    if (!(f.key in values)) continue;
    const v = values[f.key];
    if (f.secret) {
      if (v === undefined || v === '') continue;
      next.values[f.key] = v === null ? null : encrypt(String(v).trim());
      changed.push(f.key);
    } else {
      const s = v == null ? null : String(v).trim() || null;
      if ((current.values?.[f.key] ?? null) !== s) changed.push(f.key);
      next.values[f.key] = s;
    }
  }
  if (next.enabled !== Boolean(current.enabled)) changed.push(next.enabled ? 'enabled' : 'disabled');

  if (next.enabled) {
    const plain = {};
    for (const f of def.fields) {
      const raw = next.values[f.key];
      plain[f.key] = raw ? 'x' : (f.default ?? null);
    }
    const missing = def.fields.filter(f => f.required && !plain[f.key]).map(f => f.label);
    if (missing.length) {
      const e = new Error(`Fill in ${missing.join(', ')} before enabling ${def.label}.`);
      e.status = 400; throw e;
    }
  }

  await setSetting(intKey(id), next, userId);
  applyIntegration(def, next);
  // New credentials (or a new tenant, URL, owner…): drop the old OAuth token and
  // anything cached from the old account, so the next call signs in fresh.
  if (changed.length) integrationChanged(id);
  return { def, changed };
}

// --- Branding ----------------------------------------------------------------

export const BRANDING_DEFAULTS = Object.freeze({
  companyName:  'Your Company',
  productName:  'IT Manager',
  fieldAppName: 'Field',
  tagline:      '',
  primaryColor: '#2563EB',
  accentColor:  '#F59E0B',
  // Print / PDF header + contact details
  address:      '',
  phone:        '',
  email:        '',
  website:      '',
  printFooter:  '',
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const LIMITS = { companyName: 120, productName: 60, fieldAppName: 60, tagline: 160, address: 300,
  phone: 40, email: 200, website: 200, printFooter: 500 };

export function sanitizeBranding(input = {}, base = BRANDING_DEFAULTS) {
  const out = { ...BRANDING_DEFAULTS, ...base };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (input[k] !== undefined) out[k] = String(input[k] ?? '').trim().slice(0, max);
  }
  for (const k of ['primaryColor', 'accentColor']) {
    if (input[k] !== undefined) {
      if (!HEX.test(String(input[k]))) { const e = new Error(`${k} must be a #RRGGBB color.`); e.status = 400; throw e; }
      out[k] = String(input[k]).toUpperCase();
    }
  }
  if (!out.companyName) out.companyName = BRANDING_DEFAULTS.companyName;
  if (!out.productName) out.productName = BRANDING_DEFAULTS.productName;
  return out;
}

export async function getBranding() {
  const stored = await getSetting('branding', {});
  return { ...BRANDING_DEFAULTS, ...stored };
}

// Public shape: branding + a versioned URL per uploaded asset (cache-busting).
export async function getPublicBranding() {
  const [branding, { rows }] = await Promise.all([
    getBranding(),
    query('SELECT kind, sha256 FROM branding_assets'),
  ]);
  const assets = {};
  for (const r of rows) assets[r.kind] = `/api/branding/assets/${r.kind}?v=${r.sha256.slice(0, 12)}`;
  return { ...branding, assets };
}

// --- Branding assets ---------------------------------------------------------

export const ASSET_KINDS = {
  logo:             { label: 'App logo (square)',         maxBytes: 2 * 1024 * 1024 },
  logo_full:        { label: 'Full logo (login & print)', maxBytes: 4 * 1024 * 1024 },
  favicon:          { label: 'Browser tab icon',          maxBytes: 512 * 1024 },
  login_background: { label: 'Login background',          maxBytes: 8 * 1024 * 1024 },
};

// Identify the image by its bytes, never by the browser-supplied type.
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  const head = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && /<svg[\s>]/i.test(head)) {
    // SVG can carry script. Refuse anything active; it is also served with a
    // locked-down CSP (see routes/branding.js) as a second layer.
    const all = buf.toString('utf8');
    if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(all)) return 'unsafe-svg';
    return 'image/svg+xml';
  }
  return null;
}

export async function saveAsset(kind, buf, userId) {
  const mime = sniffImage(buf);
  if (mime === 'unsafe-svg') { const e = new Error('That SVG contains scripts or event handlers, which are not allowed.'); e.status = 400; throw e; }
  if (!mime) { const e = new Error('Upload a PNG, JPEG, GIF, WebP, ICO or SVG image.'); e.status = 400; throw e; }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  await query(
    `INSERT INTO branding_assets (kind, mime, data, sha256, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, sha256 = EXCLUDED.sha256,
       updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [kind, mime, buf, sha256, userId]
  );
  return { mime, sha256 };
}

export async function deleteAsset(kind) {
  const { rowCount } = await query('DELETE FROM branding_assets WHERE kind = $1', [kind]);
  return rowCount > 0;
}

export async function getAsset(kind) {
  const { rows } = await query('SELECT mime, data, sha256 FROM branding_assets WHERE kind = $1', [kind]);
  return rows[0] ?? null;
}

export async function allAssets() {
  const { rows } = await query('SELECT kind, mime, data, sha256 FROM branding_assets');
  return rows;
}
