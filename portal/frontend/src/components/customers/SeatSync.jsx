import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Building2, Link2, Receipt, ChevronRight, ChevronDown, Tags } from 'lucide-react';
import { integrationsApi } from '../../api/integrations.js';
import { SearchInput } from '../ui/SearchInput.jsx';
import { formatDate } from '../../utils/date.js';
import { money } from '../../utils/recurring.js';
import { ActionChip, MatchLine, ResultSection, SetupSteps, Env, OfficeTarget } from './SyncPreview.jsx';

// "Sync seats" on a customer's Billing tab, from ThreatLocker. Generic over providers
// (backend routes/seat-sync.js). Pick the vendor customer(s) — one Portal customer can be
// several ThreatLocker orgs, e.g. "NORTHWIND-C" + "NORTHWIND-P", and the linked ones open straight
// away — then each product (ThreatLocker Complete / Protect) shows the Billing-tab charge it
// updates or creates. Prices come from the Services tab: charges are linked to their Services
// entry, and a different existing price only changes when "Use the Services price" is ticked.
// Rules: backend lib/seat-sync.js.

const FIELD_LABEL = {
  quantity: 'Seats', term_end_date: 'Term ends', external_status: 'Status', is_active: 'Active', unit_label: 'Unit',
  service_catalog_id: 'Services entry', unit_price: 'Price',
};

const SETUP = {
  threatlocker: [
    <>In the ThreatLocker portal (<b>portal.threatlocker.com</b>) create an API user (Basic Authentication) with a view-only role, then copy its token.</>,
    <>In the Portal backend <Env>.env</Env>, set <Env>THREATLOCKER_API_KEY</Env>, <Env>THREATLOCKER_INSTANCE</Env> and <Env>THREATLOCKER_ORGANIZATION_ID</Env>, then restart the backend.</>,
  ],
};

