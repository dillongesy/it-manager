import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { inventoryApi } from '../api/inventory.js';
import Modal from '../components/Modal.jsx';

const num = (v) => (v == null ? null : Number(v));

export default function InventoryItem() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null); // 'receive' | 'checkout' | 'adjust' | 'edit'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.get(id);
      setItem(res.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const del = async () => {
    const hasHistory = (item?.transactions?.length || 0) > 0;
    const msg = hasHistory
      ? `Delete "${item.name}"? It has stock history, so it will be archived (hidden from inventory) to keep the ledger intact. Continue?`
      : `Permanently delete "${item.name}"? This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      await inventoryApi.remove(id);
      navigate('/inventory');
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed.');
    }
  };

  if (loading) return <p className="text-gray-500 text-center py-8">Loading…</p>;
  if (!item) return <p className="text-gray-500 text-center py-8">Item not found.</p>;

  const isLow = num(item.low_stock_threshold) != null && num(item.quantity) <= num(item.low_stock_threshold);
  const txns = item.transactions || [];
  const usage = item.usage || [];

  return (
    <div className="p-4 space-y-4">
      <button onClick={() => navigate('/inventory')} className="text-gray-500 text-sm">← Inventory</button>

      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{item.name}</h1>
            <div className="text-xs text-gray-500 mt-1">{item.sku}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-3xl font-bold ${isLow ? 'text-brand' : ''}`}>{num(item.quantity)}</div>
            <div className="text-[10px] text-gray-500 uppercase">{item.unit || 'in stock'}</div>
          </div>
        </div>
        {item.description && <p className="text-gray-400 text-sm mt-3">{item.description}</p>}
        <dl className="grid grid-cols-2 gap-2 mt-4 text-sm">
          <Field label="Category" value={item.category} />
          <Field label="Low-stock at" value={num(item.low_stock_threshold)} />
          <Field label="Cost/unit" value={item.cost_per_unit != null ? `$${num(item.cost_per_unit)}` : null} />
          <Field label="Mfr. barcode" value={item.manufacturer_barcode} />
        </dl>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setAction('receive')} className="bg-green-700 hover:bg-green-600 text-white font-semibold rounded-xl py-3 text-sm active:scale-95">Add stock</button>
        <button onClick={() => setAction('checkout')} className="btn-primary py-3 text-sm">Take out</button>
        <button onClick={() => setAction('adjust')} className="btn-secondary py-3 text-sm">Correct count</button>
      </div>
      <div className="flex items-center justify-between">
        <button onClick={() => setAction('edit')} className="text-accent text-sm">Edit details</button>
        <button onClick={del} className="text-brand text-sm">Delete item</button>
      </div>

      <div>
        <h2 className="text-sm uppercase text-gray-500 mb-2">Where it's used</h2>
        {usage.length === 0 ? (
          <p className="text-gray-500 text-sm">Not used on any job yet.</p>
        ) : (
          <div className="space-y-2">
            {usage.map((u) => (
              <button
                key={`${u.job_id}-${u.number}`}
                onClick={() => navigate(`/work-orders/${u.job_id}`)}
                className="card p-3 w-full text-left flex items-center justify-between text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium truncate">{u.customer_name || `Job #${u.number}`}</span>
                  <div className="text-xs text-gray-500 mt-0.5">
                    #{u.number}
                    {u.work_date && <> · {new Date(u.work_date).toLocaleDateString()}</>}
                    {u.customer_address && <> · {u.customer_address}</>}
                  </div>
                </div>
                <span className="text-gray-400 shrink-0">×{num(u.quantity)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm uppercase text-gray-500 mb-2">History</h2>
        {txns.length === 0 ? (
          <p className="text-gray-500 text-sm">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {txns.map((t) => (
              <div key={t.id} className="card p-3 flex items-center justify-between text-sm">
                <div>
                  <span className="capitalize font-medium">{t.type}</span>
                  {t.notes && <span className="text-gray-500"> · {t.notes}</span>}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.user_name || '—'} · {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={num(t.quantity_delta) >= 0 ? 'text-green-400' : 'text-brand'}>
                    {num(t.quantity_delta) >= 0 ? '+' : ''}{num(t.quantity_delta)}
                  </span>
                  <div className="text-xs text-gray-500">→ {num(t.quantity_after)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {action && action !== 'edit' && (
        <StockActionModal
          type={action}
          current={num(item.quantity)}
          onClose={() => setAction(null)}
          onSubmit={async ({ amount, notes }) => {
            if (action === 'receive') await inventoryApi.receive(id, { quantity: amount, notes });
            else if (action === 'checkout') await inventoryApi.checkout(id, { quantity: amount, notes });
            else await inventoryApi.adjust(id, { new_quantity: amount, notes });
            setAction(null);
            await load();
          }}
        />
      )}

      {action === 'edit' && (
        <EditItemModal
          item={item}
          onClose={() => setAction(null)}
          onSubmit={async (payload) => { await inventoryApi.update(id, payload); setAction(null); await load(); }}
        />
      )}
    </div>
  );
}

function Field({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <dt className="text-gray-500 text-xs">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StockActionModal({ type, current, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const titles = { receive: 'Add stock', checkout: 'Take stock out', adjust: 'Correct the count' };
  const labels = {
    receive: 'How many are you adding?',
    checkout: 'How many are you taking out?',
    adjust: `What should the count be? (it's ${current} now)`,
  };
  const hints = {
    receive: 'Use this when new stock comes in.',
    checkout: 'Use this when stock is used or leaves the shelf.',
    adjust: 'Use this to fix a miscount — sets the number directly.',
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({ amount: Number(amount), notes });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={titles[type]} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-brand text-sm">{error}</p>}
        <Labeled label={labels[type]} hint={hints[type]}>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={type === 'adjust' ? 0 : 1}
            autoFocus
            required
          />
        </Labeled>
        <Labeled label="Note" hint="Optional — e.g. the job or reason.">
          <input className="input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Labeled>
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Confirm'}</button>
      </form>
    </Modal>
  );
}

function EditItemModal({ item, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: item.name || '',
    description: item.description || '',
    category: item.category || '',
    unit: item.unit || '',
    low_stock_threshold: item.low_stock_threshold ?? '',
    manufacturer_barcode: item.manufacturer_barcode || '',
    cost_per_unit: item.cost_per_unit ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        ...form,
        low_stock_threshold: form.low_stock_threshold === '' ? null : Number(form.low_stock_threshold),
        cost_per_unit: form.cost_per_unit === '' ? null : Number(form.cost_per_unit),
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit item" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-brand text-sm">{error}</p>}
        <p className="text-xs text-gray-500">To change the quantity, use Add / Take out / Correct the count on the item — not here.</p>
        <Labeled label="Name" required><input className="input" value={form.name} onChange={set('name')} required /></Labeled>
        <Labeled label="Category" hint="Group similar items together for filtering."><input className="input" value={form.category} onChange={set('category')} placeholder="e.g. Cameras, Cable, Mounts" /></Labeled>
        <Labeled label="Counted in" hint="The unit you count by."><input className="input" value={form.unit} onChange={set('unit')} placeholder="ea, box, ft, roll" /></Labeled>
        <Labeled label="Warn me when it drops to" hint="You'll see a low-stock flag at or below this number. Leave blank for no warning."><input className="input" type="number" inputMode="numeric" min="0" value={form.low_stock_threshold} onChange={set('low_stock_threshold')} placeholder="e.g. 5" /></Labeled>
        <Labeled label="Cost per unit" hint="What we pay for one unit. Leave blank if unsure.">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input className="input pl-7" type="number" inputMode="decimal" step="0.01" min="0" value={form.cost_per_unit} onChange={set('cost_per_unit')} placeholder="0.00" />
          </div>
        </Labeled>
        <Labeled label="Manufacturer barcode" hint="The maker's barcode (UPC) for lookups."><input className="input" value={form.manufacturer_barcode} onChange={set('manufacturer_barcode')} placeholder="Scan or type" /></Labeled>
        <Labeled label="Description" hint="Any extra notes about the item."><textarea className="input" rows={2} value={form.description} onChange={set('description')} /></Labeled>
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  );
}

function Labeled({ label, hint, required, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">
        {label}{required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
