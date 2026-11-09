import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import * as dell from '../lib/dell-client.js';
import { warrantyPlan, tagOf, isDell } from '../lib/dell.js';

// Dell warranty check for a customer's devices.
//
//   GET  /api/customers/:customerId/warranty/dell        — every Dell device + what Dell says
//   POST /api/customers/:customerId/warranty/dell/apply  — { device_ids } write the dates
//
// Read-only against Dell. The ConnectWise import also fills warranties as it goes
// (routes/connectwise.js); this is for devices entered by hand or imported earlier.

const NOT_CONFIGURED = {
  error: 'Dell warranty lookup is not configured. An admin can set it up in Admin → Integrations.',
  configured: false,
};

function sendError(res, next, err) {
  if (err instanceof dell.DellError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

async function plan(customerId, refresh) {
  const { rows: devices } = await query(
    'SELECT * FROM customer_devices WHERE customer_id = $1 ORDER BY device_type, sort_order, label', [customerId]);
  const dellDevices = devices.filter(isDell);
  const results = await dell.lookup(dellDevices.map(tagOf), { refresh });
  return { rows: warrantyPlan(dellDevices, results), devices };
}

export const warrantyRouter = Router({ mergeParams: true });

warrantyRouter.get('/dell', requireAuth, async (req, res, next) => {
  if (!dell.isDellConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { rows } = await plan(req.params.customerId, req.query.refresh === '1');
    res.json({ rows });
  } catch (err) { sendError(res, next, err); }
});

warrantyRouter.post('/dell/apply', requireAuth, async (req, res, next) => {
  if (!dell.isDellConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const ids = new Set(Array.isArray(req.body?.device_ids) ? req.body.device_ids.map(String) : []);
    if (!ids.size) return res.status(400).json({ error: 'Pick at least one device.' });
    const { rows } = await plan(req.params.customerId, false);   // uses the lookup the preview just made
    const result = { updated: [], unchanged: [], skipped: [] };
    for (const r of rows.filter(r => ids.has(String(r.device_id)))) {
      if (!r.expires) { result.skipped.push({ device_id: r.device_id, name: r.name, reason: r.action === 'no_tag' ? 'no service tag' : 'Dell has no record of this service tag' }); continue; }
      // Coverage and "last checked" are refreshed even when the date is the same.
      await query(
        `UPDATE customer_devices
            SET warranty_expires = $3, warranty_coverage = $4, warranty_checked_at = NOW(),
                updated_at = CASE WHEN warranty_expires IS DISTINCT FROM $3::date THEN NOW() ELSE updated_at END
          WHERE id = $1 AND customer_id = $2`,
        [r.device_id, req.params.customerId, r.expires, r.coverage || null]
      );
      if (r.action === 'unchanged') { result.unchanged.push({ device_id: r.device_id, name: r.name }); continue; }
      await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
        entityType: 'device', entityId: r.device_id, entityName: `${r.name} — warranty from Dell`,
        changes: { warranty_expires: { from: r.current || null, to: r.expires }, warranty_coverage: { from: r.current_coverage || null, to: r.coverage || null } },
        ipAddress: getClientIp(req) });
      result.updated.push({ device_id: r.device_id, name: r.name, from: r.current || null, to: r.expires, coverage: r.coverage });
    }
    res.json(result);
  } catch (err) { sendError(res, next, err); }
});
