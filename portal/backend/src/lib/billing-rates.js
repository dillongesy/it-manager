// Default hourly billing rates (Admin → Billing).
//
// New customers are seeded with a copy of these rates, in order. Each customer's copy
// can then be renamed or re-priced independently. The first default rate is the one a
// new work order uses when the customer has a rate with the same label.
import { getSetting, setSetting } from './settings.js';

const SETTING_KEY = 'billing:default_rates';

export const RATE_DEFAULTS = Object.freeze([
  Object.freeze({ label: 'Standard', rate: 90 }),
  Object.freeze({ label: 'Tech', rate: 70 }),
]);

export const RATE_LIMITS = Object.freeze({ maxRates: 10, maxLabel: 100, maxRate: 100000 });

const fail = (message) => { const e = new Error(message); e.status = 400; throw e; };

/** Validate and normalize a list of `{ label, rate }`. Throws a 400 error on bad input. */
export function sanitizeRates(input) {
  if (!Array.isArray(input) || input.length === 0) fail('At least one default rate is required.');
  if (input.length > RATE_LIMITS.maxRates) fail(`At most ${RATE_LIMITS.maxRates} default rates are allowed.`);

  const seen = new Set();
  return input.map((item, i) => {
    const label = String(item?.label ?? '').trim();
    if (!label) fail(`Rate ${i + 1} needs a name.`);
    if (label.length > RATE_LIMITS.maxLabel) fail(`Rate names are limited to ${RATE_LIMITS.maxLabel} characters.`);
    const key = label.toLowerCase();
    if (seen.has(key)) fail(`"${label}" is listed more than once.`);
    seen.add(key);

    const rate = Number(item?.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > RATE_LIMITS.maxRate) {
      fail(`"${label}" needs an hourly rate between 0 and ${RATE_LIMITS.maxRate}.`);
    }
    return { label, rate: Math.round(rate * 100) / 100 };
  });
}

export async function getDefaultRates() {
  const stored = await getSetting(SETTING_KEY, null);
  try {
    return stored ? sanitizeRates(stored) : RATE_DEFAULTS.map(r => ({ ...r }));
  } catch {
    return RATE_DEFAULTS.map(r => ({ ...r }));
  }
}

/**
 * Price changes to carry over to existing customers: one entry per default rate whose
 * label is unchanged but whose price moved. Renamed, added or removed rates are not
 * carried over; customers keep what they have.
 */
export function priceChanges(before, after) {
  const old = new Map(before.map(r => [r.label.toLowerCase(), r.rate]));
  return after
    .filter(r => old.has(r.label.toLowerCase()) && old.get(r.label.toLowerCase()) !== r.rate)
    .map(r => ({ label: r.label, from: old.get(r.label.toLowerCase()), to: r.rate }));
}

/**
 * Save the defaults. With `applyToExisting`, customers still on a changed rate's old
 * price get the new one; customers with a negotiated price are left alone.
 * @returns {{ rates: object[], changes: object[], customersUpdated: number }}
 */
export async function saveDefaultRates(input, { applyToExisting = false, userId = null, client }) {
  const rates = sanitizeRates(input);
  const changes = priceChanges(await getDefaultRates(), rates);
  await setSetting(SETTING_KEY, rates, userId, client);

  let customersUpdated = 0;
  if (applyToExisting) {
    for (const c of changes) {
      const { rowCount } = await client.query(
        `UPDATE customer_billing_rates SET rate = $1
          WHERE LOWER(label) = LOWER($2) AND rate = $3`,
        [c.to, c.label, c.from]
      );
      customersUpdated += rowCount;
    }
  }
  return { rates, changes, customersUpdated };
}

/** Seed a new customer with the default rates, in order. */
export async function seedCustomerRates(db, customerId) {
  const rates = await getDefaultRates();
  for (const [i, { label, rate }] of rates.entries()) {
    await db.query(
      'INSERT INTO customer_billing_rates (customer_id, label, rate, sort_order) VALUES ($1, $2, $3, $4)',
      [customerId, label, rate, (i + 1) * 10]
    );
  }
}

/**
 * The rate a new work order starts with: the customer's rate named like the first
 * default rate, otherwise the customer's first rate. Null when the customer has none.
 */
export async function findDefaultRateId(db, customerId) {
  const [primary] = await getDefaultRates();
  const { rows } = await db.query(
    `SELECT id FROM customer_billing_rates
      WHERE customer_id = $1
      ORDER BY (LOWER(label) = LOWER($2)) DESC, sort_order, created_at
      LIMIT 1`,
    [customerId, primary?.label ?? '']
  );
  return rows[0]?.id ?? null;
}
