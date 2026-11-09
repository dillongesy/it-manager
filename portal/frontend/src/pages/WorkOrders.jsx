import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardList, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { workOrdersApi } from '../api/workOrders.js';
import { customersApi } from '../api/customers.js';
import { Modal } from '../components/ui/Modal.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import api from '../api/client.js';
import { formatDate, todayInput } from '../utils/date.js';
import { useInfiniteList, patchCachedRows } from '../hooks/useInfiniteList.js';
import { LoadMore } from '../components/ui/LoadMore.jsx';
import {
  WO_STATUS_BADGE as STATUS_BADGE,
  WO_STATUS_LABEL as STATUS_LABEL,
  WO_STATUS_FILTERS as STATUSES,
} from '../utils/woStatus.js';
import { woLocationLabel } from '../utils/woLocation.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

function SortHeader({ col, label, sort, onSort, className }) {
  const active = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`text-left text-gray-500 font-medium px-4 py-3 cursor-pointer select-none hover:text-gray-300 transition-colors ${className ?? ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && sort.dir === 'asc'  && <ChevronUp size={11} className="text-brand" />}
        {active && sort.dir === 'desc' && <ChevronDown size={11} className="text-brand" />}
      </span>
    </th>
  );
}

const TECH_FILTER_KEY = 'app-wo-tech-filter';

function NewWOModal({ onClose, onCreated }) {
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch]         = useState('');
  const [workDate, setWorkDate]     = useState(todayInput());
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list({ search: search || undefined }).then(r => r.data),
    staleTime: 15_000,
  });

  // Pull the chosen customer's branch offices (if any) so we can offer the optional
  // branch dropdown. Only the full customer record carries `locations`.
  const { data: customer } = useQuery({
    queryKey: ['customers', customerId, 'full'],
    queryFn: () => customersApi.get(customerId).then(r => r.data),
    enabled: !!customerId,
  });
  const locations = customer?.locations ?? [];

  const submit = async (e) => {
    e.preventDefault();
    if (!customerId) { setError('Please select a customer.'); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await workOrdersApi.create({ customer_id: customerId, work_date: workDate, location_id: locationId || null });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to create work order.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Customer *</label>
        <input
          className="input mb-2"
          placeholder="Search customers…"
          value={search}
          onChange={e => { setSearch(e.target.value); setCustomerId(''); }}
        />
        {search && (
          <div className="bg-surface-700 border border-surface-500 rounded-md overflow-hidden max-h-48 overflow-y-auto">
            {customers.length === 0
              ? <p className="text-gray-500 text-sm p-3">No customers found.</p>
              : customers.map(c => (
                <button
                  key={c.id} type="button"
                  onClick={() => { setCustomerId(c.id); setSearch(c.name); setLocationId(''); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-600 transition-colors ${
                    customerId === c.id ? 'bg-brand/20 text-brand' : 'text-gray-300'
                  }`}
                >
                  {c.name}
                </button>
              ))
            }
          </div>
        )}
      </div>

      {customerId && locations.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">
            Branch / Location <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <select className="input" value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Main office</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>
                {l.label || l.business_name || l.address || 'Branch'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Work Date</label>
        <input className="input" type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !customerId} className="btn-primary">
          {saving ? 'Creating…' : 'Create Work Order'}
        </button>
      </div>
    </form>
  );
}

