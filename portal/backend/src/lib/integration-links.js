import { query } from '../db/index.js';

// Which outside site / console a customer is (customer_integration_links, migration 058).
// Recorded by the imports themselves, so the next sync opens on the right place for
// every tech, not just the browser that ran the last one.

export const PROVIDERS = ['connectwise', 'unifi', 'tdsynnex', 'threatlocker'];

export async function linksFor(customerId, provider) {
  const params = [customerId];
  let sql = 'SELECT * FROM customer_integration_links WHERE customer_id = $1';
  if (provider) { params.push(provider); sql += ' AND provider = $2'; }
  const { rows } = await query(`${sql} ORDER BY last_synced_at DESC NULLS LAST, created_at DESC`, params);
  return rows;
}

/** Record (or refresh) a link after a successful import. */
export async function saveLink({ customerId, provider, externalId, externalName, locationId, userId }) {
  const { rows } = await query(
    `INSERT INTO customer_integration_links
       (customer_id, provider, external_id, external_name, location_id, created_by, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (customer_id, provider, external_id) DO UPDATE
       SET external_name  = COALESCE(EXCLUDED.external_name, customer_integration_links.external_name),
           location_id    = EXCLUDED.location_id,
           last_synced_at = NOW()
     RETURNING *`,
    [customerId, provider, String(externalId), externalName || null, locationId || null, userId || null]
  );
  return rows[0];
}

/** Customers linked to one outside record (e.g. "this UniFi console is already Smith Dental"). */
export async function customersLinkedTo(provider) {
  const { rows } = await query(
    `SELECT l.external_id, c.id AS customer_id, c.name AS customer_name
       FROM customer_integration_links l JOIN customers c ON c.id = l.customer_id
      WHERE l.provider = $1`,
    [provider]
  );
  const byId = new Map();
  for (const r of rows) (byId.get(r.external_id) ?? byId.set(r.external_id, []).get(r.external_id)).push({ id: r.customer_id, name: r.customer_name });
  return byId;
}
