import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, ArrowRight } from 'lucide-react';
import { workOrdersApi } from '../../api/workOrders.js';
import { Modal } from '../ui/Modal.jsx';
import { formatDate, todayInput } from '../../utils/date.js';
import { fetchAllPages } from '../../hooks/useInfiniteList.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }
const STATUS_LABEL = { draft: 'Draft', pending_billing: 'Pending Billing' };
const EDITABLE = ['draft', 'pending_billing'];

// Link a task into a work order as a new section.
// `description` → Work Performed, `internalNotes` → Internal Notes (both plain text).
// Pick one of the customer's editable work orders, or create a brand-new one.
// `onLinked(workOrderId)` runs before navigating (the task records it in its history).
export function LinkToWorkOrder({ customerId, customerName, description, internalNotes, sourceLabel, onLinked, onClose }) {
  const navigate = useNavigate();
  const [choice, setChoice] = useState('');     // woId | '__new__'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The editable work orders are filtered client-side, so a partial fetch could
  // hide a valid target behind a page of already-invoiced ones — pull them all.
  const { data: wos = [], isLoading } = useQuery({
    queryKey: ['work-orders', 'for-customer', customerId],
    queryFn: () => fetchAllPages(({ limit, offset }) => workOrdersApi.list({ customerId, limit, offset })),
    enabled: !!customerId,
  });
  const editable = wos.filter(w => EDITABLE.includes(w.status));

  const confirm = async () => {
    if (!choice) return;
    setBusy(true);
    setError('');
    try {
      let targetId;
      if (choice === '__new__') {
        const { data } = await workOrdersApi.create({
          customer_id: customerId,
          work_date: todayInput(),
          description,
          internal_notes: internalNotes,
        });
        targetId = data.id;
      } else {
        await workOrdersApi.sections.add(choice, { description, internal_notes: internalNotes });
        targetId = choice;
      }
      if (onLinked) await Promise.resolve(onLinked(targetId)).catch(() => {});
      navigate(`/work-orders/${targetId}`);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not link to a work order.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add to Work Order" size="md">
      <div className="space-y-4">
        {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

        <div className="bg-surface-700 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">{sourceLabel ?? 'This item'} → a new work section</p>
          <p className="text-gray-200 text-sm font-medium">{description || '(no description)'}</p>
          {customerName && <p className="text-gray-500 text-xs mt-1">{customerName}</p>}
        </div>

        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">Choose a work order</p>
          {isLoading ? (
            <p className="text-gray-600 text-sm">Loading…</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {editable.map(w => (
                <button key={w.id} type="button" onClick={() => setChoice(w.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                    choice === w.id ? 'border-brand bg-brand/10' : 'border-surface-600 hover:bg-surface-700'
                  }`}>
                  <ClipboardList size={15} className="text-gray-500 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="text-gray-200 text-sm font-mono">{woNum(w.number)}</span>
                    <span className="text-gray-500 text-xs ml-2">{formatDate(w.work_date)}</span>
                  </span>
                  <span className="badge bg-surface-600 text-gray-300 text-xs">{STATUS_LABEL[w.status] ?? w.status}</span>
                </button>
              ))}
              {editable.length === 0 && (
                <p className="text-gray-600 text-sm px-1 py-2">No open work orders for this customer yet.</p>
              )}

              <button type="button" onClick={() => setChoice('__new__')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                  choice === '__new__' ? 'border-brand bg-brand/10' : 'border-dashed border-surface-500 hover:bg-surface-700'
                }`}>
                <Plus size={15} className="text-accent shrink-0" />
                <span className="text-gray-200 text-sm">Create a new work order</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={!choice || busy}
            className="btn-primary flex items-center gap-1.5">
            {busy ? 'Adding…' : <>Add section <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
