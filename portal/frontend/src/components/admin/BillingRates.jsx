import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { adminApi } from '../../api/admin.js';

// Admin → Billing: the hourly rates every new customer starts with. Each customer's
// copy can still be changed on its Overview tab.

let nextKey = 0;
const withKey = (r) => ({ ...r, key: ++nextKey });

const money = (n) => Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export function BillingRates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'billing-rates'], queryFn: adminApi.billingRates });
  const [rows, setRows] = useState([]);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (data) setRows(data.rates.map(r => withKey({ label: r.label, rate: String(r.rate) })));
  }, [data]);

  if (isLoading || !data) return <p className="text-gray-500 text-sm">Loading…</p>;

  const max = data.limits.maxRates;
  const update = (i, key) => (e) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)));
  const move = (i, d) => setRows(rs => {
    const next = [...rs];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i));
  const add = () => setRows(rs => [...rs, withKey({ label: '', rate: '' })]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const result = await adminApi.saveBillingRates({
        rates: rows.map(r => ({ label: r.label, rate: r.rate })),
        applyToExisting,
      });
      qc.setQueryData(['admin', 'billing-rates'], { ...data, rates: result.rates });
      const parts = ['Default rates saved.'];
      if (applyToExisting && result.changes.length) {
        parts.push(`${result.customersUpdated} existing customer rate${result.customersUpdated === 1 ? '' : 's'} updated.`);
      }
      setMessage({ ok: parts.join(' ') });
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'Could not save the rates.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="card p-5 space-y-4 text-sm">
      <div>
        <h2 className="text-base font-semibold text-gray-200">Default billing rates</h2>
        <p className="text-gray-400 mt-1">
          New customers start with these hourly rates, in this order. Each customer's rates can
          be changed afterwards on its Overview tab. The first rate is the default for new work orders.
        </p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_8rem_auto] gap-2 text-xs text-gray-500 px-1">
          <span>Name</span><span>Hourly rate</span><span className="sr-only">Actions</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-center">
            <input className="input" value={r.label} onChange={update(i, 'label')} maxLength={data.limits.maxLabel}
              placeholder="e.g. After hours" required aria-label={`Rate ${i + 1} name`} />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input className="input pl-6" type="number" min="0" step="0.01" max={data.limits.maxRate}
                value={r.rate} onChange={update(i, 'rate')} required aria-label={`Rate ${i + 1} amount`} />
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-ghost p-1.5" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><ArrowUp size={14} /></button>
              <button type="button" className="btn-ghost p-1.5" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down"><ArrowDown size={14} /></button>
              <button type="button" className="btn-ghost p-1.5 text-red-400" onClick={() => remove(i)} disabled={rows.length === 1} title="Remove"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {rows.length < max && (
          <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={add}><Plus size={12} /> Add rate</button>
        )}
      </div>

      <label className="flex items-start gap-2 text-gray-300">
        <input type="checkbox" className="mt-0.5" checked={applyToExisting} onChange={e => setApplyToExisting(e.target.checked)} />
        <span>
          Update existing customers still on the old price
          <span className="block text-xs text-gray-500">
            For example, changing Standard from {money(90)} to {money(95)} updates every customer whose Standard
            rate is {money(90)}. Customers with a negotiated price are not changed.
          </span>
        </span>
      </label>

      {message && (
        <p className={`rounded-sm p-2 ${message.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>
          {message.error || message.ok}
        </p>
      )}

      <button type="submit" className="btn-primary text-sm flex items-center gap-1.5" disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save rates'}
      </button>
    </form>
  );
}
