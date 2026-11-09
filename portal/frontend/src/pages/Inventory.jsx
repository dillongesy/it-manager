import { useState, useEffect, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Package, Search, AlertTriangle, X, Minus, Plus, History, Pencil, Trash2 } from 'lucide-react';
import { inventoryApi } from '../api/inventory.js';
import { MODAL_OVERLAY, MODAL_PANEL } from '../components/ui/Modal.jsx';

const num = (v) => (v == null ? null : Number(v));

export function Inventory() {
  const [sp] = useSearchParams();
  // The Order Log used to be a tab here — old bookmarks land on its new page.
  if (sp.get('tab') === 'orders') return <Navigate to="/orders" replace />;

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-surface-700 flex items-center justify-center shrink-0">
          <Package size={18} className="text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Inventory</h1>
          <p className="text-gray-500 text-xs">Shared stock (Field App)</p>
        </div>
      </div>

      <InventoryTab />
    </div>
  );
}

// ─── Inventory tab (existing content, unchanged) ─────────────────────────────

function InventoryTab() {
  const [items, setItems]           = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch]         = useState('');
  const [category, setCategory]     = useState('');
  const [lowStock, setLowStock]     = useState(false);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [notConfigured, setNotConfigured] = useState(false);
  const [selected, setSelected]     = useState(null);
  const [creating, setCreating]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search) params.search = search;
      if (category) params.category = category;
      if (lowStock) params.lowStock = 'true';
      const { data } = await inventoryApi.list(params);
      setItems(data);
    } catch (err) {
      if (err.response?.status === 503) setNotConfigured(true);
      else setError(err.response?.data?.error ?? 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [search, category, lowStock]);

  const reloadCategories = useCallback(() => {
    inventoryApi.categories().then(({ data }) => setCategories(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => { reloadCategories(); }, [reloadCategories]);

  const isLow = (it) => num(it.low_stock_threshold) != null && num(it.quantity) <= num(it.low_stock_threshold);

  if (notConfigured) {
    return (
      <div className="card p-6 text-gray-400 max-w-xl">
        <p className="text-gray-200 font-medium mb-1">Inventory bridge not configured</p>
        <p className="text-sm">
          Shared inventory lives in the Field App. To enable it here, set
          <code className="mx-1 text-accent">FIELD_API_URL</code> and
          <code className="mx-1 text-accent">FIELD_API_TOKEN</code> in the Portal backend's
          <code className="mx-1">.env</code>, then restart the Portal backend.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input pl-9" placeholder="Search name, SKU…" value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setLowStock((v) => !v)}
            className={`badge gap-1.5 px-3 py-2 ${lowStock ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400'}`}>
            <AlertTriangle size={13} /> Low stock
          </button>
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus size={15} /> New Item
        </button>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-3 mb-4">{error}</p>}

      {loading ? (
        <p className="text-gray-500 py-8 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No items found.</p>
      ) : (
        <div className="card divide-y divide-surface-600">
          {items.map((it) => (
            <button key={it.id} onClick={() => setSelected(it)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-700 transition-colors text-left">
              <div className="min-w-0">
                <p className="text-gray-200 font-medium truncate">{it.name}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {it.sku}{it.category ? ` · ${it.category}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className={`font-semibold ${isLow(it) ? 'text-brand' : 'text-gray-200'}`}>
                  {num(it.quantity)}
                </span>
                <span className="text-gray-500 text-xs ml-1">{it.unit || 'ea'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ItemModal itemId={selected.id} onClose={() => setSelected(null)}
          onChanged={() => { load(); reloadCategories(); }} />
      )}
      {creating && (
        <ItemFormModal onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); reloadCategories(); }} />
      )}
    </div>
  );
}

// ─── Create / edit form ──────────────────────────────────────────────────────

const BLANK = { name: '', description: '', category: '', manufacturer_barcode: '',
  unit: 'ea', low_stock_threshold: '5', cost_per_unit: '', notes: '' };

function ItemFormModal({ item, onClose, onSaved }) {
  const editing = !!item;
  const [form, setForm] = useState(editing
    ? {
        name: item.name ?? '', description: item.description ?? '', category: item.category ?? '',
        manufacturer_barcode: item.manufacturer_barcode ?? '', unit: item.unit ?? 'ea',
        low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '',
        cost_per_unit: item.cost_per_unit != null ? String(item.cost_per_unit) : '', notes: item.notes ?? '',
      }
    : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || null,
      manufacturer_barcode: form.manufacturer_barcode || null,
      unit: form.unit || 'ea',
      low_stock_threshold: form.low_stock_threshold === '' ? null : Number(form.low_stock_threshold),
      cost_per_unit: form.cost_per_unit === '' ? null : Number(form.cost_per_unit),
      notes: form.notes || null,
    };
    try {
      if (editing) await inventoryApi.update(item.id, payload);
      else         await inventoryApi.create(payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Save failed.');
    } finally { setSaving(false); }
  };

  return (
    <div className={`${MODAL_OVERLAY} bg-black/60 backdrop-blur-xs`}>
      <form onSubmit={submit} className={`${MODAL_PANEL} max-w-lg`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <h3 className="text-gray-100 font-semibold">{editing ? 'Edit item' : 'New inventory item'}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name *</label>
            <input className="input" value={form.name} onChange={set('name')} autoFocus placeholder="e.g. Cat6 patch cable, 3ft" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
            <input className="input" value={form.description} onChange={set('description')} placeholder="Optional details" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
              <input className="input" value={form.category} onChange={set('category')} placeholder="e.g. Cabling" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Unit</label>
              <input className="input" value={form.unit} onChange={set('unit')} placeholder="ea" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Low-stock warning at</label>
              <input className="input" type="number" min="0" step="1" value={form.low_stock_threshold}
                onChange={set('low_stock_threshold')} onWheel={(e) => e.currentTarget.blur()} placeholder="5" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Cost per unit</label>
              <input className="input" type="number" min="0" step="0.01" value={form.cost_per_unit}
                onChange={set('cost_per_unit')} onWheel={(e) => e.currentTarget.blur()} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Manufacturer barcode <span className="text-gray-600">(optional)</span></label>
            <input className="input" value={form.manufacturer_barcode} onChange={set('manufacturer_barcode')} placeholder="Scan or type the printed barcode" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          {!editing && <p className="text-gray-600 text-xs">A SKU is assigned automatically. Set the starting count with "Receive" after creating.</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-600">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Item detail (stock actions + ledger) ────────────────────────────────────

function ItemModal({ itemId, onClose, onChanged }) {
  const [item, setItem]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [editing, setEditing] = useState(false);
  const [mode, setMode]       = useState('use');
  const [qty, setQty]         = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await inventoryApi.get(itemId);
      setItem(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to load item.');
    } finally { setLoading(false); }
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  const num2 = (v) => (v == null ? null : Number(v));

  const runAction = async (e) => {
    e.preventDefault();
    setError('');
    const n = Number(qty);
    if (mode === 'adjust') {
      if (qty === '' || isNaN(n) || n < 0) { setError('Enter the new on-hand count (0 or more).'); return; }
    } else if (!n || n <= 0) {
      setError('Enter a quantity greater than 0.'); return;
    }
    setSaving(true);
    try {
      if (mode === 'use')          await inventoryApi.checkout(itemId, { quantity: n, notes });
      else if (mode === 'receive') await inventoryApi.receive(itemId, { quantity: n, notes });
      else                         await inventoryApi.adjust(itemId, { new_quantity: n, notes });
      setQty(''); setNotes('');
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Action failed.');
    } finally { setSaving(false); }
  };

  const del = async () => {
    const hasHistory = (item?.transactions?.length || 0) > 0;
    const msg = hasHistory
      ? `Delete "${item.name}"? It has stock history, so it will be archived (hidden from inventory) to keep the ledger intact. Continue?`
      : `Permanently delete "${item.name}"? This can't be undone.`;
    if (!confirm(msg)) return;
    setSaving(true);
    setError('');
    try {
      await inventoryApi.remove(itemId);
      onChanged();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Delete failed.');
      setSaving(false);
    }
  };

  const MODES = [
    { id: 'use',     label: 'Use',          icon: Minus,   color: 'text-brand'   },
    { id: 'receive', label: 'Receive',      icon: Plus,    color: 'text-green-400' },
    { id: 'adjust',  label: 'Correct count',icon: History, color: 'text-blue-400'  },
  ];

  if (editing && item) {
    return <ItemFormModal item={item} onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); load(); onChanged(); }} />;
  }

  return (
    <div className={`${MODAL_OVERLAY} bg-black/60 backdrop-blur-xs`}>
      <div className={`${MODAL_PANEL} max-w-lg`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <h3 className="text-gray-100 font-semibold">{item?.name ?? 'Item'}</h3>
          <div className="flex items-center gap-1">
            {item && (
              <>
                <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-200 p-1" title="Edit item">
                  <Pencil size={15} />
                </button>
                <button onClick={del} disabled={saving} className="text-gray-500 hover:text-red-400 p-1" title="Delete item">
                  <Trash2 size={15} />
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1"><X size={16} /></button>
          </div>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          {loading ? (
            <p className="text-gray-500 py-4 text-center">Loading…</p>
          ) : !item ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <p className="text-gray-500 text-xs">{item.sku}{item.category ? ` · ${item.category}` : ''}</p>
                  {item.description && <p className="text-gray-400 text-sm mt-1">{item.description}</p>}
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-gray-100">{num2(item.quantity)}</span>
                  <span className="text-gray-500 text-sm ml-1">{item.unit || 'ea'}</span>
                </div>
              </div>

              <div className="bg-surface-700/50 rounded-lg p-3 mb-4">
                <div className="flex gap-1 mb-3">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => { setMode(m.id); setError(''); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                        mode === m.id ? 'bg-surface-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'
                      }`}>
                      <m.icon size={13} className={m.color} /> {m.label}
                    </button>
                  ))}
                </div>
                {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
                <form onSubmit={runAction} className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input className="input w-28" type="number" min="0" step="any"
                    placeholder={mode === 'adjust' ? 'New count' : 'Qty'}
                    value={qty} onChange={(e) => setQty(e.target.value)} />
                  <input className="input flex-1 min-w-0 basis-full sm:basis-0 order-last sm:order-none" placeholder="Note (optional) — e.g. job/customer/reason"
                    value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <button type="submit" disabled={saving} className="btn-primary shrink-0">
                    {saving ? '…' : mode === 'use' ? 'Use' : mode === 'receive' ? 'Add' : 'Set'}
                  </button>
                </form>
              </div>

              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <History size={12} /> Recent activity
              </p>
              {item.transactions?.length ? (
                <div className="space-y-1.5">
                  {item.transactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <span className="capitalize text-gray-300">{t.type}</span>
                        {t.notes && <span className="text-gray-500"> · {t.notes}</span>}
                        <span className="text-gray-600 text-xs block">
                          {t.user_name || '—'} · {new Date(t.created_at).toLocaleString()}
                        </span>
                      </div>
                      <span className={num2(t.quantity_delta) >= 0 ? 'text-green-400' : 'text-brand'}>
                        {num2(t.quantity_delta) >= 0 ? '+' : ''}{num2(t.quantity_delta)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-sm">No activity yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
