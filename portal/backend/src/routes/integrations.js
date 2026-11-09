import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { isConnectWiseConfigured } from '../lib/connectwise-client.js';
import { isDellConfigured } from '../lib/dell-client.js';
import { isScreenConnectConfigured } from '../lib/screenconnect-client.js';
import { isUnifiConfigured } from '../lib/unifi-client.js';
import { isTdSynnexConfigured } from '../lib/tdsynnex-client.js';
import { isAuvikConfigured } from '../lib/auvik-client.js';
import { isThreatLockerConfigured } from '../lib/threatlocker-client.js';
import { isOutlookConfigured } from '../lib/outlook-client.js';
import { linksFor } from '../lib/integration-links.js';

//   GET    /api/integrations/status                         — which outside systems are configured
//   GET    /api/customers/:customerId/integrations          — the customer's linked sites / consoles
//   DELETE /api/customers/:customerId/integrations/:linkId  — forget a link (imported records stay)

export const integrationsRouter = Router();

integrationsRouter.get('/status', requireAuth, (req, res) => {
  res.json({
    connectwise:   isConnectWiseConfigured(),
    dell:          isDellConfigured(),
    screenconnect: isScreenConnectConfigured(),
    unifi:         isUnifiConfigured(),
    tdsynnex:      isTdSynnexConfigured(),
    auvik:         isAuvikConfigured(),
    threatlocker:  isThreatLockerConfigured(),
    outlook:       isOutlookConfigured(),
  });
});

export const customerIntegrationsRouter = Router({ mergeParams: true });

customerIntegrationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ links: await linksFor(req.params.customerId, req.query.provider || null) });
  } catch (err) { next(err); }
});

customerIntegrationsRouter.delete('/:linkId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM customer_integration_links WHERE id = $1 AND customer_id = $2 RETURNING *',
      [req.params.linkId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Link not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'integration_link', entityId: rows[0].id,
      entityName: `Unlinked ${rows[0].provider}: ${rows[0].external_name || rows[0].external_id}`,
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