const key = (v) => String(v ?? '').toLowerCase().replace(/\b(inc|llc|ltd|co|corp|corporation|company|pc|pllc|the)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
const looksLike = (a, b) => { const x = key(a); const y = key(b); return Boolean(x && y && (x === y || x.startsWith(y) || y.startsWith(x))); };
const preTicked = (i) => (i.preview.action === 'create' || i.preview.action === 'update') && !i.preview.to_zero;

function Row({ item, checked, onToggle, accountName }) {
  const [open, setOpen] = useState(false);
  const p = item.preview;
  const disabled = p.action === 'ambiguous' || p.action === 'skip';
  const c = p.create;
  const facts = [
    `${item.units} ${item.unit_label}`,
    item.term_end && `term ends ${formatDate(item.term_end)}`,
    item.status,
  ].filter(Boolean);
  return (
    <div className={`px-3 py-2.5 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={checked} disabled={disabled} onChange={onToggle}
          aria-label={`Select ${item.name}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Receipt size={14} className="text-gray-500 shrink-0" />
            <span className="text-gray-100 font-medium break-words">{item.name}</span>
            {p.action === 'skip'
              ? <span className="badge bg-surface-600 text-gray-500">{p.reason === 'none' ? 'None here' : 'Not active'}</span>
              : <ActionChip action={p.action} count={p.changes.length} createLabel="New charge" />}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{facts.join(' · ')}</p>
          {p.reason === 'none' && (
            <p className="text-xs text-gray-500 mt-1">No {item.name.replace(/^ThreatLocker /, '')} computers in {accountName}; any existing charge is left alone.</p>
          )}
          {c && (
            <p className="text-xs text-gray-400 mt-1">
              Adds <span className="text-gray-200">{c.description}</span> ({c.frequency}): {c.quantity} {c.unit_label}
              {c.unit_price != null
                ? <> × {money(c.unit_price)} <span className="text-gray-600">— the Services price, linked so Services price changes follow</span></>
                : <span className="text-amber-400"> — nothing on the Services tab matches, so set the price on the Billing tab afterwards</span>}
            </p>
          )}
          <MatchLine preview={p} labels={FIELD_LABEL} noun="charge" />
          {p.price_option && (
            <p className="text-xs text-amber-400 mt-1">
              Billed at {money(p.price_option.from)}; the Services price ({p.price_option.service}) is {money(p.price_option.to)}.
            </p>
          )}
          {p.to_zero && <p className="text-xs text-amber-400 mt-1">Drops to 0 seats — not ticked; tick it if this customer really has none now.</p>}
          {item.notes?.map((n, i) => <p key={i} className="text-xs text-amber-400 mt-1">{n}</p>)}
          {item.detail?.length > 0 && (
            <button type="button" onClick={() => setOpen(v => !v)} className="text-xs text-gray-500 hover:text-gray-300 inline-flex items-center gap-0.5 mt-1">
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {item.detail.length} {item.unit_label === 'computers' ? 'computer' : 'line'}{item.detail.length !== 1 ? 's' : ''}
            </button>
          )}
          {open && <ul className="text-xs text-gray-500 mt-1 pl-4 list-disc space-y-0.5">{item.detail.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

export function SeatSync({ provider, customerId, companyName, locations, defaultLocationId, onClose, onImported }) {
  const qc = useQueryClient();
  const [accounts, setAccounts] = useState([]);      // the vendor accounts being synced (empty = picking)
  const [picking, setPicking] = useState(() => new Set());
  const [chose, setChose] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [useCatalogPrice, setUseCatalogPrice] = useState(false);
  const [locationId, setLocationId] = useState(defaultLocationId ?? '');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const linksQ = useQuery({
    queryKey: ['integration-links', customerId, provider],
    queryFn: () => integrationsApi.links(customerId, provider).then(r => r.data.links),
    retry: false,
  });
  const linkedIds = useMemo(() => new Set((linksQ.data ?? []).map(l => l.external_id)), [linksQ.data]);
  // Every linked account opens together (a customer's Complete org and Protect org).
  useEffect(() => {
    if (!chose && !accounts.length && linksQ.data?.length) {
      setAccounts(linksQ.data.map(l => l.external_id));
      const office = linksQ.data.find(l => l.location_id)?.location_id;
      if (office) setLocationId(office);
    }
  }, [linksQ.data, chose, accounts.length]);

  const accountsQ = useQuery({
    queryKey: ['seat-sync', provider, 'accounts'],
    queryFn: () => integrationsApi.seatSync.accounts(provider).then(r => r.data),
    staleTime: 60_000,
    retry: false,
  });
  const previewKey = ['seat-sync', provider, 'preview', customerId, accounts.join(',')];
  const previewQ = useQuery({
    queryKey: previewKey,
    queryFn: () => integrationsApi.seatSync.preview(customerId, provider, accounts).then(r => r.data),
    enabled: accounts.length > 0,
    retry: false,
  });
  const plan = previewQ.data;
  const label = plan?.label ?? accountsQ.data?.label ?? (provider === 'threatlocker' ? 'ThreatLocker' : provider);
  useEffect(() => {
    if (plan) setSelected(new Set(plan.items.filter(preTicked).map(i => i.key)));
  }, [plan]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (accounts.length) qc.setQueryData(previewKey, (await integrationsApi.seatSync.preview(customerId, provider, accounts, true)).data);
      else qc.setQueryData(['seat-sync', provider, 'accounts'], (await integrationsApi.seatSync.accounts(provider, true)).data);
    } catch { /* the queries show it */ } finally { setRefreshing(false); }
  };

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await integrationsApi.seatSync.apply(customerId, provider, { accounts, keys: [...selected], locationId, useCatalogPrice });
      setResult(data);
      qc.invalidateQueries({ queryKey: ['integration-links', customerId] });
      onImported();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Sync failed.');
    } finally { setBusy(false); }
  };

  const err = accountsQ.error || previewQ.error;
  if (err?.response?.status === 503) return <SetupSteps title={`${label} isn't connected yet`} onClose={onClose} steps={SETUP[provider]} />;

  if (result) {
    return (
      <div className="space-y-4">
        <ResultSection title="Charges added" rows={result.created} className="text-green-400"
          render={r => <>{r.name}{!r.priced && <span className="text-amber-400"> — set its price on the Billing tab</span>}</>} />
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
    <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error || err.response?.data?.error || `Could not reach ${label}.`}</p>
  );

  if (!accounts.length) {
    const all = accountsQ.data?.accounts ?? [];
    const s = search.trim().toLowerCase();
    const rank = (a) => (linkedIds.has(a.id) ? 2 : looksLike(a.name, companyName) ? 1 : 0);
    const visible = (s ? all.filter(a => `${a.name} ${a.detail}`.toLowerCase().includes(s)) : all).slice().sort((a, b) => rank(b) - rank(a));
    const togglePick = (id) => setPicking(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    return (
      <div className="space-y-4">
        {errorBox}
        <p className="text-sm text-gray-400">
          Tick this customer's {label} organization — or several, if they're split (e.g. one for Complete computers and one for Protect).
        </p>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder={`Find a ${label} organization…`} className="flex-1" />
          <button type="button" onClick={refresh} title={`Refresh from ${label}`} className="btn-ghost p-2 shrink-0">
            <RefreshCw size={15} className={refreshing || accountsQ.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        {accountsQ.isLoading ? (
          <p className="text-gray-500 text-sm py-6 text-center">Loading organizations from {label}…</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">{all.length ? 'No organization matches.' : `No organizations on the ${label} account.`}</p>
        ) : (
          <div className="card divide-y divide-surface-600 sm:max-h-[55vh] sm:overflow-y-auto">
            {visible.map(a => (
              <label key={a.id} className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-surface-700 cursor-pointer">
                <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={picking.has(a.id)} onChange={() => togglePick(a.id)} />
                <Building2 size={14} className="text-accent mt-1 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-gray-200 font-medium">{a.name}</span>
                    {linkedIds.has(a.id) && <span className="badge bg-blue-900/40 text-blue-300">Linked here</span>}
                    {!linkedIds.has(a.id) && looksLike(a.name, companyName) && <span className="badge bg-green-900/30 text-green-400">Likely match</span>}
                  </span>
                  {a.detail && <span className="block text-xs text-gray-500 mt-0.5">{a.detail}</span>}
                  {a.linked.length > 0 && !linkedIds.has(a.id) && <span className="block text-xs text-gray-500 mt-0.5">Linked to {a.linked.map(l => l.name).join(', ')}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" disabled={!picking.size} onClick={() => { setChose(true); setAccounts([...picking]); }} className="btn-primary">
            Continue{picking.size > 1 ? ` with ${picking.size} organizations` : ''}
          </button>
        </div>
      </div>
    );
  }

  const items = plan?.items ?? [];
  const selectable = items.filter(i => i.preview.action !== 'ambiguous' && i.preview.action !== 'skip');
  const allChecked = selectable.length > 0 && selectable.every(i => selected.has(i.key));
  const toggle = (k) => setSelected(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const priceRows = items.filter(i => i.preview.price_option && selected.has(i.key));
  const accountName = plan?.account?.name ?? 'these organizations';

  return (
    <div className="space-y-4">
      {errorBox}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setChose(true); setPicking(new Set(accounts)); setAccounts([]); }} className="btn-ghost px-2 py-1 text-sm flex items-center gap-1">
          <ArrowLeft size={14} /> Organizations
        </button>
        <span className="text-sm text-gray-100 font-medium min-w-0 break-words">{plan?.account?.name ?? 'Loading…'}</span>
        {accounts.every(a => linkedIds.has(a)) && <span className="badge bg-blue-900/40 text-blue-300 flex items-center gap-1"><Link2 size={11} /> Linked</span>}
        <button type="button" onClick={refresh} title={`Refresh from ${label}`} className="btn-ghost p-2 ml-auto">
          <RefreshCw size={15} className={refreshing || previewQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <OfficeTarget locations={locations} companyName={companyName} value={locationId} onChange={setLocationId} noun="charges" />

      {previewQ.isLoading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Reading {label}…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm py-6 text-center">Nothing to bring over for this customer.</p>
      ) : (
        <div className="card overflow-hidden">
          <label className="flex items-center gap-3 px-3 py-2.5 border-b border-surface-600 bg-surface-700/50 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={allChecked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map(i => i.key)))} />
            <span className="text-sm text-gray-200 font-medium">{label} → Billing tab</span>
            <span className="text-xs text-gray-500 ml-auto">{selected.size} of {selectable.length} selected</span>
          </label>
          <div className="divide-y divide-surface-600 sm:max-h-[50vh] sm:overflow-y-auto">
            {items.map(i => <Row key={i.key} item={i} checked={selected.has(i.key)} onToggle={() => toggle(i.key)} accountName={accountName} />)}
          </div>
        </div>
      )}

      {priceRows.length > 0 && (
        <label className="flex items-start gap-3 card px-3 py-2.5 cursor-pointer">
          <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={useCatalogPrice} onChange={e => setUseCatalogPrice(e.target.checked)} />
          <span className="text-sm text-gray-200">
            <Tags size={13} className="inline mr-1 text-accent" />
            Use the Services price for {priceRows.map(i => i.name).join(' and ')}
            <span className="block text-xs text-gray-500 mt-0.5">
              {priceRows.map(i => `${money(i.preview.price_option.from)} → ${money(i.preview.price_option.to)}`).join(', ')}. Leave unticked to keep this customer's current price.
            </span>
          </span>
        </label>
      )}

      <p className="text-xs text-gray-500">
        Seats follow {label}: computers with Elevation, Storage Control or Endpoint Detect count as Complete, the rest as Protect.
        Each charge is linked to its Services entry, so a price change on the Services tab rolls down to it.
      </p>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={apply} disabled={!selected.size || busy || !plan} className="btn-primary">
          {busy ? 'Syncing…' : `Sync ${selected.size || ''} charge${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
