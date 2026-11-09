import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { fieldWOApi } from '../api/workOrders.js';
import { formatDateRange, fmtHours } from '../utils/jobDays.js';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'ready', label: 'Ready to bill' },
  { value: 'imported', label: 'Imported' },
];

const STATUS_STYLE = {
  open: 'bg-surface-600 text-gray-300',
  ready: 'bg-accent/20 text-accent',
  imported: 'bg-green-500/20 text-green-300',
};

export function statusLabel(s) {
  return {
    open: 'Open',
    ready: 'Ready to bill',
    imported: 'Imported',
  }[s] || s;
}

export default function WorkOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      if (search) params.search = search;
      const res = await fieldWOApi.list(params);
      setOrders(res.data || []);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <button onClick={() => navigate('/work-orders/new')} className="btn-primary text-sm px-4 py-2">+ New</button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search customer, address…"
        className="input"
      />

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm shrink-0 transition-colors ${
              status === t.value ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No jobs found.</p>
      ) : (
        <div className="space-y-2">
          {orders.map((wo) => (
            <button key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)} className="card p-4 w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold truncate">{wo.customer_name}</span>
                <span className={`text-[10px] uppercase rounded-full px-2 py-1 shrink-0 ${STATUS_STYLE[wo.capture_status] || ''}`}>
                  {statusLabel(wo.capture_status)}
                </span>
              </div>
              {wo.customer_address && <div className="text-xs text-gray-500 mt-1 truncate">{wo.customer_address}</div>}
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>#{wo.number}</span>
                {wo.work_date && <span>· {formatDateRange(wo.work_date, wo.last_date)}</span>}
                {Number(wo.day_count) > 1 && <span>· {wo.day_count} days</span>}
                {Number(wo.hours) > 0 && <span>· {fmtHours(wo.hours)}h</span>}
                {wo.tech_initials && <span>· {wo.tech_initials}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
