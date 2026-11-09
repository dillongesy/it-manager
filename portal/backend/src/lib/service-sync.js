// Shared math for recurring-charge line totals and for rolling a service-catalog
// price change out to the customer charges linked to that service.
//
// A recurring charge stores quantity × unit_price and a derived `amount` (the line
// total). When the catalog price of a service changes - Microsoft 365 goes from
// $35 to $38 - every ACTIVE charge linked to that service has to move with it, or
// the Billing tab quietly keeps billing last year's price.

// Money coercion: '' / null / garbage → null, so a blank price stays blank.
export function coerceMoney(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Quantity defaults to 1 (a flat charge is 1 × its unit price).
export function coerceQty(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

// Derived line total, rounded to cents. Null when there's no unit price yet.
export function lineTotal(quantity, unitPrice) {
  if (unitPrice == null) return null;
  return Math.round(coerceQty(quantity) * unitPrice * 100) / 100;
}

/**
 * Work out which linked charges actually need re-pricing.
 *
 * @param charges  rows of { id, description, quantity, unit_price, amount, is_active }
 * @param newPrice the catalog's new unit price (null = price cleared → no sync)
 * @returns [{ id, description, quantity, from, to, amountFrom, amountTo }]
 *
 * Rules:
 *  - Inactive charges are skipped. They're kept as history and excluded from every
 *    total; silently re-pricing a discontinued line would rewrite the record.
 *  - A charge already at the new price is skipped, so a no-op edit writes no audit
 *    entries and reports "0 updated".
 *  - Quantity is never touched - seat counts are per-customer, the price is not.
 */
export function priceSyncPlan(charges, newPrice) {
  const to = coerceMoney(newPrice);
  if (to == null) return [];
  return (charges ?? [])
    .filter(c => c.is_active !== false)
    .map(c => {
      const from = coerceMoney(c.unit_price);
      const qty = coerceQty(c.quantity);
      return {
        id: c.id,
        description: c.description,
        quantity: qty,
        from,
        to,
        amountFrom: coerceMoney(c.amount),
        amountTo: lineTotal(qty, to),
      };
    })
    .filter(p => p.from !== p.to);
}
