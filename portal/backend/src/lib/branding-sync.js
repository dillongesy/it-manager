// Push the Portal's branding (settings + images) to the Field App over the bridge.
// Called after every branding change and once at start-up (with retries, since the
// Field API may still be booting). Failures are logged, never thrown - branding is
// cosmetic and must not break a save.
import { getBranding, allAssets } from './settings.js';
import { fieldPlatform, isFieldConfigured } from './field-client.js';

export async function pushBrandingToField() {
  if (!isFieldConfigured()) return { ok: false, error: 'Field bridge not configured.' };
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

export async function pushBrandingWithRetry({ attempts = 10, delayMs = 6000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const r = await pushBrandingToField();
    if (r.ok || r.error === 'Field bridge not configured.') return r;
    await new Promise(res => setTimeout(res, delayMs));
  }
  return { ok: false };
}
