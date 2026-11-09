import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, PackageOpen, PackageCheck } from 'lucide-react';
import { workOrdersApi } from '../../api/workOrders.js';
import { Modal } from '../ui/Modal.jsx';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

// Voiding a work order — used from both the Billing Queue row and the WO detail page.
//
// Two things have to be decided at void time, which is why this is a modal and not a
// confirm(): what happens to the parts, and (optionally) why it's being voided.
//
// `wo` may be a list row (id + number only); the full record is fetched here so the
// dialog can show exactly which inventory-linked parts would go back on the shelf.
export function VoidWorkOrderModal({ wo, open, onClose, onVoided }) {
  const [returnInventory, setReturnInventory] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // The WO detail page already has the full record — only the Billing Queue's list
  // row needs fetching, so don't re-request what the caller handed us.
  const needsFetch = !!wo?.id && open && !wo.sections;
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['work-orders', wo?.id, 'void-preview'],
    queryFn: () => workOrdersApi.get(wo.id).then(r => r.data),
    enabled: needsFetch,
  });
  const full = wo?.sections ? wo : fetched;

  // Only inventory-linked lines can be returned — hand-typed parts were never tracked
  // in shared inventory, so there is nothing to give back for them.
  const linkedParts = (full?.sections ?? [])
    .flatMap(s => s.items ?? [])
    .filter(i => i.inventory_item_id);
  const linkedQty = linkedParts.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0);
  const untrackedCount = (full?.sections ?? []).flatMap(s => s.items ?? []).length - linkedParts.length;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await workOrdersApi.void(wo.id, { return_inventory: returnInventory, reason });
      onVoided?.(data);
      onClose();
      if (data?.inventory_warning) {
        alert(`Work order voided, but shared inventory could not be updated:\n\n${data.inventory_warning}`);
      }
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to void this work order.');
    } finally { setSaving(false); }
  };

  const choice = (value, icon, title, body) => (
    <button
      type="button"
      onClick={() => setReturnInventory(value)}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        returnInventory === value
          ? 'border-brand bg-brand/10'
          : 'border-surface-600 bg-surface-700/40 hover:border-surface-500'
      }`}
    >
      <span className="flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 ${returnInventory === value ? 'text-brand' : 'text-gray-500'}`}>{icon}</span>
        <span>
          <span className="block text-sm font-medium text-gray-200">{title}</span>
          <span className="block text-xs text-gray-500 mt-0.5">{body}</span>
        </span>
      </span>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Void ${wo ? woNum(wo.number) : 'Work Order'}`} size="md">
      <div className="space-y-4">
        {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

        <p className="text-sm text-gray-400">
          This removes {wo ? woNum(wo.number) : 'the work order'} from the <span className="text-gray-300">Billing Queue</span>.
          It stays on the Work Orders list under a red <span className="text-red-400 font-medium">Voided</span> badge with
          all its sections, parts and photos intact, and can be un-voided later.
        </p>

        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">What should happen to the parts?</p>
          <div className="space-y-2">
            {choice(false, <PackageCheck size={16} />, 'Keep inventory as-is',
              'The parts really were used or are already gone. Nothing moves in shared inventory.')}
            {choice(true, <PackageOpen size={16} />, 'Return all parts to inventory',
              isLoading
                ? 'Checking this work order’s parts…'
                : linkedParts.length === 0
                  ? 'No inventory-linked parts on this work order — nothing would move.'
                  : `Puts ${linkedQty} unit${linkedQty === 1 ? '' : 's'} across ${linkedParts.length} line${linkedParts.length === 1 ? '' : 's'} back on the shelf.`)}
          </div>
          {returnInventory && linkedParts.length > 0 && (
            <ul className="mt-2 rounded-lg bg-surface-700/40 border border-surface-600 p-2.5 space-y-1 max-h-40 overflow-y-auto">
              {linkedParts.map(i => (
                <li key={i.id} className="text-xs text-gray-400 flex justify-between gap-3">
                  <span className="truncate">{i.description}</span>
                  <span className="text-gray-300 shrink-0">×{parseFloat(i.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          {returnInventory && untrackedCount > 0 && (
            <p className="text-xs text-amber-400/80 mt-1.5">
              {untrackedCount} hand-typed part{untrackedCount === 1 ? '' : 's'} on this work order {untrackedCount === 1 ? 'is' : 'are'} not
              linked to inventory, so {untrackedCount === 1 ? 'it' : 'they'} can't be returned.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Reason <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <textarea
            className="input resize-none" rows={2} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Job cancelled, duplicate work order, written off…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="button" onClick={submit} disabled={saving}
            className="px-3 py-1.5 rounded-sm text-sm font-medium bg-red-900/50 text-red-300 hover:bg-red-800/60 transition-colors flex items-center gap-1.5"
          >
            <Ban size={14} /> {saving ? 'Voiding…' : 'Void Work Order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
