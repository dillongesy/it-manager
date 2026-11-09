import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import * as auvik from '../lib/auvik-client.js';
import { matchAuvik, remoteBrowserUrl, tenantUrl } from '../lib/auvik.js';
import { linksFor } from '../lib/integration-links.js';

// "Web UI" buttons for a customer's network gear (Auvik Remote Browser).
//
//   GET /api/customers/:customerId/auvik/links → { configured, links: { [deviceId]: {…} }, error? }
//
// Matched live (nothing stored). Always answers 200 so the Devices tab never breaks.

export const auvikRouter = Router({ mergeParams: true });

auvikRouter.get('/links', requireAuth, async (req, res, next) => {
  if (!auvik.isAuvikConfigured()) return res.json({ configured: false, links: {} });
  try {
    const { customerId } = req.params;
    const [{ rows: devices }, { rows: cust }, cwLinks, all] = await Promise.all([
      query(`SELECT id, device_type, label, computer_name, service_tag, serial_number, ip_address
               FROM customer_devices WHERE customer_id = $1`, [customerId]),
      query('SELECT name FROM customers WHERE id = $1', [customerId]),
      linksFor(customerId, 'connectwise'),
      auvik.devices({ refresh: req.query.refresh === '1' }),
    ]);
    // Auvik sites are created from ConnectWise companies / sites, so those names count too.
    const siteNames = [cust[0]?.name, ...cwLinks.flatMap(l => String(l.external_name ?? '').split(' › '))].filter(Boolean);
    const region = auvik.region();
    const links = {};
    for (const [deviceId, { device, reason }] of matchAuvik(devices, all, siteNames)) {
      if (!device.domain_prefix) continue;
      const at = (port) => remoteBrowserUrl({ domainPrefix: device.domain_prefix, deviceId: device.id, port, region });
      links[deviceId] = {
        https_url: at(443),
        http_url: at(80),
        // The frontend swaps PORT for a port the tech types in.
        port_url_template: at(65535).replace('-65535.', '-PORT.'),
        site_url: tenantUrl({ domainPrefix: device.domain_prefix, region }),
        auvik_name: device.name,
        site: device.tenant_name,
        online: device.online,
        matched_by: reason,
      };
    }
    res.json({ configured: true, links });
  } catch (err) {
    if (err instanceof auvik.AuvikError) return res.json({ configured: true, links: {}, error: err.message });
    next(err);
  }
});
