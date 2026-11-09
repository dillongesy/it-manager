import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { integrationsApi } from '../../api/integrations.js';
import { formatDate } from '../../utils/date.js';
import { ActionChip, ResultSection, SetupSteps, Env } from './SyncPreview.jsx';

// "Check Dell warranties" on a customer's Devices tab: every Dell device with a service
// tag, what Dell says its warranty is, and which ones would change. Tick → Apply.
// (The ConnectWise import also fills warranties as it goes; this covers devices typed in
// by hand or imported before the Dell key was set up.)

const fmt = (d) => (d ? formatDate(d) : '—');

export function DellWarrantySync({ customerId, onClose, onApplied }) {
  const qc = useQueryClient();
  const key = ['dell-warranty', customerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => integrationsApi.dell.plan(customerId).then(r => r.data.rows),
    retry: false,
  });
  const [selected, setSelected] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const rows = q.data ?? [];
  // Pre-tick everything that would actually change.
  useEffect(() => {
    setSelected(new Set(rows.filter(r => r.action === 'fill' || r.action === 'update').map(r => r.device_id)));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await integrationsApi.dell.plan(customerId, true);
      qc.setQueryData(key, data.rows);
    } catch { /* the query's error state shows it */ }
    finally { setRefreshing(false); }
  };

  const selectable = rows.filter(r => r.expires);
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = selectable.length > 0 && selectable.every(r => selected.has(r.device_id));

  const apply = async () => {
    setApplying(true); setError('');
    try {
      const { data } = await integrationsApi.dell.apply(customerId, [...selected]);
      setResult(data);
      onApplied();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Could not save the warranties.');
    } finally { setApplying(false); }
  };

  if (q.error?.response?.status === 503) {
    return (
      <SetupSteps title="Dell warranty lookup isn't connected yet" onClose={onClose} steps={[
        <>At <b>techdirect.dell.com</b>: <b>APIs → Request API Key</b>, choose the <b>Warranty API</b>, "Internal to our company". Dell approves it in a few business days.</>,
        <>Once approved, open <b>APIs → Manage API Keys</b>. The <b>API Key</b> is the Client ID; the value in brackets beside it is the Client Secret.</>,
        <>In the Portal backend <Env>.env</Env>, set <Env>DELL_CLIENT_ID</Env> and <Env>DELL_CLIENT_SECRET</Env>, then restart the backend.</>,
      ]} />
    );
  }

  if (result) {
    return (
      <div className="space-y-4">
        <ResultSection title="Updated" rows={result.updated} className="text-amber-400"
          render={r => <>{r.name} <span className="text-gray-500">— {fmt(r.from)} → {fmt(r.to)}{r.coverage ? ` (${r.coverage})` : ''}</span></>} />
        <ResultSection title="Already correct" rows={result.unchanged} className="text-gray-400" render={r => r.name} />
        <ResultSection title="Skipped" rows={result.skipped} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>} />
        {!result.updated.length && !result.unchanged.length && !result.skipped.length && <p className="text-sm text-gray-500">Nothing to do.</p>}
        <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(error || (q.error && q.error.response?.status !== 503)) && (
        <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error || q.error.response?.data?.error || 'Could not reach Dell.'}</p>
      )}

      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-400 flex-1">
          Dell devices are found by manufacturer or model ("Dell OptiPlex…") and looked up by service tag.
        </p>
        <button type="button" onClick={refresh} title="Ask Dell again" className="btn-ghost p-2 shrink-0">
          <RefreshCw size={15} className={refreshing || q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {q.isLoading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Asking Dell…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 text-sm py-6 text-center">No Dell devices on this customer.</p>
      ) : (
        <div className="card overflow-hidden">
          <label className="flex items-center gap-3 px-3 py-2.5 border-b border-surface-600 bg-surface-700/50 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={allChecked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map(r => r.device_id)))} />
            <span className="text-sm text-gray-200 font-medium">Select all</span>
            <span className="text-xs text-gray-500 ml-auto">{selected.size} of {rows.length} selected</span>
          </label>
          <div className="divide-y divide-surface-600 sm:max-h-[50vh] sm:overflow-y-auto">
            {rows.map(r => (
              <label key={r.device_id} className={`flex items-start gap-3 px-3 py-2.5 ${r.expires ? 'cursor-pointer' : 'opacity-70'}`}>
                <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" disabled={!r.expires}
                  checked={selected.has(r.device_id)} onChange={() => toggle(r.device_id)} />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-gray-100 font-medium break-all">{r.name}</span>
                    {r.tag && <span className="text-xs text-gray-500 font-mono">{r.tag}</span>}
                    <ActionChip action={r.action} />
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {r.expires
                      ? <>Dell: <span className="text-gray-300">{fmt(r.expires)}</span>{r.coverage && ` · ${r.coverage}`}{r.product && ` · ${r.product}`}
                          {r.action === 'update' && <> · on file: <span className="line-through">{fmt(r.current)}</span></>}</>
                      : r.action === 'no_tag' ? 'Add the service tag to look this one up.'
                      : 'Dell has no warranty record for this service tag — check it for a typo.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={apply} disabled={!selected.size || applying} className="btn-primary">
          {applying ? 'Saving…' : `Save ${selected.size || ''} warrant${selected.size === 1 ? 'y' : 'ies'}`}
        </button>
      </div>
    </div>
  );
}
