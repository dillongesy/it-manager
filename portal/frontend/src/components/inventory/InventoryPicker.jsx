import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { inventoryApi } from '../../api/inventory.js';

/**
 * Search shared (Field App) inventory and pick one item.
 *
 * Props:
 *   value     – the chosen item ({ id, name, sku, quantity, unit }) or null
 *   onChange  – called with the chosen item, or null when cleared
 *   placeholder
 *
 * Uses the bridge's token search, so "u6 pro" finds "UniFi U6 Pro".
 */
export function InventoryPicker({ value, onChange, placeholder = 'Search inventory…' }) {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await inventoryApi.list(q.trim() ? { search: q.trim() } : {});
        if (!cancelled) setResults(data.slice(0, 25));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-surface-700 border border-surface-500 rounded-md px-3 py-1.5 text-sm">
        <span className="flex-1 min-w-0 truncate text-gray-200">
          {value.name} <span className="text-gray-500 text-xs">{value.sku}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-gray-500 hover:text-red-400 shrink-0 p-1" title="Clear">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      <input className="input pl-9 text-sm" value={q} placeholder={placeholder}
        onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }}
        autoComplete="off" data-1p-ignore data-lpignore="true" />
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface-800 border border-surface-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {loading && !results.length ? (
            <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
          ) : !results.length ? (
            <p className="px-3 py-2 text-xs text-gray-500">No inventory items match.</p>
          ) : results.map(it => (
            <button key={it.id} type="button"
              onClick={() => { onChange({ id: it.id, name: it.name, sku: it.sku, quantity: Number(it.quantity), unit: it.unit }); setOpen(false); setQ(''); }}
              className="w-full text-left px-3 py-2 hover:bg-surface-700 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm text-gray-200 truncate">{it.name}</span>
                <span className="block text-xs text-gray-500">{it.sku}{it.category ? ` · ${it.category}` : ''}</span>
              </span>
              <span className="text-xs text-gray-400 shrink-0">{Number(it.quantity)} {it.unit || 'ea'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
