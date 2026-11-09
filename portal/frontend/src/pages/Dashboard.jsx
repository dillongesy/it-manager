import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, Users, AlertCircle, ChevronDown, ChevronRight,
  ListChecks, Package, BadgeCheck, Briefcase, Check, RefreshCw, Repeat, Filter,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { workOrdersApi } from '../api/workOrders.js';
import { tasksApi } from '../api/tasks.js';
import { taskNumber, taskFlags } from '../utils/tasks.js';
import { StatusBadge } from '../components/tasks/taskBits.jsx';
import { orderLogApi } from '../api/orderLog.js';
import { licensesApi } from '../api/licenses.js';
import { recurringChargesApi } from '../api/recurringCharges.js';
import { parseDate, intervalLabel } from '../utils/renewal.js';
import { formatDate } from '../utils/date.js';
import { money, annualizedTotal, nextDueFor, nextDueLabel, chargeCadence, chargeUnit } from '../utils/recurring.js';
import { analyticsApi } from '../api/analytics.js';
import { DragList } from '../components/ui/DragList.jsx';
import { MAX_PAGE_SIZE } from '../hooks/useInfiniteList.js';
import { WO_STATUS_BADGE as STATUS_BADGE, WO_STATUS_LABEL as STATUS_LABEL } from '../utils/woStatus.js';

// Dashboard sections show everything they fetch (preview 5 + "Show all") rather
// than paging, so they request the API's largest allowed window.
const SECTION_LIMIT = MAX_PAGE_SIZE;

const ORDER_BADGE = {
  placed: 'bg-surface-500 text-gray-300', pending: 'bg-amber-900/40 text-amber-400',
  backordered: 'bg-red-900/40 text-red-400', complete: 'bg-green-900/40 text-green-400',
};

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

// Color-code a renewal date: overdue/≤30d red, ≤90d amber, else green.
function renewalBadge(dateStr) {
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0)   return { cls: 'bg-red-900/40 text-red-400',   label: `${Math.abs(days)}d overdue` };
  if (days <= 30) return { cls: 'bg-red-900/40 text-red-400',   label: `${days}d left` };
  if (days <= 90) return { cls: 'bg-amber-900/40 text-amber-400', label: `${days}d left` };
  return { cls: 'bg-green-900/40 text-green-400', label: `${days}d left` };
}

function StatCard({ label, value, icon: Icon, accent, onClick }) {
  return (
    <div onClick={onClick}
      className={`card p-5 ${onClick ? 'cursor-pointer hover:bg-surface-700/50 transition-colors' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm font-medium">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${accent ? 'text-brand' : 'text-gray-100'}`}>{value ?? '—'}</p>
        </div>
        <div className={`p-2 rounded-lg ${accent ? 'bg-brand/10' : 'bg-surface-600'}`}>
          <Icon size={18} className={accent ? 'text-brand' : 'text-gray-400'} />
        </div>
      </div>
    </div>
  );
}

// Collapsible section; open/closed state persists per section in localStorage.
// Shows the first 5 items, then "Show all" reveals the rest inline.
// ─── License expiry filter (device-type / model / vendor aware) ─────────────────

const DEVICE_TYPE_LABEL = {
  firewall: 'Firewalls', switch: 'Switches', server: 'Servers', workstation: 'Workstations',
  nas: 'NAS', network: 'Network', printer: 'Printers', other: 'Other devices',
};
const deviceTypeLabel = (t) => DEVICE_TYPE_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Device');
const licenseModel = (l) => [l.manufacturer, l.model].filter(Boolean).join(' ').trim();

