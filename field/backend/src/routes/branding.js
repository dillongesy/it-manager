import { Router } from 'express';
import { query } from '../db/index.js';

// Public branding for the Field App (login page, tab icon). Written only by the
// Portal over the bridge; nothing here is sensitive.
const router = Router();

const DEFAULTS = {
  companyName: 'Your Company', productName: 'IT Manager', fieldAppName: 'Field',
  primaryColor: '#2563EB', accentColor: '#F59E0B',
};

router.get('/', async (_req, res, next) => {
  try {
    const [{ rows: s }, { rows: a }] = await Promise.all([
      query(`SELECT value FROM app_settings WHERE key = 'branding'`),
      query('SELECT kind, sha256 FROM branding_assets'),
    ]);
    const assets = {};
    for (const r of a) assets[r.kind] = `/api/branding/assets/${r.kind}?v=${r.sha256.slice(0, 12)}`;
    const b = { ...DEFAULTS, ...(s[0]?.value ?? {}) };
    // Only what the Field UI needs - not the Portal's address / print details.
    res.set('Cache-Control', 'no-cache');
    res.json({
      companyName: b.companyName, productName: b.productName, fieldAppName: b.fieldAppName,
      primaryColor: b.primaryColor, accentColor: b.accentColor, assets,
    });
  } catch (err) { next(err); }
});

// Installable-app (PWA) manifest, so the home-screen name, color and icon follow
// the branding instead of a static file baked into the image.
router.get('/manifest.webmanifest', async (_req, res, next) => {
  try {
    const [{ rows: s }, { rows: a }] = await Promise.all([
      query(`SELECT value FROM app_settings WHERE key = 'branding'`),
      query(`SELECT kind, mime, sha256 FROM branding_assets WHERE kind IN ('favicon', 'logo')`),
    ]);
    const b = { ...DEFAULTS, ...(s[0]?.value ?? {}) };
    const icon = a.find(r => r.kind === 'logo') ?? a.find(r => r.kind === 'favicon');
    res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
      name: `${b.companyName} ${b.fieldAppName}`.trim(),
      short_name: b.fieldAppName,
      description: `${b.companyName} — field job capture and inventory`,
      start_url: '/',
      display: 'standalone',
      background_color: '#0D0D0D',
      theme_color: b.primaryColor,
      icons: [icon
        ? { src: `/api/branding/assets/${icon.kind}?v=${icon.sha256.slice(0, 12)}`, sizes: 'any', type: icon.mime, purpose: 'any' }
        : { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    }));
  } catch (err) { next(err); }
});

router.get('/assets/:kind', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT mime, data, sha256 FROM branding_assets WHERE kind = $1', [req.params.kind]);
    if (!rows[0]) return res.status(404).end();
    const etag = `"${rows[0].sha256}"`;
    res.set({
      'Content-Type': rows[0].mime,
      ETag: etag,
      'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(rows[0].data);
  } catch (err) { next(err); }
});

export default router;
