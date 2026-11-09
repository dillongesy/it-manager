import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { nextRenewal, toDateStr } from '../lib/renewal.js';

const router = Router();

// These are "the soonest N" dashboard lists, so a cap is by design — but 200 was
// low enough to hide real renewals once every customer has licenses.
const clampLimit = (v) => Math.min(Math.max(parseInt(v, 10) || 200, 1), 1000);

// GET /api/licenses/expiring?limit=50 — non-auto-renewing licenses with an expiration
// date, soonest first. These are the ones someone has to manually renew, so they're the
// urgent dashboard list. Auto-renewing subscriptions are excluded (see /renewals).
router.get('/expiring', requireAuth, async (req, res, next) => {
  try {
    // LEFT JOIN the source device (for device-synced licenses) so the dashboard can
    // filter by device type / model (e.g. "firewall licenses", "SonicWall TZ370").
    const { rows } = await query(
      `SELECT l.id, l.customer_id, l.program_name, l.vendor, l.renewal_date,
              l.source_device_id, d.device_type, d.manufacturer, d.model,
              c.name AS customer_name
       FROM customer_licenses l
       JOIN customers c ON c.id = l.customer_id AND c.is_active = true
       LEFT JOIN customer_devices d ON d.id = l.source_device_id
       WHERE l.renewal_date IS NOT NULL
         AND l.auto_renew = false
       ORDER BY l.renewal_date ASC
       LIMIT $1`,
      [clampLimit(req.query.limit)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/licenses/renewals?limit=50 — auto-renewing subscriptions with their NEXT
// renewal date computed (rolled forward from the stored anchor by month/year), soonest
// first. Lets the office see what charges are coming and on which card.
router.get('/renewals', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT l.id, l.customer_id, l.program_name, l.vendor, l.renewal_date,
              l.renewal_interval, l.renewal_interval_count, l.payment_method,
              c.name AS customer_name
       FROM customer_licenses l
       JOIN customers c ON c.id = l.customer_id AND c.is_active = true
       WHERE l.auto_renew = true
         AND l.renewal_date IS NOT NULL`,
      []
    );
    const enriched = rows
      .map(r => ({ ...r, next_renewal: toDateStr(nextRenewal(r.renewal_date, r.renewal_interval, undefined, r.renewal_interval_count)) }))
      .filter(r => r.next_renewal)
      .sort((a, b) => a.next_renewal.localeCompare(b.next_renewal))
      .slice(0, clampLimit(req.query.limit));
    res.json(enriched);
  } catch (err) { next(err); }
});

export default router;
