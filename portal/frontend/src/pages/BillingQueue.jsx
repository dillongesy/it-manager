import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Briefcase, Search, Eye } from 'lucide-react';
import { workOrdersApi } from '../api/workOrders.js';
import { printWorkOrder } from '../lib/printWorkOrder.js';
import { VoidWorkOrderModal } from '../components/work/VoidWorkOrder.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { LoadMore } from '../components/ui/LoadMore.jsx';
import { formatDate } from '../utils/date.js';
import { useInfiniteList } from '../hooks/useInfiniteList.js';
import { woLocationLabel } from '../utils/woLocation.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

function money(v) {
  const n = parseFloat(v || 0);
  return n > 0 ? `$${n.toFixed(2)}` : '—';
}

// Each action: { label, className, run(id), confirm?(wo) → string|null, open?(wo) }.
// Returning a string from confirm() prompts before running (used for reversals). An action with open() hands the row off to a dialog instead of
// firing an API call - voiding needs choices made before it happens.
function WORow({ wo, actions = [] }) {
  const navigate = useNavigate();
  const [acting, setActing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [err, setErr] = useState('');

  const total = parseFloat(wo.labor_total || 0) + parseFloat(wo.hardware_total || 0) + parseFloat(wo.proposals_total || 0);
  const branch = woLocationLabel(wo);

  const runAction = async (e, action) => {
    e.stopPropagation();
    if (action.open) { action.open(wo); return; }
    const msg = action.confirm?.(wo);
    if (msg && !confirm(msg)) return;
    setActing(true);
    setErr('');
    try { await action.run(wo.id); }
    catch (e2) { setErr(e2.response?.data?.error ?? 'Action failed.'); }
    finally { setActing(false); }
  };

  // Open the simple/printable view in a new tab (no auto-print). Needs the full WO
  // (sections, services, totals), which list rows don't carry - fetch it on demand.
  const openSimpleView = async (e) => {
    e.stopPropagation();
    setViewing(true);
    setErr('');
    try {
      const { data } = await workOrdersApi.get(wo.id);
      printWorkOrder(data, [], { autoPrint: false });
    } catch (e2) { setErr(e2.response?.data?.error ?? 'Could not open view.'); }
    finally { setViewing(false); }
  };

  // Same buttons in two places: their own column from `sm` up, and tucked under the
  // customer name on a phone (a trailing action column doesn't fit at 390px).
  const actionButtons = (
    <>
      {err && <span className="text-red-400 text-xs">{err}</span>}
      <button
        onClick={openSimpleView}
        disabled={viewing}
        title="Open a simple, printable view of this work order in a new tab"
        className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-xs font-medium bg-surface-600 text-gray-300 hover:bg-surface-500 transition-colors"
      >
        <Eye size={12} /> {viewing ? '…' : 'Simple View'}
      </button>
      {actions.map(action => (
        <button
          key={action.label}
          onClick={(e) => runAction(e, action)}
          disabled={acting}
          className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors ${action.className}`}
        >
          {acting ? '…' : action.label}
        </button>
      ))}
    </>
  );

  return (
    <tr
      onClick={() => navigate(`/work-orders/${wo.id}?from=billing`)}
      className="hover:bg-surface-700/50 cursor-pointer transition-colors group"
    >
      <td className="px-4 py-3 font-mono text-gray-400 text-xs whitespace-nowrap hidden sm:table-cell">{woNum(wo.number)}</td>
      <td className="px-4 py-3 font-medium text-gray-200">
        {wo.customer_name}
        {/* Branch has its own column from md up; below that it rides under the name. */}
        {branch && <span className="md:hidden block text-xs font-normal text-gray-400 mt-0.5">{branch}</span>}
        <span className="sm:hidden block text-xs font-normal text-gray-500 mt-0.5">
          <span className="font-mono">{woNum(wo.number)}</span> ·{' '}
          {wo.submitted_at ? new Date(wo.submitted_at).toLocaleDateString() : formatDate(wo.work_date)}
        </span>
        <div className="sm:hidden flex flex-wrap items-center gap-2 mt-2 font-normal" onClick={e => e.stopPropagation()}>
          {actionButtons}
        </div>
      </td>
      <td className={`px-4 py-3 text-sm hidden md:table-cell ${wo.location_name ? 'text-gray-300' : 'text-gray-500'}`}>
        {branch ?? '—'}
      </td>
      <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap hidden sm:table-cell">
        {wo.submitted_at ? new Date(wo.submitted_at).toLocaleDateString() : formatDate(wo.work_date)}
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell max-w-[200px]">
        <span className="truncate block">{wo.technicians || '—'}</span>
      </td>
      <td className="px-4 py-3 text-gray-300 text-sm hidden md:table-cell">
        {wo.labor_hours ? `${wo.labor_hours}h` : '—'}
      </td>
      <td className="px-4 py-3 text-gray-300 text-sm hidden md:table-cell">
        {money(wo.hardware_total)}
      </td>
      <td className="px-4 py-3 font-semibold text-accent whitespace-nowrap">
        {total > 0 ? `$${total.toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {actionButtons}
        </div>
      </td>
    </tr>
  );
}

function QueueTable({ workOrders, actions, emptyText }) {
  if (workOrders.length === 0) {
    return <p className="text-gray-600 text-sm px-4 py-8 text-center">{emptyText}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-surface-600">
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden sm:table-cell">#</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs">Customer</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden md:table-cell">Branch</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden sm:table-cell">Submitted</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden lg:table-cell">Techs</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden md:table-cell">Labor</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs hidden md:table-cell">Parts</th>
          <th className="text-left text-gray-500 font-medium px-4 py-3 text-xs">Total</th>
          <th className="px-4 py-3 w-56 hidden sm:table-cell" />
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-700">
        {workOrders.map(wo => (
          <WORow key={wo.id} wo={wo} actions={actions} />
        ))}
      </tbody>
    </table>
  );
}

export function BillingQueue() {
  const [tab, setTab] = useState('pending');
  const [voiding, setVoiding] = useState(null);   // WO row awaiting the void dialog
  const qc = useQueryClient();

  // Each tab loads its full queue, not just the API's first page.
  const [paidSearch, setPaidSearch] = useState('');

  const pendingQuery = useInfiniteList({
    queryKey: ['work-orders', 'queue', 'pending_billing'],
    fetchPage: ({ limit, offset }) => workOrdersApi.list({ status: 'pending_billing', limit, offset }),
    staleTime: 15_000,
  });
  const invoicedQuery = useInfiniteList({
    queryKey: ['work-orders', 'queue', 'invoiced'],
    fetchPage: ({ limit, offset }) => workOrdersApi.list({ status: 'invoiced', limit, offset }),
    staleTime: 15_000,
  });
  // Paid invoices are an archive - searchable across customer, WO #, description, and parts.
  const paidQuery = useInfiniteList({
    queryKey: ['work-orders', 'queue', 'paid', paidSearch],
    fetchPage: ({ limit, offset }) =>
      workOrdersApi.list({ status: 'paid', search: paidSearch || undefined, limit, offset }),
    staleTime: 15_000,
  });

  const pending = pendingQuery.rows;
  const invoiced = invoicedQuery.rows;
  const paid = paidQuery.rows;

  // Counts and dollar totals for the summary cards come from the server across ALL
  // matching work orders - summing only the loaded rows would understate the queue.
  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['work-orders', 'queue-summary'],
    queryFn: () => workOrdersApi.queueSummary().then(r => r.data),
    staleTime: 15_000,
  });
  const pendingSummary  = summary?.pending_billing ?? { count: 0, total: 0 };
  const invoicedSummary = summary?.invoiced        ?? { count: 0, total: 0 };

  const refetchPending  = () => { pendingQuery.refetch();  refetchSummary(); };
  const refetchInvoiced = () => { invoicedQuery.refetch(); refetchSummary(); };
  const refetchPaid     = () => { paidQuery.refetch();     refetchSummary(); };

  const markInvoiced = async (id) => {
    await workOrdersApi.invoice(id);
    refetchPending();
    refetchInvoiced();
    qc.invalidateQueries(['dashboard-stats']);
  };

  const markPaid = async (id) => {
    await workOrdersApi.pay(id);
    refetchInvoiced();
    refetchPaid();
    qc.invalidateQueries(['dashboard-stats']);
  };

  // Reverse moves - recover from an accidental/incorrect transition.
  const revertToPending = async (id) => {
    await workOrdersApi.revertInvoice(id);
    refetchPending();
    refetchInvoiced();
    qc.invalidateQueries(['dashboard-stats']);
  };

  const revertToInvoiced = async (id) => {
    await workOrdersApi.revertPay(id);
    refetchInvoiced();
    refetchPaid();
    qc.invalidateQueries(['dashboard-stats']);
  };

  // Action button sets per tab. Backward moves prompt for confirmation.
  const pendingActions = [
    { label: 'Void', className: 'bg-red-900/40 text-red-300 hover:bg-red-800/60', open: setVoiding },
    { label: 'Mark Invoiced', className: 'bg-blue-900/40 text-blue-300 hover:bg-blue-800/60', run: markInvoiced },
  ];
  const invoicedActions = [
    { label: '← Back to Pending', className: 'bg-amber-900/40 text-amber-300 hover:bg-amber-800/60', run: revertToPending,
      confirm: (wo) => `Move ${woNum(wo.number)} back to Pending Billing? This undoes the invoiced status.` },
    { label: 'Mark Paid', className: 'bg-green-900/40 text-green-300 hover:bg-green-800/60', run: markPaid },
  ];
  const paidActions = [
    { label: '← Back to Invoiced', className: 'bg-blue-900/40 text-blue-300 hover:bg-blue-800/60', run: revertToInvoiced,
      confirm: (wo) => `Move ${woNum(wo.number)} back to Invoiced? This undoes the paid status.` },
  ];

  // Counts are the server-side totals, not "how many are loaded" - the badge has to
  // be the real size of the queue.
  const tabs = [
    { id: 'pending',  label: 'Pending Billing', count: pendingQuery.total },
    { id: 'invoiced', label: 'Invoiced',         count: invoicedQuery.total },
    { id: 'paid',     label: 'Paid',             count: paidQuery.total },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Billing Queue</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {pendingSummary.count.toLocaleString()} pending · {invoicedSummary.count.toLocaleString()} invoiced
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Pending Billing</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{pendingSummary.count.toLocaleString()}</p>
              {pendingSummary.count > 0 && (
                <p className="text-gray-500 text-xs mt-0.5">
                  ${pendingSummary.total.toFixed(2)} total
                </p>
              )}
            </div>
            <div className="p-2 rounded-lg bg-amber-900/20">
              <Briefcase size={18} className="text-amber-400" />
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Invoiced (Unpaid)</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{invoicedSummary.count.toLocaleString()}</p>
              {invoicedSummary.count > 0 && (
                <p className="text-gray-500 text-xs mt-0.5">
                  ${invoicedSummary.total.toFixed(2)} outstanding
                </p>
              )}
            </div>
            <div className="p-2 rounded-lg bg-blue-900/20">
              <DollarSign size={18} className="text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-0 border-b border-surface-600 mb-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 sm:px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === t.id
                ? 'border-brand text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                tab === t.id ? 'bg-brand/30 text-gray-100' : 'bg-surface-600 text-gray-400'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Paid archive search */}
      {tab === 'paid' && (
        <div className="relative max-w-sm mt-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input pl-9" placeholder="Search paid invoices (customer, branch, WO #)…"
            value={paidSearch} onChange={e => setPaidSearch(e.target.value)} />
        </div>
      )}

      {/* Queue table */}
      <div className={`card overflow-x-auto ${tab === 'paid' ? 'mt-3' : 'rounded-t-none border-t-0'}`}>
        {tab === 'pending' && (
          <>
            <QueueTable
              workOrders={pending}
              actions={pendingActions}
              emptyText="No work orders pending billing."
            />
            <LoadMore query={pendingQuery} loaded={pending.length} total={pendingQuery.total} noun="work order" />
          </>
        )}
        {tab === 'invoiced' && (
          <>
            <QueueTable
              workOrders={invoiced}
              actions={invoicedActions}
              emptyText="No invoiced work orders."
            />
            <LoadMore query={invoicedQuery} loaded={invoiced.length} total={invoicedQuery.total} noun="work order" />
          </>
        )}
        {tab === 'paid' && (
          <>
            <QueueTable
              workOrders={paid}
              actions={paidActions}
              emptyText={paidSearch ? 'No paid invoices match your search.' : 'No paid invoices yet.'}
            />
            <LoadMore query={paidQuery} loaded={paid.length} total={paidQuery.total} noun="paid invoice" />
          </>
        )}
      </div>

      {/* Voiding drops the WO out of this queue entirely - refresh the list and the
          summary cards so the count and dollar total stop including it. */}
      {/* Mounted only while voiding, so each dialog starts with fresh choices. */}
      {voiding && <VoidWorkOrderModal
        wo={voiding}
        open
        onClose={() => setVoiding(null)}
        onVoided={() => { refetchPending(); qc.invalidateQueries({ queryKey: ['work-orders'] }); qc.invalidateQueries(['dashboard-stats']); }}
      />}
    </div>
  );
}
