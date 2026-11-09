import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ScanLine } from 'lucide-react';
import { inventoryApi } from '../api/inventory.js';
import BarcodeScanner from '../components/BarcodeScanner.jsx';

export default function InventoryNew() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    quantity: '',
    unit: '',
    low_stock_threshold: '',
    manufacturer_barcode: '',
    cost_per_unit: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await inventoryApi.create({
        name: form.name,
        description: form.description,
        category: form.category,
        unit: form.unit || undefined,
        manufacturer_barcode: form.manufacturer_barcode,
        low_stock_threshold: form.low_stock_threshold === '' ? undefined : Number(form.low_stock_threshold),
        cost_per_unit: form.cost_per_unit === '' ? undefined : Number(form.cost_per_unit),
      });
      const item = res.data;
      // New items start at 0; receive the opening stock so it lands in the ledger.
      const opening = Number(form.quantity);
      if (opening > 0) {
        await inventoryApi.receive(item.id, { quantity: opening, notes: 'Opening stock' });
      }
      navigate(`/inventory/${item.id}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create item');
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <button onClick={() => navigate('/inventory')} className="text-gray-500 text-sm">← Inventory</button>
      <h1 className="text-2xl font-bold">New item</h1>

      <form onSubmit={submit} className="space-y-6">
        {error && <p className="text-brand text-sm">{error}</p>}

        {/* --- Basics ------------------------------- */}
        <Section title="Basics">
          <Labeled label="Name" required>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. 4MP Dome Camera" autoFocus required />
          </Labeled>
          <Labeled label="Category" hint="Group similar items together for filtering.">
            <input className="input" value={form.category} onChange={set('category')} placeholder="e.g. Cameras, Cable, Mounts" />
          </Labeled>
        </Section>

        {/* --- Stock -------------------------------- */}
        <Section title="Stock">
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="How many do you have now?" hint="The amount on hand today.">
              <input className="input" type="number" inputMode="numeric" min="0" value={form.quantity} onChange={set('quantity')} placeholder="0" />
            </Labeled>
            <Labeled label="Counted in" hint="The unit you count by.">
              <input className="input" value={form.unit} onChange={set('unit')} placeholder="ea, box, ft, roll" />
            </Labeled>
          </div>
          <Labeled label="Warn me when it drops to" hint="You'll see a low-stock flag at or below this number. Leave blank for no warning.">
            <input className="input" type="number" inputMode="numeric" min="0" value={form.low_stock_threshold} onChange={set('low_stock_threshold')} placeholder="e.g. 5" />
          </Labeled>
        </Section>

        {/* --- Optional details --------------------- */}
        <Section title="Optional details">
          <Labeled label="Description" hint="Any extra notes about the item.">
            <textarea className="input" rows={2} value={form.description} onChange={set('description')} />
          </Labeled>
          <Labeled label="Cost per unit" hint="What we pay for one unit. Used for inventory value — leave blank if unsure.">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input className="input pl-7" type="number" inputMode="decimal" step="0.01" min="0" value={form.cost_per_unit} onChange={set('cost_per_unit')} placeholder="0.00" />
            </div>
          </Labeled>
          <Labeled label="Manufacturer barcode" hint="Scan the maker's barcode (UPC) so you can look the item up later. A SKU barcode is also generated automatically.">
            <div className="flex gap-2">
              <input className="input flex-1" value={form.manufacturer_barcode} onChange={set('manufacturer_barcode')} placeholder="Scan or type" />
              <button type="button" onClick={() => setScanning(true)} className="btn-secondary shrink-0 px-4 flex items-center justify-center" aria-label="Scan barcode"><ScanLine size={20} /></button>
            </div>
          </Labeled>
        </Section>

        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Creating…' : 'Create item'}</button>
      </form>

      {scanning && (
        <BarcodeScanner
          onScan={(code) => { setForm((f) => ({ ...f, manufacturer_barcode: code })); setScanning(false); }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-surface-600 pb-1">{title}</h2>
      {children}
    </div>
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
