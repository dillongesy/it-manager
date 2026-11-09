import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Tags, Search } from 'lucide-react';
import { serviceCatalogApi } from '../api/serviceCatalog.js';
import { Modal } from '../components/ui/Modal.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { CategoryInput, UnitLabelInput } from '../components/ui/catalogSuggest.jsx';
import { CadenceSelect, CadenceHint } from '../components/ui/CadenceSelect.jsx';
import { cadenceLabel, cadenceUnit } from '../utils/cadence.js';

const RECURRENCE_OPTS = [
  { value: 'monthly',    label: 'Monthly' },
  { value: 'quarterly',  label: 'Quarterly' },
  { value: 'semiannual', label: 'Semi-annually' },
  { value: 'annual',     label: 'Annually' },
];
const money = (v) => (v != null ? `$${parseFloat(v).toFixed(2)}` : '—');

function ServiceForm({ service, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:         service?.name         ?? '',
    unit_price:   service?.unit_price != null ? String(service.unit_price) : '',
    billing_type: service?.billing_type ?? 'recurring',
    recurrence:   service?.recurrence   ?? 'monthly',
    // How many periods between bills — 3 for something sold three years at a time
    // (a domain registration, a multi-year cert). 1 is the ordinary cadence.
    recurrence_count: service?.recurrence_count ?? 1,
    category:     service?.category      ?? '',
    unit_label:   service?.unit_label    ?? '',
    notes:        service?.notes        ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  // When the price of a service that customers are already billed for changes, the
  // linked charges on those customers' Billing tabs move with it by default.
  const [propagate, setPropagate] = useState(true);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const priceOf = (v) => (v === '' || v == null ? null : parseFloat(v));
  const linkedCount = service?.linked_charge_count ?? 0;
  const priceChanged = !!service && priceOf(form.unit_price) !== priceOf(service.unit_price);
  const showSync = priceChanged && linkedCount > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        unit_price: form.unit_price === '' ? null : parseFloat(form.unit_price),
        billing_type: form.billing_type,
        recurrence: form.billing_type === 'recurring' ? form.recurrence : null,
        recurrence_count: form.billing_type === 'recurring' ? form.recurrence_count : 1,
        category: form.category.trim() || null,
        unit_label: form.unit_label.trim() || null,
        notes: form.notes || null,
      };
      if (service) {
        const { data } = await serviceCatalogApi.update(service.id, { ...payload, propagate_price: propagate });
        const n = data?.price_sync?.updated ?? 0;
        onSaved(n > 0 ? `Price updated — ${n} customer ${n === 1 ? 'charge' : 'charges'} re-priced to ${money(payload.unit_price)}.` : '');
      } else {
        await serviceCatalogApi.create(payload);
        onSaved('');
      }
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save service.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Service Name *</label>
        <input className="input" value={form.name} onChange={set('name')} required autoFocus autoComplete="off"
          placeholder="e.g. ThreatLocker Complete, Trend Micro, TeamViewer" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Price (each)</label>
          <input className="input" type="number" min="0" step="0.01" value={form.unit_price}
            onChange={set('unit_price')} placeholder="0.00" onWheel={e => e.currentTarget.blur()} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Billing</label>
          <select className="input" value={form.billing_type} onChange={set('billing_type')}>
            <option value="recurring">Recurring</option>
            <option value="one_time">One-time</option>
          </select>
        </div>
      </div>
      {form.billing_type === 'recurring' && (
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">How often</label>
          <CadenceSelect options={RECURRENCE_OPTS} frequency={form.recurrence} count={form.recurrence_count}
            onChange={({ frequency, count }) => setForm(f => ({ ...f, recurrence: frequency, recurrence_count: count }))} />
          <p className="text-xs text-gray-600 mt-1">
            <CadenceHint frequency={form.recurrence} count={form.recurrence_count} />{' '}
            Pick Annually and set the years for anything sold in multi-year terms — a domain registration,
            a 3-year SSL cert.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Category</label>
          <CategoryInput value={form.category} onChange={(v) => setForm(f => ({ ...f, category: v }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">
            Unit label <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <UnitLabelInput value={form.unit_label} onChange={(v) => setForm(f => ({ ...f, unit_label: v }))} />
        </div>
      </div>
      <p className="text-xs text-gray-600 -mt-1">
        Both suggest what you've entered before. Category &amp; unit label carry over when you add this service on a customer's Billing tab — so only the quantity (e.g. seat count) is left to enter.
      </p>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Notes</label>
        <input className="input" value={form.notes} onChange={set('notes')} autoComplete="off"
          placeholder="Optional — internal note about this service" />
      </div>

      {/* Price roll-out: the reason a customer charge remembers which service it came from. */}
      {showSync && (
        <div className="rounded-lg border border-blue-800/60 bg-blue-900/20 p-3 space-y-2">
          <p className="text-sm text-blue-200">
            {linkedCount} customer {linkedCount === 1 ? 'charge is' : 'charges are'} billed for this service at{' '}
            {money(service.unit_price)}.
          </p>
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" className="h-4 w-4 mt-0.5 accent-brand"
              checked={propagate} onChange={(e) => setPropagate(e.target.checked)} />
            <span className="text-sm text-gray-300">
              Update {linkedCount === 1 ? 'that charge' : 'those charges'} to{' '}
              <span className="text-accent font-medium">{money(priceOf(form.unit_price))}</span> too
              <span className="block text-xs text-gray-500">
                Each customer keeps its own quantity — only the per-each price changes. Uncheck to change the
                price for new customers only. Inactive charges are left alone.
              </span>
            </span>
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
          {saving ? 'Saving…' : service ? 'Update Service' : 'Add Service'}
        </button>
      </div>
    </form>
  );
}

export function Services() {
  const [modal, setModal] = useState(null);   // 'new' | service obj | null
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');   // "N charges re-priced" after a price change

  const { data: services = [], refetch } = useQuery({
    queryKey: ['service-catalog', 'all'],
    queryFn: () => serviceCatalogApi.list({ includeInactive: 1 }).then(r => r.data),
  });

  const remove = async (s) => {
    if (!confirm(`Delete "${s.name}" from the service catalog?`)) return;
    await serviceCatalogApi.remove(s.id);
    refetch();
  };

  const q = search.trim().toLowerCase();
  const shown = q ? services.filter(s => s.name.toLowerCase().includes(q)) : services;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Services</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Reusable service prices — autofill on work orders, and the price of record for
            customers billed for them recurring.
          </p>
        </div>
        <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> New Service
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-blue-800/60 bg-blue-900/20 px-4 py-2.5 flex items-center gap-3">
          <p className="text-sm text-blue-200 flex-1">{notice}</p>
          <button onClick={() => setNotice('')} className="btn-ghost text-xs text-gray-400 hover:text-gray-200">Dismiss</button>
        </div>
      )}

      {services.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input pl-9" placeholder="Search services…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {services.length === 0 ? (
        <div className="card">
          <EmptyState icon={Tags} title="No services yet"
            description="Add the services you sell repeatedly (ThreatLocker, Trend Micro, TeamViewer…) so they autofill on work orders."
            action={<button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2"><Plus size={14} /> Add Service</button>} />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No services match your search.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600">
                <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs">Service</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden sm:table-cell">Billing</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3 text-xs whitespace-nowrap hidden md:table-cell">Billed to</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3 text-xs">Price</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {shown.map(s => (
                <tr key={s.id} className="hover:bg-surface-700/50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${s.is_active ? 'text-gray-200' : 'text-gray-500 line-through'}`}>{s.name}</span>
                      {s.category && <span className="text-xs text-gray-500 bg-surface-600 px-1.5 py-0.5 rounded-sm">{s.category}</span>}
                      {s.unit_label && <span className="text-xs text-gray-600">per {s.unit_label}</span>}
                    </div>
                    {s.notes && <p className="text-gray-600 text-xs mt-0.5">{s.notes}</p>}
                    <p className="sm:hidden text-xs text-gray-500 mt-0.5">
                      {s.billing_type === 'recurring' ? `Recurring · ${cadenceLabel(s.recurrence, s.recurrence_count)}` : 'One-time'}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`badge text-xs ${s.billing_type === 'recurring' ? 'bg-blue-900/40 text-blue-300' : 'bg-surface-600 text-gray-400'}`}>
                      {s.billing_type === 'recurring' ? `Recurring · ${cadenceLabel(s.recurrence, s.recurrence_count)}` : 'One-time'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap hidden md:table-cell">
                    {s.linked_charge_count > 0
                      ? <span className="text-xs text-gray-400">{s.linked_charge_count} {s.linked_charge_count === 1 ? 'charge' : 'charges'}</span>
                      : <span className="text-xs text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                    {money(s.unit_price)}{s.billing_type === 'recurring' ? `/${cadenceUnit(s.recurrence, s.recurrence_count)}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setModal(s)} className="btn-ghost p-1.5 opacity-0 group-hover:opacity-100 hover:text-gray-200" title="Edit"><Pencil size={13} /></button>
                      <button onClick={() => remove(s)} className="btn-ghost p-1.5 opacity-0 group-hover:opacity-100 hover:text-red-400" title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'New Service' : 'Edit Service'}>
        {modal !== null && (
          <ServiceForm
            service={modal === 'new' ? null : modal}
            onClose={() => setModal(null)}
            onSaved={(msg) => { setModal(null); setNotice(msg || ''); refetch(); }}
          />
        )}
      </Modal>
    </div>
  );
}
