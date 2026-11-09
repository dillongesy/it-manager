import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from '../api/inventory.js';

/**
 * Work-order line items. Add from inventory (type-ahead search, links the
 * inventory item) or enter a manual line. Each item:
 *   { inventory_item_id, sku, description, quantity, unit_price }
 * Picking from inventory prefills unit_price from the item's cost (editable).
 *
 * value:    array of line items
 * onChange: (next array) => void
 */
export default function LineItemsPicker({ value = [], onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await inventoryApi.list({ search: query, limit: 8 });
        setResults(res.data || []);
        setOpen(true);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const addFromInventory = (it) => {
    onChange([...value, {
      inventory_item_id: it.id, sku: it.sku, description: it.name, quantity: 1,
      unit_price: it.cost_per_unit != null ? Number(it.cost_per_unit) : '',
    }]);
    setQuery(''); setResults([]); setOpen(false);
  };

  const addManual = () => {
    if (!query.trim()) return;
    onChange([...value, { inventory_item_id: null, sku: null, description: query.trim(), quantity: 1, unit_price: '' }]);
    setQuery(''); setResults([]); setOpen(false);
  };

  // Keep the raw value while typing so the pre-filled "1" can be cleared.
  const setQty = (idx, qty) =>
    onChange(value.map((it, i) => (i === idx ? { ...it, quantity: qty } : it)));

  // Empty/invalid → default back to 1 once the field loses focus.
  const normalizeQty = (idx) =>
    onChange(value.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, Number(it.quantity) || 1) } : it)));

  const setPrice = (idx, price) =>
    onChange(value.map((it, i) => (i === idx ? { ...it, unit_price: price } : it)));

  const remove = (idx) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((it, i) => (
            <div key={i} className="bg-surface-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{it.description || it.item_name}</div>
                  {it.sku && <div className="text-xs text-gray-500">{it.sku}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-gray-500 hover:text-brand text-xl leading-none shrink-0"
                  aria-label="Remove line item"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-500">
                  Qty
                  <input
                    type="number" inputMode="numeric" min={1} value={it.quantity}
                    onChange={(e) => setQty(i, e.target.value)}
                    onBlur={() => normalizeQty(i)}
                    className="input w-16 text-center"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500 flex-1">
                  $/ea
                  <input
                    type="number" inputMode="decimal" step="0.01" min={0}
                    value={it.unit_price ?? ''} placeholder="—"
                    onChange={(e) => setPrice(i, e.target.value)}
                    className="input flex-1"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative" ref={boxRef}>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
            placeholder="Search inventory or type item…"
            className="input flex-1"
          />
          <button type="button" onClick={addManual} className="btn-secondary shrink-0">Add</button>
        </div>

        {open && results.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
            {results.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => addFromInventory(it)}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-700 border-b border-surface-600 last:border-0"
              >
                <div className="text-sm">{it.name}</div>
                <div className="text-xs text-gray-500">{it.sku} · {it.quantity} in stock</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