export function WorkOrders() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const [search, setSearch]   = useState('');
  const [showNew, setShowNew] = useState(false);
  const [techUsers, setTechUsers] = useState([]);
  const [sort, setSort] = useState({ col: null, dir: null });

  // Initialize from localStorage; '' means "All techs"
  const [techId, setTechId] = useState(() => localStorage.getItem(TECH_FILTER_KEY) ?? '');

  // Load active non-biller users for the filter row
  useEffect(() => {
    api.get('/users').then(r =>
      setTechUsers(r.data.filter(u => u.is_active && u.role !== 'biller'))
    );
  }, []);

  // First visit: default to the logged-in user
  useEffect(() => {
    if (user && localStorage.getItem(TECH_FILTER_KEY) === null) {
      const id = String(user.id);
      setTechId(id);
      localStorage.setItem(TECH_FILTER_KEY, id);
    }
  }, [user]);

  const setTech = (id) => {
    setTechId(id);
    localStorage.setItem(TECH_FILTER_KEY, id);
  };

  const handleSort = (col) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: null, dir: null };
    });
  };

  // Endless scroll across every filter combination - status, search, technician and
  // sort all go to the server, and the list pages through the FULL result rather
  // than stopping at the API's first page.
  const woQuery = useInfiniteList({
    queryKey: ['work-orders', 'list', status, search, techId, sort],
    fetchPage: ({ limit, offset }) => workOrdersApi.list({
      status: status || undefined,
      search: search || undefined,
      technicianId: techId || undefined,
      sortBy: sort.col || undefined,
      sortDir: sort.dir || undefined,
      limit, offset,
    }),
    staleTime: 15_000,
  });
  const workOrders = woQuery.rows;
  const refetch = woQuery.refetch;

  // Toggle "printed & submitted" straight from the list. Optimistically flip it across
  // every cached work-order list variant, then persist; revert by refetching on failure.
  const togglePrinted = async (wo, e) => {
    e.stopPropagation();
    const next = !wo.printed_submitted;
    qc.setQueriesData({ queryKey: ['work-orders'] }, (old) =>
      patchCachedRows(old, (x) => x.id === wo.id, { printed_submitted: next }));
    try { await workOrdersApi.setPrintedSubmitted(wo.id, next); }
    catch { qc.invalidateQueries({ queryKey: ['work-orders'] }); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Work Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {woQuery.total.toLocaleString()} result{woQuery.total !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> New Work Order
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input pl-9" placeholder="Search customer, branch or description…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {STATUSES.map(s => (
              <button key={s.value}
                onClick={() => setSp(s.value ? { status: s.value } : {}, { replace: true })}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  status === s.value
                    ? 'bg-brand text-white'
                    : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'
                }`}
              >{s.label}</button>
            ))}
          </div>
        </div>
        {techUsers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-600 mr-1">Tech:</span>
            <button
              onClick={() => setTech('')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                techId === ''
                  ? 'bg-brand text-white'
                  : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'
              }`}
            >All</button>
            {techUsers.map(u => (
              <button
                key={u.id}
                onClick={() => setTech(String(u.id))}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  techId === String(u.id)
                    ? 'bg-brand text-white'
                    : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'
                }`}
              >{u.full_name}</button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {woQuery.isLoading ? (
        <div className="card p-8 text-center text-gray-500 text-sm">Loading…</div>
      ) : workOrders.length === 0 ? (
        <div className="card">
          <EmptyState icon={ClipboardList} title="No work orders"
            description={search || status ? 'Try adjusting your filters.' : 'Create your first work order.'}
            action={!search && !status
              ? <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
                  <Plus size={14} /> New Work Order
                </button>
              : null}
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600">
                <SortHeader col="number"        label="#"           sort={sort} onSort={handleSort} />
                <SortHeader col="customer_name" label="Customer"    sort={sort} onSort={handleSort} />
                <SortHeader col="location"      label="Branch"      sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                <SortHeader col="work_date"     label="Date Created" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                <SortHeader col="technicians"   label="Technicians" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                <SortHeader col="status"        label="Status"      sort={sort} onSort={handleSort} />
                <th className="text-center text-gray-500 font-medium px-4 py-3 text-xs hidden sm:table-cell whitespace-nowrap">
                  Printed &amp; Submitted
                </th>
                <th onClick={() => handleSort('total')}
                  className="text-right text-gray-500 font-medium px-4 py-3 hidden md:table-cell cursor-pointer select-none hover:text-gray-300 transition-colors">
                  <span className="inline-flex items-center justify-end gap-1">
                    Total
                    {sort.col === 'total' && sort.dir === 'asc'  && <ChevronUp size={11} className="text-brand" />}
                    {sort.col === 'total' && sort.dir === 'desc' && <ChevronDown size={11} className="text-brand" />}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {workOrders.map(wo => {
                const total = (parseFloat(wo.labor_total || 0) + parseFloat(wo.hardware_total || 0) + parseFloat(wo.proposals_total || 0));
                const branch = woLocationLabel(wo);
                return (
                  <tr key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)}
                    className="hover:bg-surface-700/50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs whitespace-nowrap">{woNum(wo.number)}</td>
                    <td className="px-4 py-3 font-medium text-gray-200">
                      {wo.customer_name}
                      <span className="md:hidden block text-xs font-normal text-gray-500 mt-0.5">
                        {branch && <>{branch} · </>}
                        {formatDate(wo.work_date)}{total > 0 ? ` · $${total.toFixed(2)}` : ''}
                      </span>
                    </td>
                    <td className={`px-4 py-3 hidden md:table-cell ${wo.location_name ? 'text-gray-300' : 'text-gray-500'}`}>
                      {branch ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                      {formatDate(wo.work_date)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden lg:table-cell text-xs">
                      {wo.technicians || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_BADGE[wo.status] ?? ''}`}>
                        {STATUS_LABEL[wo.status] ?? wo.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!wo.printed_submitted}
                        onChange={(e) => togglePrinted(wo, e)}
                        title="Printed & submitted"
                        className="h-4 w-4 accent-brand cursor-pointer align-middle"
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 hidden md:table-cell">
                      {total > 0 ? `$${total.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <LoadMore query={woQuery} loaded={workOrders.length} total={woQuery.total} noun="work order" />
        </div>
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Work Order" size="sm">
        <NewWOModal
          onClose={() => setShowNew(false)}
          onCreated={(wo) => { setShowNew(false); navigate(`/work-orders/${wo.id}`); }}
        />
      </Modal>
    </div>
  );
}
