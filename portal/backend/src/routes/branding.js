import { Router } from 'express';
import { getPublicBranding, getAsset, ASSET_KINDS } from '../lib/settings.js';

// Public (no login) — the login page, browser tab and print header need branding
// before anyone signs in. Nothing here is sensitive.
//   GET /api/branding               → names, colors, contact details, asset URLs
//   GET /api/branding/assets/:kind  → the uploaded image bytes
const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-cache');
    res.json(await getPublicBranding());
  } catch (err) { next(err); }
});

router.get('/assets/:kind', async (req, res, next) => {
  try {
    if (!ASSET_KINDS[req.params.kind]) return res.status(404).end();
    const asset = await getAsset(req.params.kind);
    if (!asset) return res.status(404).end();
    const etag = `"${asset.sha256}"`;
    res.set({
      'Content-Type': asset.mime,
      'ETag': etag,
      // URLs carry ?v=<hash>, so a long cache is safe; a new upload changes the URL.
      'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      // Even a sanitized SVG opened directly can never run script or load anything.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(asset.data);
  } catch (err) { next(err); }
});

export default router;
