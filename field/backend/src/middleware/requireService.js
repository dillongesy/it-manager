import { config } from '../config/index.js';
import { safeTokenEqual } from '../lib/inventory-logic.js';
import { ipInCidr } from '../lib/cidr.js';

/**
 * Gate for the shared-inventory bridge. The ONLY caller is the IT Portal backend,
 * which presents a static service token in the X-Service-Token header.
 *
 * This is deliberately separate from requireAuth (human JWT logins). It never
 * grants access to anything but the explicit /api/service routes, and the Field
 * App holds no equivalent way to call the Portal — the bridge is one-way.
 */
export function requireService(req, res, next) {
  const expected = config.serviceToken;
  if (!expected) {
    return res.status(503).json({ error: 'Inventory bridge is not configured on this server.' });
  }

  // Network check first (Docker): the TCP peer must be on the internal bridge
  // network. Uses the socket address, never X-Forwarded-For, so it can't be spoofed
  // through the public web proxy — which also refuses /api/service outright.
  if (config.serviceAllowedCidr && !ipInCidr(req.socket.remoteAddress, config.serviceAllowedCidr)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  const presented = req.headers['x-service-token'];
  if (!presented || !safeTokenEqual(presented, expected)) {
    return res.status(401).json({ error: 'Invalid service token.' });
  }
  next();
}
