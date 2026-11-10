// Settings the Field App keeps its own copy of, pushed from the Portal over the bridge:
// branding (settings and images) and the Field App's two-factor authentication policy.
// Pushed after every change and once at start-up (with retries, since the Field API may
// still be starting). Failures are logged and returned, never thrown.
import { getBranding, allAssets } from './settings.js';
import { getMfaPolicy } from './mfa.js';
import { fieldPlatform, isFieldConfigured } from './field-client.js';

const NOT_CONFIGURED = 'Field bridge not configured.';

export async function pushSecurityToField() {
  if (!isFieldConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    await fieldPlatform.pushSecurity({ mfa: (await getMfaPolicy()).field });
    return { ok: true };
  } catch (err) {
    console.warn('Security settings push to Field App failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function pushBrandingToField() {
  if (!isFieldConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const [branding, assets] = await Promise.all([getBranding(), allAssets()]);
    await fieldPlatform.pushBranding({
      branding,
      assets: assets.map(a => ({ kind: a.kind, mime: a.mime, sha256: a.sha256, data: a.data.toString('base64') })),
    });
    return { ok: true };
  } catch (err) {
    console.warn('Branding push to Field App failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function pushFieldSettingsWithRetry({ attempts = 10, delayMs = 6000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const branding = await pushBrandingToField();
    const security = branding.ok ? await pushSecurityToField() : branding;
    const r = security.ok ? branding : security;
    if (r.ok || r.error === NOT_CONFIGURED) return r;
    await new Promise(res => setTimeout(res, delayMs));
  }
  return { ok: false };
}