// Group the licenses into filterable buckets: device type, specific model, and vendor
// (for licenses not tied to a device). Counts drive the option labels.
function licenseFilterOptions(items) {
  const types = new Map(), models = new Map(), vendors = new Map();
  for (const l of items) {
    if (l.device_type) {
      types.set(l.device_type, (types.get(l.device_type) || 0) + 1);
      const m = licenseModel(l);
      if (m) models.set(m, (models.get(m) || 0) + 1);
    } else if (l.vendor) {
      vendors.set(l.vendor, (vendors.get(l.vendor) || 0) + 1);
    }
  }
  const sortEntries = (map) => [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { types: sortEntries(types), models: sortEntries(models), vendors: sortEntries(vendors) };
}

function licenseMatches(l, filter) {
  if (!filter || filter === 'all') return true;
  const i = filter.indexOf(':');
  const kind = filter.slice(0, i), val = filter.slice(i + 1);
  if (kind === 'type')   return l.device_type === val;
  if (kind === 'model')  return licenseModel(l) === val;
  if (kind === 'vendor') return !l.device_type && l.vendor === val;
  return true;
}

function LicenseFilter({ items, value, onChange }) {
  const { types, models, vendors } = licenseFilterOptions(items);
  return (
    <div className="flex items-center gap-2">
      <Filter size={13} className="text-gray-500 shrink-0" />
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="input py-1 text-sm flex-1 min-w-0"
        onClick={(e) => e.stopPropagation()}>
        <option value="all">All licenses ({items.length})</option>
        {types.length > 0 && (
          <optgroup label="Device type">
            {types.map(([t, n]) => <option key={t} value={`type:${t}`}>{deviceTypeLabel(t)} ({n})</option>)}
          </optgroup>
        )}
        {models.length > 0 && (
          <optgroup label="Model">
            {models.map(([m, n]) => <option key={m} value={`model:${m}`}>{m} ({n})</option>)}
          </optgroup>
        )}
        {vendors.length > 0 && (
          <optgroup label="Vendor">
            {vendors.map(([v, n]) => <option key={v} value={`vendor:${v}`}>{v} ({n})</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function DashSection({ id, title, icon: Icon, accent, query, emptyText, renderItem, handle, controls }) {
  const storageKey = `app-dash-${id}`;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(storageKey);
    return v === null ? true : v === '1';
  });
  const [showAll, setShowAll] = useState(false);
  const toggle = () => setOpen(o => { localStorage.setItem(storageKey, o ? '0' : '1'); return !o; });

  const items = query.data ?? [];
  const loading = query.isLoading;
  const shown = showAll ? items : items.slice(0, 5);

  return (
    <div className="card overflow-hidden">
      {/* Header: drag handle (reorder) sits outside the collapse toggle to avoid clicks colliding */}
      <div className="px-4 py-3 flex items-center gap-2">
        {handle}
        <button onClick={toggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left -my-1 py-1 rounded-sm hover:text-gray-100 transition-colors">
          {open ? <ChevronDown size={15} className="text-gray-500" /> : <ChevronRight size={15} className="text-gray-500" />}
          <Icon size={15} className={accent ? 'text-brand' : 'text-gray-400'} />
          <span className="text-gray-200 font-semibold text-sm truncate">{title}</span>
        </button>
        <span className={`badge text-xs shrink-0 ${accent && items.length ? 'bg-brand/20 text-brand' : 'bg-surface-600 text-gray-300'}`}>
          {loading ? '…' : items.length}
        </span>
      </div>
      {open && (
        <div className="border-t border-surface-700">
          {controls && <div className="px-4 py-2.5 border-b border-surface-700">{controls}</div>}
          {loading ? (
            <p className="text-gray-600 text-sm p-4">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-gray-600 text-sm p-4">{emptyText}</p>
          ) : (
            <>
              <div className="divide-y divide-surface-700">{shown.map(renderItem)}</div>
              {items.length > 5 && (
                <button onClick={() => setShowAll(s => !s)}
                  className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-surface-700/40 border-t border-surface-700 transition-colors">
                  {showAll ? 'Show less' : `Show all ${items.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ onClick, children }) {
  return (
    <div onClick={onClick} className="px-4 py-2.5 hover:bg-surface-700/50 cursor-pointer transition-colors">
      {children}
    </div>
  );
}

// ─── Analytics (dependency-free CSS charts) ─────────────────────────────────────

function weekLabel(iso) { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; }

// Simple vertical bar chart: a value per week, height relative to the series max.
function MiniBars({ values, labels, color, fmt = (v) => v }) {
  const max = Math.max(...values, 1);
  const allZero = values.every(v => !v);
  return (
    <div>
      <div className="flex items-end gap-1.5 h-28">
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
            <span className="text-[10px] text-gray-400 leading-none">{v > 0 ? fmt(v) : ''}</span>
            <div className={`w-full rounded-t ${color}`}
              style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '3px' : '0' }}
              title={`${labels[i]}: ${fmt(v)}`} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {labels.map((l, i) => <span key={i} className="flex-1 text-center text-[9px] text-gray-600">{l}</span>)}
      </div>
      {allZero && <p className="text-gray-600 text-xs text-center mt-2">No data in this window.</p>}
    </div>
  );
}

const STATUS_META = [
  { key: 'draft',           label: 'Draft',           color: 'bg-gray-500' },
  { key: 'pending_billing', label: 'Pending Billing', color: 'bg-amber-500' },
  { key: 'invoiced',        label: 'Invoiced',        color: 'bg-blue-500' },
  { key: 'paid',            label: 'Paid',            color: 'bg-green-500' },
  { key: 'voided',          label: 'Voided',          color: 'bg-red-600' },
];
function StatusBars({ counts }) {
  const total = STATUS_META.reduce((s, m) => s + (counts[m.key] || 0), 0) || 1;
  return (
    <div className="space-y-2.5">
      {STATUS_META.map(m => {
        const c = counts[m.key] || 0;
        return (
          <div key={m.key} className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 w-28 shrink-0">{m.label}</span>
            <div className="flex-1 bg-surface-700 rounded-sm h-2.5 overflow-hidden">
              <div className={`h-full ${m.color}`} style={{ width: `${(c / total) * 100}%` }} />
            </div>
            <span className="text-gray-300 w-8 text-right">{c}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="card p-4">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-2xl font-bold text-gray-100 mt-1">{value}</p>
    </div>
  );
}

// ─── Recurring revenue widget ───────────────────────────────────────────────────
// Company-wide MRR/annualized headline + per-customer breakdown, plus the periodic
// charges (annual/quarterly/semi-annual) coming due in the next 3 months. Monthly
// charges feed the totals but aren't listed in "upcoming" (they'd recur every month).
const UPCOMING_MONTHS = 3;

function RecurringRevenueCard({ charges, navigate }) {
  const [showAll, setShowAll] = useState(false);

  const byCust = new Map();
  for (const c of charges) {
    if (!byCust.has(c.customer_id)) byCust.set(c.customer_id, { id: c.customer_id, name: c.customer_name, items: [] });
    byCust.get(c.customer_id).items.push(c);
  }
  const customers = [...byCust.values()]
    .map(cu => { const annual = annualizedTotal(cu.items); return { ...cu, annual, monthly: annual / 12 }; })
    .sort((a, b) => b.annual - a.annual);

  const companyAnnual = annualizedTotal(charges);

  const now = new Date();
  const upcoming = charges
    .filter(c => c.frequency !== 'monthly')
    .map(c => ({ c, due: nextDueFor(c) }))
    .filter(({ due }) => {
      if (!due) return false;
      const diff = (due.year - now.getFullYear()) * 12 + (due.month - 1 - now.getMonth());
      return diff >= 0 && diff < UPCOMING_MONTHS;
    })
    .sort((a, b) =>
      (a.due.year * 12 + a.due.month) - (b.due.year * 12 + b.due.month)
      || (parseFloat(b.c.amount) || 0) - (parseFloat(a.c.amount) || 0));

  const shown = showAll ? customers : customers.slice(0, 6);

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Repeat size={16} className="text-brand" />
        <h2 className="text-gray-100 font-semibold">Recurring Revenue</h2>
        <span className="ml-auto text-xs text-gray-500">{customers.length} customer{customers.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-surface-700/50 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Monthly recurring</p>
          <p className="text-xl font-bold text-gray-100 mt-0.5">{money(companyAnnual / 12)}<span className="text-xs text-gray-500 font-normal">/mo</span></p>
        </div>
        <div className="bg-surface-700/50 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Annualized</p>
          <p className="text-xl font-bold text-accent mt-0.5">{money(companyAnnual)}<span className="text-xs text-gray-500 font-normal">/yr</span></p>
        </div>
        <div className="bg-surface-700/50 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Active charges</p>
          <p className="text-xl font-bold text-gray-100 mt-0.5">{charges.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-customer breakdown */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">By customer</h3>
          <div className="divide-y divide-surface-700 border border-surface-700 rounded-lg overflow-hidden">
            {shown.map(cu => (
              <button key={cu.id} onClick={() => navigate(`/customers/${cu.id}?tab=billing`)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-700/50 transition-colors">
                <span className="text-gray-200 text-sm truncate">{cu.name}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {money(cu.monthly)}<span className="text-gray-600">/mo</span>
                  <span className="text-gray-600"> · </span>
                  <span className="text-accent">{money(cu.annual)}<span className="text-gray-600">/yr</span></span>
                </span>
              </button>
            ))}
          </div>
          {customers.length > 6 && (
            <button onClick={() => setShowAll(s => !s)} className="text-xs text-gray-500 hover:text-gray-300 mt-2">
              {showAll ? 'Show less' : `Show all ${customers.length}`}
            </button>
          )}
        </div>

        {/* Upcoming periodic charges */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Upcoming — next 3 months</h3>
          {upcoming.length === 0 ? (
            <p className="text-gray-600 text-sm px-1 py-2">No periodic charges due in the next 3 months.</p>
          ) : (
            <div className="divide-y divide-surface-700 border border-surface-700 rounded-lg overflow-hidden">
              {upcoming.map(({ c, due }) => (
                <button key={c.id} onClick={() => navigate(`/customers/${c.customer_id}?tab=billing`)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-700/50 transition-colors">
                  <span className="min-w-0">
                    <span className="text-gray-200 text-sm truncate block">{c.description}</span>
                    <span className="text-gray-600 text-xs truncate block">
                      {c.customer_name} · {chargeCadence(c)}
                    </span>
                  </span>
                  <span className="text-right whitespace-nowrap shrink-0">
                    <span className="text-blue-300 text-xs block">{nextDueLabel(due)}</span>
                    {c.amount != null && <span className="text-gray-400 text-xs">{money(c.amount)}<span className="text-gray-600">/{chargeUnit(c)}</span></span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uid = user?.id ? String(user.id) : null;
  const isBillingAdmin = user?.role === 'admin' || user?.role === 'biller';

  const stats = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => workOrdersApi.stats().then(r => r.data),
    staleTime: 30_000,
  });

  // ─── Section data ──────────────────────────────────────────────────────────
  // Tasks (keys start with 'tasks' so any task change refreshes them).
  const myTasks = useQuery({
    queryKey: ['tasks', 'dash', 'mine', uid],
    queryFn: () => tasksApi.list({ assignedTo: uid, status: 'active', sort: 'priority' }).then(r => r.data),
    enabled: !!uid, staleTime: 30_000,
  });
  const allTasks = useQuery({
    queryKey: ['tasks', 'dash', 'all'],
    queryFn: () => tasksApi.list({ status: 'active', sort: 'priority' }).then(r => r.data),
    staleTime: 30_000,
  });
  // Dashboard sections are "preview 5, show all" summaries — they aren't paged, so
  // each asks for the largest window the API allows rather than a default page.
  // The Work Orders page and Billing Queue are the authoritative paged views.
  const myDrafts = useQuery({
    queryKey: ['dash-my-drafts', uid],
    queryFn: () => workOrdersApi.list({ status: 'draft', technicianId: uid, limit: SECTION_LIMIT }).then(r => r.data),
    enabled: !!uid, staleTime: 30_000,
  });
  const followupWOs = useQuery({
    queryKey: ['dash-followup'],
    queryFn: () => workOrdersApi.list({ needsFollowup: 1, limit: SECTION_LIMIT }).then(r => r.data),
    staleTime: 30_000,
  });
  const incompleteOrders = useQuery({
    queryKey: ['dash-orders'],
    queryFn: () => orderLogApi.list({ incomplete: 1 }).then(r => r.data),
    staleTime: 30_000,
  });
  const pendingBilling = useQuery({
    queryKey: ['dash-pending-billing'],
    queryFn: () => workOrdersApi.list({ status: 'pending_billing', limit: SECTION_LIMIT }).then(r => r.data),
    enabled: isBillingAdmin, staleTime: 30_000,
  });
  const expiringLicenses = useQuery({
    queryKey: ['dash-licenses'],
    queryFn: () => licensesApi.expiring().then(r => r.data),
    staleTime: 60_000,
  });
  const licenseRenewals = useQuery({
    queryKey: ['dash-license-renewals'],
    queryFn: () => licensesApi.renewals().then(r => r.data),
    staleTime: 60_000,
  });
  const recurring = useQuery({
    queryKey: ['dash-recurring'],
    queryFn: () => recurringChargesApi.active().then(r => r.data),
    staleTime: 60_000,
  });

  const analytics = useQuery({
    queryKey: ['dash-analytics'],
    queryFn: () => analyticsApi.get().then(r => r.data),
    staleTime: 60_000,
  });
  const [scope, setScope] = useState(() => localStorage.getItem('app-dash-analytics-scope') || 'personal');
  const setScopePersist = (s) => { setScope(s); localStorage.setItem('app-dash-analytics-scope', s); };

  // "Licenses Expiring Soon" filter (all / device type / model / vendor), persisted.
  const [licenseFilter, setLicenseFilter] = useState(() => localStorage.getItem('app-dash-license-filter') || 'all');
  const setLicenseFilterPersist = (v) => { setLicenseFilter(v); localStorage.setItem('app-dash-license-filter', v); };
  const rawLicenses = expiringLicenses.data ?? [];
  const licenseOpts = licenseFilterOptions(rawLicenses);
  const validLicenseFilters = new Set(['all',
    ...licenseOpts.types.map(([t]) => `type:${t}`),
    ...licenseOpts.models.map(([m]) => `model:${m}`),
    ...licenseOpts.vendors.map(([v]) => `vendor:${v}`),
  ]);
  // Fall back to "all" if the saved filter no longer matches any current license.
  const effLicenseFilter = validLicenseFilters.has(licenseFilter) ? licenseFilter : 'all';
  const filteredLicensesQuery = {
    data: rawLicenses.filter(l => licenseMatches(l, effLicenseFilter)),
    isLoading: expiringLicenses.isLoading,
  };

  // Per-user section order (drag-to-reorder), persisted in localStorage.
  const [order, setOrder] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('app-dash-order')); return Array.isArray(v) ? v : []; }
    catch { return []; }
  });
  const handleReorder = (next) => {
    const ids = next.map(s => s.id);
    setOrder(ids);
    localStorage.setItem('app-dash-order', JSON.stringify(ids));
  };

  // ─── Row renderers ───────────────────────────────────────────────────────────
  const renderTask = (task) => {
    const f = taskFlags(task);
    return (
      <Row key={task.id} onClick={() => navigate(`/tasks?task=${task.id}`)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-200 text-sm truncate">
            <span className="font-mono text-gray-400 text-xs mr-2">{taskNumber(task.number)}</span>{task.title}
          </span>
          <StatusBadge task={task} className="text-xs shrink-0" />
        </div>
        <p className="text-gray-600 text-xs mt-0.5 truncate">
          {task.customer_name ?? 'Internal'}
          {task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}
          {task.due_date && <span className={f.overdue ? 'text-red-400' : f.due_soon ? 'text-amber-400' : ''}> · due {formatDate(task.due_date)}</span>}
          {!task.due_date && task.scheduled_date ? ` · ${formatDate(task.scheduled_date)}` : ''}
        </p>
      </Row>
    );
  };

  const renderWO = (wo) => (
    <Row key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-200 text-sm truncate">
          <span className="font-mono text-gray-400 text-xs mr-2">{woNum(wo.number)}</span>{wo.customer_name}
        </span>
        <span className={`badge ${STATUS_BADGE[wo.status]} text-xs shrink-0`}>{STATUS_LABEL[wo.status]}</span>
      </div>
      <p className="text-gray-600 text-xs mt-0.5 truncate">
        {formatDate(wo.work_date)}{wo.technicians ? ` · ${wo.technicians}` : ''}
      </p>
    </Row>
  );

  // Clear a WO's follow-up flag (works in any status) and drop it from the list.
  const resolveFollowup = async (wo) => {
    qc.setQueryData(['dash-followup'], (old = []) => old.filter(x => x.id !== wo.id));
    try { await workOrdersApi.resolveFollowup(wo.id); }
    catch { qc.invalidateQueries({ queryKey: ['dash-followup'] }); }
  };

  const renderFollowup = (wo) => (
    <div key={wo.id} className="px-4 py-2.5 flex items-center gap-2 hover:bg-surface-700/50 transition-colors">
      <button onClick={() => navigate(`/work-orders/${wo.id}`)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-200 text-sm truncate">
            <span className="font-mono text-gray-400 text-xs mr-2">{woNum(wo.number)}</span>{wo.customer_name}
          </span>
          <span className={`badge ${STATUS_BADGE[wo.status]} text-xs shrink-0`}>{STATUS_LABEL[wo.status]}</span>
        </div>
        <p className="text-gray-600 text-xs mt-0.5 truncate">
          {formatDate(wo.work_date)}{wo.technicians ? ` · ${wo.technicians}` : ''}
        </p>
      </button>
      <button onClick={() => resolveFollowup(wo)} title="Mark follow-up resolved"
        className="btn-ghost p-1.5 text-gray-500 hover:text-green-400 shrink-0"><Check size={15} /></button>
    </div>
  );

  const renderBilling = (wo) => {
    const total = parseFloat(wo.labor_total || 0) + parseFloat(wo.hardware_total || 0) + parseFloat(wo.proposals_total || 0);
    return (
      <Row key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}?from=billing`)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-200 text-sm truncate">
            <span className="font-mono text-gray-400 text-xs mr-2">{woNum(wo.number)}</span>{wo.customer_name}
          </span>
          {total > 0 && <span className="text-accent font-semibold text-sm shrink-0">${total.toFixed(2)}</span>}
        </div>
        <p className="text-gray-600 text-xs mt-0.5 truncate">
          {formatDate(wo.work_date)}{wo.technicians ? ` · ${wo.technicians}` : ''}
        </p>
      </Row>
    );
  };

  const renderOrder = (o) => (
    <Row key={o.id} onClick={() => navigate('/orders')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-200 text-sm truncate">{o.vendor}</span>
        <span className={`badge ${ORDER_BADGE[o.status] || ''} text-xs shrink-0 capitalize`}>{o.status}</span>
      </div>
      <p className="text-gray-600 text-xs mt-0.5 truncate">
        {o.customer_name || 'For stock'}
        {Array.isArray(o.items) && o.items.length ? ` · ${o.items.length} item${o.items.length !== 1 ? 's' : ''}` : ''}
        {o.po_number ? ` · PO ${o.po_number}` : ''}
      </p>
    </Row>
  );

  const renderLicense = (l) => {
    const b = renewalBadge(l.renewal_date);
    return (
      <Row key={l.id} onClick={() => navigate(`/customers/${l.customer_id}?tab=licensing`)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-200 text-sm truncate">{l.program_name}</span>
          <span className={`badge ${b.cls} text-xs shrink-0`}>{b.label}</span>
        </div>
        <p className="text-gray-600 text-xs mt-0.5 truncate">
          {l.customer_name}{l.vendor ? ` · ${l.vendor}` : ''} · expires {formatDate(l.renewal_date)}
        </p>
      </Row>
    );
  };

  // Auto-renewing subscriptions: next renewal date (computed server-side), interval, card.
  const renderRenewal = (l) => (
    <Row key={l.id} onClick={() => navigate(`/customers/${l.customer_id}?tab=licensing`)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-200 text-sm truncate">{l.program_name}</span>
        <span className="badge bg-blue-900/30 text-blue-300 text-xs shrink-0">
          {intervalLabel(l.renewal_interval, l.renewal_interval_count)}
        </span>
      </div>
      <p className="text-gray-600 text-xs mt-0.5 truncate">
        {l.customer_name} · renews {parseDate(l.next_renewal).toLocaleDateString()}
        {l.payment_method ? ` · ${l.payment_method}` : ''}
      </p>
    </Row>
  );

  // Section definitions; `order` (above) controls their arrangement, with any new/
  // unsaved sections appended in their natural order.
  const SECTIONS = [
    // 'my-backlog' / 'all-backlog' keep their old ids so saved section orders still apply.
    { id: 'my-backlog',      title: 'My Tasks',                      icon: ListChecks,    accent: true, query: myTasks,          emptyText: 'No tasks assigned to you.',        renderItem: renderTask },
    { id: 'my-drafts',       title: 'My Draft Work Orders',          icon: ClipboardList, accent: true, query: myDrafts,         emptyText: 'No drafts of yours.',              renderItem: renderWO },
    { id: 'followup',        title: 'Work Orders Needing Follow-up', icon: AlertCircle,                 query: followupWOs,      emptyText: 'No follow-ups flagged.',           renderItem: renderFollowup },
    isBillingAdmin && { id: 'pending-billing', title: 'Pending Billing', icon: Briefcase, accent: true, query: pendingBilling,   emptyText: 'Nothing pending billing.',         renderItem: renderBilling },
    { id: 'all-backlog',     title: 'All Active Tasks',              icon: ListChecks,                  query: allTasks,         emptyText: 'No active tasks.',                 renderItem: renderTask },
    { id: 'orders',          title: 'Open Orders',                   icon: Package,                     query: incompleteOrders, emptyText: 'No orders awaiting receipt.',      renderItem: renderOrder },
    { id: 'licenses',        title: 'Licenses Expiring Soon',        icon: BadgeCheck,                  query: filteredLicensesQuery, emptyText: effLicenseFilter === 'all' ? 'No manual licenses with an expiration date.' : 'No licenses match this filter.', renderItem: renderLicense,
      controls: rawLicenses.length > 0 ? <LicenseFilter items={rawLicenses} value={effLicenseFilter} onChange={setLicenseFilterPersist} /> : null },
    { id: 'license-renewals',title: 'License Renewals',              icon: RefreshCw,                   query: licenseRenewals,  emptyText: 'No auto-renewing subscriptions.',  renderItem: renderRenewal },
  ].filter(Boolean);

  const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
  const orderedSections = [
    ...order.filter(id => byId[id]),
    ...SECTIONS.filter(s => !order.includes(s.id)).map(s => s.id),
  ].map(id => byId[id]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-100">Welcome back, {user?.full_name?.split(' ')[0]}.</h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="Open Work Orders" value={stats.data?.open_work_orders} icon={ClipboardList} accent
          onClick={() => navigate('/work-orders')} />
        <StatCard label="Pending Billing" value={stats.data?.pending_billing} icon={AlertCircle}
          onClick={() => navigate('/work-orders?status=pending_billing')} />
        <StatCard label="Active Customers" value={stats.data?.active_customers} icon={Users}
          onClick={() => navigate('/customers')} />
      </div>

      {/* Expandable, drag-to-reorder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <DragList
          items={orderedSections}
          onReorder={handleReorder}
          itemClassName="self-start"
          renderItem={(s, handle) => (
            <DashSection
              id={s.id} title={s.title} icon={s.icon} accent={s.accent}
              query={s.query} emptyText={s.emptyText} renderItem={s.renderItem} handle={handle}
              controls={s.controls}
            />
          )}
        />
      </div>

      {/* Recurring revenue */}
      {recurring.data?.length > 0 && <RecurringRevenueCard charges={recurring.data} navigate={navigate} />}

      {/* Analytics */}
      {analytics.data && (() => {
        const a = analytics.data;
        const labels = a.weeks.map(weekLabel);
        const hours = a.hours[scope], wos = a.woSubmitted[scope], orders = a.orders[scope], spend = a.spend[scope];
        const billed = a.billed?.[scope] ?? [], collected = a.collected?.[scope] ?? [];
        const status = a.status[scope];
        const last = (arr) => arr[arr.length - 1] ?? 0;
        const money = (v) => `$${Math.round(v).toLocaleString()}`;
        const hoursFmt = (v) => String(Math.round(v * 10) / 10);
        return (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-gray-200 font-semibold">
                Analytics <span className="text-gray-600 text-sm font-normal">· last 8 weeks</span>
              </h2>
              <div className="inline-flex rounded-lg bg-surface-700 p-0.5">
                {[['personal', 'Just me'], ['company', 'Company']].map(([s, label]) => (
                  <button key={s} onClick={() => setScopePersist(s)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      scope === s ? 'bg-brand text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}>{label}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <MiniStat label="Hours this week" value={hoursFmt(last(hours))} />
              <MiniStat label="WOs to billing this week" value={last(wos)} />
              <MiniStat label="Orders this week" value={last(orders)} />
              <MiniStat label="Order spend this week" value={money(last(spend))} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ChartCard title="Hours in work orders / week">
                <MiniBars values={hours} labels={labels} color="bg-brand" fmt={hoursFmt} />
              </ChartCard>
              <ChartCard title="Work orders sent to billing / week">
                <MiniBars values={wos} labels={labels} color="bg-amber-500" />
              </ChartCard>
              <ChartCard title="Orders placed / week">
                <MiniBars values={orders} labels={labels} color="bg-blue-500" />
              </ChartCard>
              <ChartCard title="Money spent on orders / week">
                <MiniBars values={spend} labels={labels} color="bg-green-500" fmt={money} />
              </ChartCard>
              <ChartCard title="Revenue billed / week">
                <MiniBars values={billed} labels={labels} color="bg-accent" fmt={money} />
              </ChartCard>
              <ChartCard title="Revenue collected / week">
                <MiniBars values={collected} labels={labels} color="bg-green-600" fmt={money} />
              </ChartCard>
              <ChartCard title="Work orders by status">
                <StatusBars counts={status} />
              </ChartCard>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
