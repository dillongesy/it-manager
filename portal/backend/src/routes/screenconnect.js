import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import * as sc from '../lib/screenconnect-client.js';
import { matchSessions } from '../lib/screenconnect.js';

// Remote buttons for a customer's devices.
//
//   GET /api/customers/:customerId/screenconnect/links → { configured, links: { [deviceId]: {…} }, error? }
//
// Matched live on every load (no stored session IDs), so a reinstalled agent or a
// renamed machine just works. Always answers 200: the Devices tab must never fail because
// ScreenConnect is down or unset — it just shows no Remote buttons and says why.

export const screenConnectRouter = Router({ mergeParams: true });

screenConnectRouter.get('/links', requireAuth, async (req, res, next) => {
  if (!sc.isScreenConnectConfigured()) return res.json({ configured: false, links: {} });
  try {
    const { customerId } = req.params;
    const [{ rows: devices }, { rows: cust }, sessions] = await Promise.all([
      query(`SELECT id, device_type, label, computer_name, service_tag, serial_number, mac_address, other_macs
               FROM customer_devices WHERE customer_id = $1`, [customerId]),
      query('SELECT name FROM customers WHERE id = $1', [customerId]),
      sc.sessions({ refresh: req.query.refresh === '1' }),
    ]);
    const links = {};
    for (const [deviceId, { session, reason }] of matchSessions(devices, sessions, cust[0]?.name)) {
      links[deviceId] = {
        url: sc.joinUrlFor(session.id),
        options_url: sc.optionsUrlFor(session.id),
        session_name: session.name,
        company: session.company,
        online: session.online,
        last_seen: session.last_seen,
        matched_by: reason,
      };
    }
    res.json({ configured: true, links });
  } catch (err) {
    if (err instanceof sc.ScreenConnectError) return res.json({ configured: true, links: {}, error: err.message });
    next(err);
  }
});
