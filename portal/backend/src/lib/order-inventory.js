// Matching Order Log lines to shared (Field App) inventory items, and planning the
// "Add to inventory" action.
//
// The rule the office asked for: an order line is only received into inventory when
// it MATCHES an item that already exists there. A mixed order (a switch for stock +
// a one-off laptop for a customer) receives only the lines that match; the rest are
// treated as non-inventory purchases and left alone. Nothing is ever auto-created in
// inventory — a guessed new item would be worse than a line the office links by hand.
//
// Match order, strongest first:
//   1. the line was already linked to an item (by a previous run or by hand)
//   2. SKU / part # equals the item's inventory SKU or its manufacturer barcode
//   3. item name equals the inventory item's name — only when exactly ONE item has
//      that name; two same-named items are never guessed between
// All comparisons are case- and whitespace-insensitive.

export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const summarize = (it) => ({
  id: it.id, name: it.name, sku: it.sku ?? null,
  quantity: it.quantity != null ? Number(it.quantity) : null, unit: it.unit || 'ea',
});

/**
 * Find the inventory item an order line belongs to.
 * @returns {{ item, by } | { item: null, candidates: [] }}
 */
export function matchLine(line, inventory) {
  const items = (inventory ?? []).filter(Boolean);

  if (line.inventory_item_id) {
    const linked = items.find(it => it.id === line.inventory_item_id);
    if (linked) return { item: linked, by: 'linked' };
    // The linked item was archived/deleted — fall through and try to re-match.
  }

  const sku = norm(line.sku);
  if (sku) {
    const bySku = items.filter(it => norm(it.sku) === sku || norm(it.manufacturer_barcode) === sku);
    if (bySku.length === 1) return { item: bySku[0], by: 'sku' };
    if (bySku.length > 1) return { item: null, candidates: bySku.map(summarize) };
  }

  const name = norm(line.item_name);
  if (name) {
    const byName = items.filter(it => norm(it.name) === name);
    if (byName.length === 1) return { item: byName[0], by: 'name' };
    if (byName.length > 1) return { item: null, candidates: byName.map(summarize) };
  }

  return { item: null, candidates: [] };
}

// Quantity to receive: a positive number, else nothing to receive.
export function receiveQty(q) {
  const n = parseFloat(q);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Plan the "Add to inventory" action for one order.
 *
 * @param items     the order's items[] (JSONB lines)
 * @param inventory active Field inventory items
 * @param links     optional { [lineIndex]: inventoryItemId | 'skip' } — the user's
 *                  manual choices from the preview (link an unmatched line to an
 *                  item, or leave a matched line out)
 * @returns [{ index, item_name, sku, quantity, state, by, match, candidates }]
 *   state: 'added'     — already received on an earlier run (never received twice)
 *          'receive'   — matched; will be received
 *          'skipped'   — matched, but the user chose to leave it out
 *          'unmatched' — no inventory item (a non-inventory line)
 *          'ambiguous' — several items fit; the user must pick one
 *          'bad_qty'   — matched, but the quantity is zero/blank
 */
export function planInventoryAdd(items, inventory, links = {}) {
  return (items ?? []).map((line, index) => {
    const base = {
      index,
      item_name: line.item_name ?? '',
      sku: line.sku ?? null,
      quantity: line.quantity ?? null,
    };

    if (line.added_at) {
      return {
        ...base, state: 'added', by: 'linked',
        match: line.inventory_item_id
          ? { id: line.inventory_item_id, name: line.inventory_name ?? null, sku: line.inventory_sku ?? null }
          : null,
        added_qty: line.added_qty ?? null, added_at: line.added_at,
      };
    }

    const choice = links?.[index] ?? links?.[String(index)];
    let result;
    if (choice && choice !== 'skip') {
      const picked = (inventory ?? []).find(it => it.id === choice);
      result = picked ? { item: picked, by: 'manual' } : matchLine(line, inventory);
    } else {
      result = matchLine(line, inventory);
    }

    if (!result.item) {
      return {
        ...base, state: result.candidates?.length ? 'ambiguous' : 'unmatched',
        by: null, match: null, candidates: result.candidates ?? [],
      };
    }
    const match = summarize(result.item);
    if (choice === 'skip') return { ...base, state: 'skipped', by: result.by, match };
    if (receiveQty(line.quantity) == null) return { ...base, state: 'bad_qty', by: result.by, match };
    return { ...base, state: 'receive', by: result.by, match };
  });
}

// The Field ledger note for a receive, so a stock movement traces back to its order.
export function receiveNote(order) {
  const bits = [`Order from ${order.vendor || 'vendor'}`];
  if (order.po_number) bits.push(`PO ${order.po_number}`);
  return bits.join(' · ');
}
