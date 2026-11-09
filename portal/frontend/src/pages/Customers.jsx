import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search, Building2, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { customersApi } from '../api/customers.js';
import { Modal } from '../components/ui/Modal.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { noAutofill } from '../components/ui/noAutofill.js';
import { formatPhone } from '../utils/phone.js';
import { useInfiniteList } from '../hooks/useInfiniteList.js';
import { LoadMore } from '../components/ui/LoadMore.jsx';

function CustomerForm({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '', zip: '', phone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await customersApi.create(form);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to create customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off" data-form-type="other">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Business Name *</label>
        <input className="input" {...noAutofill} value={form.name} onChange={set('name')} required placeholder="Acme Corp" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Street Address</label>
        <input className="input" {...noAutofill} value={form.address} onChange={set('address')} placeholder="123 Main St" />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-sm font-medium text-gray-400 mb-1.5">City</label>
          <input className="input" {...noAutofill} value={form.city} onChange={set('city')} placeholder="Springfield" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-400 mb-1.5">State</label>
          <input className="input" {...noAutofill} value={form.state} onChange={set('state')} placeholder="IL" maxLength={2} />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="block text-sm font-medium text-gray-400 mb-1.5">ZIP</label>
          <input className="input" {...noAutofill} value={form.zip} onChange={set('zip')} placeholder="62701" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Main Office / Business Line</label>
        <input className="input" {...noAutofill} type="tel" value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} placeholder="(555) 000-0000" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Notes</label>
        <textarea className="input resize-none" rows={3} value={form.notes} onChange={set('notes')} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.name} className="btn-primary">
          {saving ? 'Creating…' : 'Create Customer'}
        </button>
      </div>
    </form>
  );
}

function SortHeader({ col, label, sort, onSort, className, align = 'left' }) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`text-${align} text-gray-500 font-medium px-4 py-3 cursor-pointer select-none hover:text-gray-300 transition-colors ${className ?? ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active && sort.dir === 'asc'  && <ChevronUp size={11} className="text-brand" />}
        {active && sort.dir === 'desc' && <ChevronDown size={11} className="text-brand" />}
      </span>
    </th>
  );
}

export function Customers() {
  const navigate = useNavigate();
  const [search, setSearch]     = useState('');
  const [showCreate, setCreate] = useState(false);
  const [sort, setSort]         = useState({ col: null, dir: null });

  const handleSort = (col) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: null, dir: null };
    });
  };

  // Pages through the whole customer list rather than relying on one oversized
  // request - the first page paints immediately and the rest follows as you scroll.
  const customerQuery = useInfiniteList({
    queryKey: ['customers', 'list', search, sort],
    fetchPage: ({ limit, offset }) => customersApi.list({
      search: search || undefined,
      sortBy: sort.col || undefined,
      sortDir: sort.dir || undefined,
      limit, offset,
    }),
    staleTime: 15_000,
  });
  const customers = customerQuery.rows;
  const refetch = customerQuery.refetch;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Customers</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {customerQuery.total.toLocaleString()} customer{customerQuery.total !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> New Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input pl-9 max-w-sm"
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      {customerQuery.isLoading ? (
        <div className="card p-8 text-center text-gray-500 text-sm">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Building2}
            title="No customers found"
            description={search ? 'Try a different search.' : 'Add your first customer to get started.'}
            action={
              !search && (
                <button onClick={() => setCreate(true)} className="btn-primary flex items-center gap-2">
                  <Plus size={14} /> Add Customer
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600">
                <SortHeader col="name"             label="Name"     sort={sort} onSort={handleSort} />
                <SortHeader col="city"             label="Location" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                <SortHeader col="phone"            label="Phone"    sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                <SortHeader col="open_work_orders" label="Open WOs" sort={sort} onSort={handleSort} />
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {customers.map(c => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  className="hover:bg-surface-700/50 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3 font-medium text-gray-200">{c.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-400">
                    {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{c.phone || '—'}</td>
                  <td className="px-4 py-3">
                    {parseInt(c.open_work_orders) > 0
                      ? <span className="badge bg-brand/20 text-brand">{c.open_work_orders} open</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 group-hover:text-gray-400">
                    <ChevronRight size={15} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore query={customerQuery} loaded={customers.length} total={customerQuery.total} noun="customer" />
        </div>
      )}

      <Modal open={showCreate} onClose={() => setCreate(false)} title="New Customer">
        <CustomerForm
          onClose={() => setCreate(false)}
          onCreated={(c) => { setCreate(false); refetch(); navigate(`/customers/${c.id}`); }}
        />
      </Modal>
    </div>
  );
}
