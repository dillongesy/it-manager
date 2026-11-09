import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, ClipboardList, Search } from 'lucide-react';
import api from '../../api/client.js';
import { workOrdersApi } from '../../api/workOrders.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { LoadMore } from '../ui/LoadMore.jsx';
import { formatDate, todayInput } from '../../utils/date.js';
import { useInfiniteList } from '../../hooks/useInfiniteList.js';
import { WO_STATUS_BADGE as STATUS_BADGE, WO_STATUS_LABEL as STATUS_LABEL } from '../../utils/woStatus.js';
import { woLocationLabel } from '../../utils/woLocation.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

export function WorkOrdersTab({ customerId }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // A long-standing customer accumulates far more work orders than one page —
  // page through their full history rather than stopping at the API's first page.
  const woQuery = useInfiniteList({
    queryKey: ['work-orders', 'customer', customerId, search],
    fetchPage: ({ limit, offset }) =>
      workOrdersApi.list({ customerId, search: search || undefined, limit, offset }),
  });
  const workOrders = woQuery.rows;
  // Every row is this customer, so a single-office customer gets no Branch column.
  const showBranch = workOrders.some(wo => wo.customer_has_branches);

  const newWO = async () => {
    const { data } = await api.post('/work-orders', {
      customer_id: customerId,
      work_date: todayInput(),
    });
    navigate(`/work-orders/${data.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input pl-9 text-sm" placeholder={showBranch ? 'Search WO #, branch, work, or parts…' : 'Search WO #, work, or parts…'}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={newWO} className="btn-primary flex items-center gap-2 text-sm shrink-0">
          <Plus size={14} /> New Work Order
        </button>
      </div>

      {workOrders.length === 0 ? (
        <EmptyState icon={ClipboardList} title={search ? 'No matches' : 'No work orders'}
          description={search ? 'Try a different search.' : 'Create the first work order for this customer.'} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600">
                <th className="text-left text-gray-500 font-medium px-4 py-3">#</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3">Date</th>
                {showBranch && <th className="text-left text-gray-500 font-medium px-4 py-3">Branch</th>}
                <th className="text-left text-gray-500 font-medium px-4 py-3 hidden md:table-cell">Technicians</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3">Status</th>
                <th className="text-right text-gray-500 font-medium px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {workOrders.map(wo => {
                const total = parseFloat(wo.labor_total || 0) + parseFloat(wo.hardware_total || 0) + parseFloat(wo.proposals_total || 0);
                return (
                  <tr key={wo.id} onClick={() => navigate(`/work-orders/${wo.id}`)}
                    className="hover:bg-surface-700/50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{woNum(wo.number)}</td>
                    <td className="px-4 py-3 text-gray-300">{formatDate(wo.work_date)}</td>
                    {showBranch && (
                      <td className={`px-4 py-3 ${wo.location_name ? 'text-gray-300' : 'text-gray-500'}`}>
                        {woLocationLabel(wo) ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">{wo.technicians || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_BADGE[wo.status]}`}>{STATUS_LABEL[wo.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
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
    </div>
  );
}
