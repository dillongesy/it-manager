import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Building2, Link2, Receipt } from 'lucide-react';
import { integrationsApi } from '../../api/integrations.js';
import { SearchInput } from '../ui/SearchInput.jsx';
import { formatDate } from '../../utils/date.js';
import { money } from '../../utils/recurring.js';
import { ActionChip, MatchLine, ResultSection, SetupSteps, Env, OfficeTarget } from './SyncPreview.jsx';

// "Import from TD SYNNEX" on a customer's Billing tab: their Microsoft 365 subscriptions
// (StreamOne Stellr) become recurring charges — seats, cadence, our cost, MSRP and the
// term end. A charge's own price is the biller's: it's set from the Stellr customer price
// only when the charge is first created. Matching / merge rules: backend lib/tdsynnex.js.

const FIELD_LABEL = {
  description: 'Name', category: 'Category', unit_label: 'Unit', unit_price: 'Price', notes: 'Notes',
  quantity: 'Seats', frequency: 'Billed', billing_month: 'Renewal month', is_active: 'Status',
  vendor_cost: 'Cost', vendor_msrp: 'MSRP', term_end_date: 'Term ends', external_status: 'TD SYNNEX status',
};
const FREQ = { monthly: 'monthly', annually: 'yearly' };

// Company names compared loosely, to float the likely TD SYNNEX customer to the top.
const key = (v) => String(v ?? '').toLowerCase()
  .replace(/\b(inc|llc|ltd|co|corp|corporation|company|pc|pllc|the)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
const looksLike = (a, b) => { const x = key(a); const y = key(b); return Boolean(x && y && (x === y || x.startsWith(y) || y.startsWith(x))); };

function Row({ item, checked, onToggle }) {
  const p = item.preview;
  const f = item.fields;
  const facts = [
    `${f.quantity} license${f.quantity !== 1 ? 's' : ''}`,
    `billed ${FREQ[f.frequency] ?? f.frequency}`,
    f.unit_price != null && `price ${money(f.unit_price)}`,
    f.vendor_cost != null && `cost ${money(f.vendor_cost)}`,
    f.vendor_msrp != null && `MSRP ${money(f.vendor_msrp)}`,
    f.term_end_date && `term ends ${formatDate(f.term_end_date)}`,
    !item.active && item.status,
  ].filter(Boolean);
  return (
    <div className={`px-3 py-2.5 ${p.action === 'ambiguous' ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={checked}
          disabled={p.action === 'ambiguous'} onChange={onToggle} aria-label={`Select ${item.description}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Receipt size={14} className="text-gray-500 shrink-0" />
            <span className="text-gray-100 font-medium break-words">{item.description}</span>
            <ActionChip action={p.action} count={p.changes.length} createLabel="New charge" />
          </div>
          <p className="text-xs text-gray-500 mt-0.5 break-words">{facts.join(' · ')}</p>
          {item.term && <p className="text-xs text-gray-600">{item.term}{item.sku ? ` · ${item.sku}` : ''}</p>}
          <MatchLine preview={p} labels={FIELD_LABEL} noun="charge" />
        </div>
      </div>
    </div>
  );
}

export function TdSynnexImport({ customerId, companyName, locations, defaultLocationId, onClose, onImported }) {
  const qc = useQueryClient();
  const [customerNo, setCustomerNo] = useState(null);
  const [chose, setChose] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [locationId, setLocationId] = useState(defaultLocationId ?? '');
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const linksQ = useQuery({
    queryKey: ['integration-links', customerId, 'tdsynnex'],
    queryFn: () => integrationsApi.links(customerId, 'tdsynnex').then(r => r.data.links),
    retry: false,
  });
  const linkedIds = useMemo(() => new Set((linksQ.data ?? []).map(l => l.external_id)), [linksQ.data]);
  useEffect(() => {
    if (!chose && !customerNo && linksQ.data?.length) {
      setCustomerNo(linksQ.data[0].external_id);
      if (linksQ.data[0].location_id) setLocationId(linksQ.data[0].location_id);
    }
  }, [linksQ.data, chose, customerNo]);

  const customersQ = useQuery({
    queryKey: ['tdsynnex', 'customers'],
    queryFn: () => integrationsApi.tdsynnex.customers().then(r => r.data.customers),
    staleTime: 60_000,
    retry: false,
  });
  const previewKey = ['tdsynnex', 'preview', customerId, customerNo];
  const previewQ = useQuery({
    queryKey: previewKey,
    queryFn: () => integrationsApi.tdsynnex.preview(customerId, customerNo).then(r => r.data),
    enabled: !!customerNo,
    retry: false,
  });
  const plan = previewQ.data;
  useEffect(() => {
    if (plan) setSelected(new Set(plan.items.filter(i => i.preview.action === 'create' || i.preview.action === 'update').map(i => i.key)));
  }, [plan]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (customerNo) {
        const { data } = await integrationsApi.tdsynnex.preview(customerId, customerNo, true);
        qc.setQueryData(previewKey, data);
      } else {
        const { data } = await integrationsApi.tdsynnex.customers(true);
        qc.setQueryData(['tdsynnex', 'customers'], data.customers);
      }
    } catch { /* the queries show it */ } finally { setRefreshing(false); }
  };

  const runImport = async () => {
    setImporting(true); setError('');
    try {
      const { data } = await integrationsApi.tdsynnex.import(customerId, { customerNo, keys: [...selected], locationId });
      setResult(data);
      qc.invalidateQueries({ queryKey: ['integration-links', customerId] });
      onImported();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Import failed.');
    } finally { setImporting(false); }
  };

  const err = customersQ.error || previewQ.error;
  if (err?.response?.status === 503) {
    return (
      <SetupSteps title="TD SYNNEX isn't connected yet" onClose={onClose} steps={[
        <>In <b>EC Express → StreamOne → Integration → Developer API's → Go to Developer Portal</b>, open your name → <b>Client Credentials</b> and create <b>PROD</b> credentials.</>,
        <>In the Portal backend <Env>.env</Env>, set <Env>TDSYNNEX_CLIENT_ID</Env> and <Env>TDSYNNEX_CLIENT_SECRET</Env>, then restart the backend.</>,
      ]} />
    );
  }

  if (result) {
    return (
      <div className="space-y-4">
        <ResultSection title="Charges added" rows={result.created} className="text-green-400" render={r => r.name} />
        <ResultSection title="Charges updated" rows={result.updated} className="text-amber-400"
          render={r => <>{r.name} <span className="text-gray-500">— {r.changes.map(c => FIELD_LABEL[c.field] ?? c.field).join(', ')}</span></>} />
        <ResultSection title="Already up to date" rows={result.unchanged} className="text-gray-400" render={r => r.name} />
        <ResultSection title="Skipped" rows={result.skipped} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>} />
        <ResultSection title="Failed" rows={result.failed} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.error}</span></>} />
        <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
      </div>
    );
  }

  const errorBox = (error || err) && (
    <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error || err.response?.data?.error || 'Could not reach TD SYNNEX.'}</p>
  );

  if (!customerNo) {
    const all = customersQ.data ?? [];
    const s = search.trim().toLowerCase();
    const rank = (c) => (linkedIds.has(c.id) ? 2 : looksLike(c.name, companyName) ? 1 : 0);
    const visible = (s ? all.filter(c => `${c.name} ${c.city}`.toLowerCase().includes(s)) : all).slice().sort((a, b) => rank(b) - rank(a));
    return (
      <div className="space-y-4">
        {errorBox}
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Find a TD SYNNEX customer…" className="flex-1" />
          <button type="button" onClick={refresh} title="Refresh from TD SYNNEX" className="btn-ghost p-2 shrink-0">
            <RefreshCw size={15} className={refreshing || customersQ.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        {customersQ.isLoading ? (
          <p className="text-gray-500 text-sm py-6 text-center">Loading customers from TD SYNNEX…</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">{all.length ? 'No customer matches.' : 'No customers on this TD SYNNEX account.'}</p>
        ) : (
          <div className="card divide-y divide-surface-600 sm:max-h-[55vh] sm:overflow-y-auto">
            {visible.map(c => (
              <button key={c.id} type="button" onClick={() => { setChose(true); setCustomerNo(c.id); }}
                className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-surface-700">
                <Building2 size={14} className="text-accent mt-1 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-gray-200 font-medium">{c.name}</span>
                    {linkedIds.has(c.id) && <span className="badge bg-blue-900/40 text-blue-300">Linked here</span>}
                    {!linkedIds.has(c.id) && looksLike(c.name, companyName) && <span className="badge bg-green-900/30 text-green-400">Likely match</span>}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {[c.city && `${c.city}${c.state ? `, ${c.state}` : ''}`, `#${c.id}`, c.status !== 'Active' && c.status].filter(Boolean).join(' · ')}
                  </span>
                  {c.linked.length > 0 && !linkedIds.has(c.id) && (
                    <span className="block text-xs text-gray-500 mt-0.5">Linked to {c.linked.map(l => l.name).join(', ')}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Cancel</button></div>
      </div>
    );
  }

  const items = plan?.items ?? [];
  const selectable = items.filter(i => i.preview.action !== 'ambiguous');
  const allChecked = selectable.length > 0 && selectable.every(i => selected.has(i.key));
  const toggle = (k) => setSelected(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="space-y-4">
      {errorBox}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setChose(true); setCustomerNo(null); }} className="btn-ghost px-2 py-1 text-sm flex items-center gap-1">
          <ArrowLeft size={14} /> Customers
        </button>
        <span className="text-sm text-gray-100 font-medium min-w-0 break-words">{plan?.customer?.name ?? 'Loading…'}</span>
        {linkedIds.has(customerNo) && <span className="badge bg-blue-900/40 text-blue-300 flex items-center gap-1"><Link2 size={11} /> Linked</span>}
        <button type="button" onClick={refresh} title="Refresh from TD SYNNEX" className="btn-ghost p-2 ml-auto">
          <RefreshCw size={15} className={refreshing || previewQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <OfficeTarget locations={locations} companyName={companyName} value={locationId} onChange={setLocationId} noun="charges" />

      {previewQ.isLoading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Reading subscriptions…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm py-6 text-center">No Microsoft subscriptions to bring over for this customer.</p>
      ) : (
        <div className="card overflow-hidden">
          <label className="flex items-center gap-3 px-3 py-2.5 border-b border-surface-600 bg-surface-700/50 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={allChecked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map(i => i.key)))} />
            <span className="text-sm text-gray-200 font-medium">Microsoft subscriptions</span>
            <span className="text-xs text-gray-500 ml-auto">{selected.size} of {items.length} selected</span>
          </label>
          <div className="divide-y divide-surface-600 sm:max-h-[50vh] sm:overflow-y-auto">
            {items.map(i => <Row key={i.key} item={i} checked={selected.has(i.key)} onToggle={() => toggle(i.key)} />)}
          </div>
        </div>
      )}

      {plan?.skipped?.length > 0 && (
        <p className="text-xs text-gray-500">Not brought over: {plan.skipped.map(s => `${s.name} (${s.reason})`).join('; ')}.</p>
      )}

      <p className="text-xs text-gray-500">
        Seats, billing cadence, cost, MSRP, term end and status follow TD SYNNEX. A charge's name and price are yours: new charges
        start at the customer price set in Stellr, and an existing charge's price is never changed. A cancelled subscription turns
        its charge inactive.
      </p>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={runImport} disabled={!selected.size || importing || !plan} className="btn-primary">
          {importing ? 'Importing…' : `Import ${selected.size || ''} subscription${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
