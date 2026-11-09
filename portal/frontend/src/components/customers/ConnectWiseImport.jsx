import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, ArrowLeft, RefreshCw, Building2, MapPin, Monitor, Server, Router, Printer, HardDrive, Shield, Tv,
} from 'lucide-react';
import { connectWiseApi } from '../../api/connectwise.js';
import { integrationsApi } from '../../api/integrations.js';
import { SearchInput } from '../ui/SearchInput.jsx';
import { OfficeTarget, ActionChip, MatchLine, NewerToggle, effectiveAction, countDiffers } from './SyncPreview.jsx';
import { formatDate } from '../../utils/date.js';

// "Import from ConnectWise" on a customer's Devices tab.
//   1. pick a ConnectWise RMM Company → Site
//   2. tick machines (or Select all) — each row previews what will happen: a new
//      device, an update to a device already on file (and exactly which fields), or
//      nothing because it's already up to date
//   3. import → summary
// Matching/merging rules live server-side in lib/connectwise.js.

const FIELD_LABEL = {
  label: 'Name', assigned_to: 'Assigned to', model: 'Model', service_tag: 'Service tag',
  serial_number: 'Serial', manufacturer: 'Manufacturer',
  computer_name: 'Computer name', ip_address: 'IP', mac_address: 'MAC',
  operating_system: 'OS', processor: 'Processor', ram: 'RAM', storage_drives: 'Drives',
  share_paths: 'Shared folders', local_accounts: 'Local accounts',
  warranty_expires: 'Warranty', warranty_coverage: 'Warranty coverage', device_type: 'Type', location_id: 'Office',
  other_macs: 'Other MACs',
};

// The type the server decided (device_type) picks the icon and leads the row's details.
const TYPE_ICON = { server: Server, firewall: Shield, switch: Router, network: Router, printer: Printer, nas: HardDrive, other: Tv };
const TYPE_LABEL = { workstation: 'Workstation', server: 'Server', firewall: 'Firewall', switch: 'Switch', printer: 'Printer', nas: 'NAS', network: 'Network', other: 'Other' };
const iconFor = (m) => TYPE_ICON[m.device_type] ?? Monitor;

const rememberKey = (cid) => `app-cw-site-${cid}`;
const readRemembered = (cid) => {
  try { return JSON.parse(localStorage.getItem(rememberKey(cid)) || 'null'); } catch { return null; }
};
const remember = (cid, v) => { try { localStorage.setItem(rememberKey(cid), JSON.stringify(v)); } catch { /* private mode */ } };

function MachineRow({ m, checked, onToggle, takeNewer }) {
  const p = m.preview;
  const eff = effectiveAction(p, takeNewer);
  const disabled = p.action === 'ambiguous';
  const Icon = iconFor(m);
  const drives = (m.drives ?? []).map(d => `${d.label} ${d.size}`).join(', ');
  const facts = [TYPE_LABEL[m.device_type], m.os, m.model, m.serial && `S/N ${m.serial}`, m.private_ip, m.ram && `${m.ram} RAM`, m.processor, drives,
    m.warranty_expires && `warranty ${formatDate(m.warranty_expires)}${m.warranty_coverage ? ` (${m.warranty_coverage})` : ''}`].filter(Boolean);
  return (
    <div className={`px-3 py-2.5 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={checked}
          disabled={disabled} onChange={onToggle} aria-label={`Select ${m.name}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon size={14} className="text-gray-500 shrink-0" />
            <span className="text-gray-100 font-medium break-all">{m.name}</span>
            {m.machine_name && m.machine_name !== m.name && <span className="text-xs text-gray-500">{m.machine_name}</span>}
            {m.online === true && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Online now" />}
            <ActionChip action={eff.action} count={eff.count} createLabel="New device" />
          </div>
          {facts.length > 0 && <p className="text-xs text-gray-500 mt-0.5 break-words">{facts.join(' · ')}</p>}
          <MatchLine preview={p} labels={FIELD_LABEL} takeNewer={takeNewer} source="ConnectWise" />
        </div>
      </div>
    </div>
  );
}

function Result({ result, onClose }) {
  const section = (title, rows, cls, render) => rows.length > 0 && (
    <div>
      <p className={`text-sm font-medium mb-1 ${cls}`}>{title} ({rows.length})</p>
      <ul className="text-sm text-gray-300 space-y-0.5 pl-1">{rows.map((r, i) => <li key={i}>{render(r)}</li>)}</ul>
    </div>
  );
  return (
    <div className="space-y-4">
      {section('Created', result.created, 'text-green-400', r => <>{r.device} <span className="text-gray-500">({r.device_type})</span></>)}
      {section('Updated', result.updated, 'text-amber-400', r => (
        <>{r.device} <span className="text-gray-500">— {r.changes.map(c => FIELD_LABEL[c.field] ?? c.field).join(', ')}</span></>
      ))}
      {section('Already up to date', result.unchanged, 'text-gray-400', r => r.device)}
      {section('Skipped', result.skipped, 'text-red-400', r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>)}
      {section('Failed', result.failed, 'text-red-400', r => <>{r.name || r.endpoint_id} <span className="text-gray-500">— {r.error}</span></>)}
      <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
    </div>
  );
}

// One company row: expands to load its sites on demand.
function CompanyRow({ company, open, onToggle, onPick, remembered }) {
  const sitesQ = useQuery({
    queryKey: ['connectwise', 'sites', company.id],
    queryFn: () => connectWiseApi.sites(company.id).then(r => r.data.sites),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  return (
    <div>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-surface-700">
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
        <Building2 size={14} className="text-accent shrink-0" />
        <span className="flex-1 text-gray-200 font-medium">{company.name}</span>
        {remembered?.companyId === company.id && <span className="text-xs text-accent">last used</span>}
      </button>
      {open && (
        <div className="pb-1">
          {sitesQ.isLoading ? (
            <p className="pl-10 pr-3 py-2 text-xs text-gray-500">Loading sites…</p>
          ) : sitesQ.error ? (
            <p className="pl-10 pr-3 py-2 text-xs text-red-400">{sitesQ.error.response?.data?.error ?? 'Could not load sites.'}</p>
          ) : !sitesQ.data?.length ? (
            <p className="pl-10 pr-3 py-2 text-xs text-gray-500">No sites.</p>
          ) : sitesQ.data.map(s => (
            <button key={s.id} type="button" onClick={() => onPick(company, s)}
              className="w-full flex items-center gap-2 pl-10 pr-3 py-2.5 text-left hover:bg-surface-700">
              <MapPin size={13} className="text-gray-500 shrink-0" />
              <span className="flex-1 text-sm text-gray-300">
                {s.name}{s.city && <span className="text-gray-600"> · {s.city}</span>}
                {remembered?.siteId === s.id && <span className="ml-2 text-xs text-accent">last used here</span>}
              </span>
              <ChevronRight size={14} className="text-gray-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConnectWiseImport({ customerId, locations, companyName, defaultLocationId, onClose, onImported }) {
  const qc = useQueryClient();
  const remembered = useMemo(() => readRemembered(customerId), [customerId]);
  const [picked, setPicked]     = useState(null);               // { companyId, companyName, siteId, siteName }
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState(() => new Set(remembered ? [remembered.companyId] : []));
  const [selected, setSelected] = useState(() => new Set());
  const [locationId, setLocationId] = useState(defaultLocationId ?? '');
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');
  const [chose, setChose]       = useState(false);              // went back to the list by hand
  const [moveExisting, setMoveExisting] = useState(false);
  // Also replace values ConnectWise reports differently (off = only fill blanks and add new things).
  const [takeNewer, setTakeNewer] = useState(false);

  // The site(s) this customer is linked to — recorded by every import, for everyone.
  const linksQ = useQuery({
    queryKey: ['integration-links', customerId, 'connectwise'],
    queryFn: () => integrationsApi.links(customerId, 'connectwise').then(r => r.data.links),
    retry: false,
  });
  const linked = (linksQ.data ?? []).map(l => {
    const [companyId, siteId] = String(l.external_id).split('/');
    const [companyName = '', siteName = ''] = String(l.external_name ?? '').split(' › ');
    return { companyId, siteId, companyName, siteName, locationId: l.location_id };
  });
  const openLinked = (l) => {
    setPicked({ companyId: l.companyId, companyName: l.companyName, siteId: l.siteId, siteName: l.siteName });
    setSelected(new Set());
    if (l.locationId) setLocationId(l.locationId);
  };
  // Open the linked site straight away (the most recently synced one).
  useEffect(() => {
    if (!chose && !picked && linked.length) openLinked(linked[0]);
  }, [linksQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const companiesQ = useQuery({
    queryKey: ['connectwise', 'companies'],
    queryFn: () => connectWiseApi.companies().then(r => r.data.companies),
    staleTime: 60_000,
    retry: false,
  });
  const machinesQ = useQuery({
    queryKey: ['connectwise', 'machines', customerId, picked?.companyId, picked?.siteId],
    queryFn: () => connectWiseApi.machines(customerId, picked.companyId, picked.siteId).then(r => r.data),
    enabled: !!picked,
    retry: false,
  });

  // Refresh = bypass the backend's 2-minute cache, then refetch.
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (picked) {
        const { data } = await connectWiseApi.machines(customerId, picked.companyId, picked.siteId, true);
        qc.setQueryData(['connectwise', 'machines', customerId, picked.companyId, picked.siteId], data);
      } else {
        const { data } = await connectWiseApi.companies(true);
        qc.setQueryData(['connectwise', 'companies'], data.companies);
        qc.removeQueries({ queryKey: ['connectwise', 'sites'] });
      }
    } catch { /* the query's own error state shows it */ }
    finally { setRefreshing(false); }
  };

  const pick = (company, site) => {
    const p = { companyId: company.id, companyName: company.name, siteId: site.id, siteName: site.name };
    setPicked(p);
    setSelected(new Set());
    remember(customerId, { companyId: p.companyId, siteId: p.siteId });
  };

  const companies = companiesQ.data ?? [];
  const q = search.trim().toLowerCase();
  const visible = q ? companies.filter(c => c.name.toLowerCase().includes(q)) : companies;

  const machines   = machinesQ.data?.machines ?? [];
  const hardwareNote = machinesQ.data?.hardware_note || machinesQ.data?.details_note;
  const warrantyNote = machinesQ.data?.warranty_note;
  const selectable = machines.filter(m => m.preview.action !== 'ambiguous');
  const allChecked = selectable.length > 0 && selectable.every(m => selected.has(m.endpoint_id));
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map(m => m.endpoint_id)));
  // Matched devices the import would move into the chosen office, if "also move" is ticked.
  const elsewhere = machines.filter(m => selected.has(m.endpoint_id) && m.preview.device
    && (m.preview.device.location_id ?? null) !== (locationId || null)).length;

  const runImport = async () => {
    setImporting(true); setError('');
    try {
      const endpointIds = machines.filter(m => selected.has(m.endpoint_id)).map(m => m.endpoint_id);
      const { data } = await connectWiseApi.import(customerId, {
        companyId: picked.companyId, siteId: picked.siteId, endpointIds, locationId, moveExisting, takeNewer,
      });
      setResult(data);
      qc.invalidateQueries({ queryKey: ['integration-links', customerId] });
      onImported();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Import failed.');
    } finally { setImporting(false); }
  };

  const err = companiesQ.error || machinesQ.error;
  const notConfigured = err?.response?.status === 503;

  if (result) return <Result result={result} onClose={onClose} />;

  if (notConfigured) {
    return (
      <div className="space-y-3 text-sm text-gray-400">
        <p className="text-gray-200 font-medium">ConnectWise isn't connected yet</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>In ConnectWise RMM: <b>Integrations → API Access → Generate API Access</b>. Tick only
            <b> Platform – Companies – Read</b>, <b>Sites – Read</b>, <b>Devices – Read</b> and <b>Assets – Read</b> (read-only).</li>
          <li>In the Portal backend <code className="text-accent">.env</code>, set <code className="text-accent">CONNECTWISE_CLIENT_ID</code> and <code className="text-accent">CONNECTWISE_CLIENT_SECRET</code>, then restart the backend.</li>
        </ol>
        <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Close</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(error || (err && !notConfigured)) && (
        <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">
          {error || err.response?.data?.error || 'Could not reach ConnectWise.'}
        </p>
      )}

      {!picked ? (
        <>
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Find a company…" className="flex-1" />
            <button type="button" onClick={refresh} title="Refresh from ConnectWise" className="btn-ghost p-2 shrink-0">
              <RefreshCw size={15} className={refreshing || companiesQ.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>

          {linked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-500">Linked to this customer:</span>
              {linked.map(l => (
                <button key={`${l.companyId}/${l.siteId}`} type="button" onClick={() => openLinked(l)}
                  className="btn-ghost px-2 py-1 text-sm inline-flex items-center gap-1 text-accent">
                  <MapPin size={13} /> {[l.companyName, l.siteName].filter(Boolean).join(' › ') || 'Linked site'}
                </button>
              ))}
            </div>
          )}

          {companiesQ.isLoading ? (
            <p className="text-gray-500 text-sm py-6 text-center">Loading companies from ConnectWise…</p>
          ) : visible.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">{companies.length ? 'No company matches.' : 'No companies found in ConnectWise.'}</p>
          ) : (
            <div className="card divide-y divide-surface-600 sm:max-h-[55vh] sm:overflow-y-auto">
              {visible.map(c => (
                <CompanyRow key={c.id} company={c} remembered={remembered}
                  open={expanded.has(c.id)}
                  onToggle={() => setExpanded(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                  onPick={pick} />
              ))}
            </div>
          )}
          <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Cancel</button></div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => { setChose(true); setPicked(null); }} className="btn-ghost px-2 py-1 text-sm flex items-center gap-1">
              <ArrowLeft size={14} /> Companies
            </button>
            <span className="text-sm text-gray-300 min-w-0 break-words">
              <span className="text-gray-100 font-medium">{picked.companyName}</span>
              <span className="text-gray-600"> › </span>{picked.siteName}
            </span>
            <button type="button" onClick={refresh} title="Refresh from ConnectWise" className="btn-ghost p-2 ml-auto">
              <RefreshCw size={15} className={refreshing || machinesQ.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>

          <OfficeTarget locations={locations} companyName={companyName} value={locationId} onChange={setLocationId}
            move={moveExisting} onMoveChange={setMoveExisting} elsewhere={elsewhere} />

          <NewerToggle source="ConnectWise" count={countDiffers(machines)} checked={takeNewer} onChange={(on) => {
            setTakeNewer(on);
            // Ticking it also ticks the devices it would change.
            if (on) setSelected(s => new Set([...s, ...machines.filter(m => m.preview.differs?.length).map(m => m.endpoint_id)]));
          }} />

          {machinesQ.isLoading ? (
            <p className="text-gray-500 text-sm py-6 text-center">Loading devices…</p>
          ) : machines.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">No devices at this site.</p>
          ) : (
            <div className="card overflow-hidden">
              <label className="flex items-center gap-3 px-3 py-2.5 border-b border-surface-600 bg-surface-700/50 cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-brand" checked={allChecked} onChange={toggleAll} />
                <span className="text-sm text-gray-200 font-medium">Select all</span>
                <span className="text-xs text-gray-500 ml-auto">{selected.size} of {machines.length} selected</span>
              </label>
              <div className="divide-y divide-surface-600 sm:max-h-[50vh] sm:overflow-y-auto">
                {machines.map(m => (
                  <MachineRow key={m.endpoint_id} m={m} checked={selected.has(m.endpoint_id)} onToggle={() => toggle(m.endpoint_id)} takeNewer={takeNewer} />
                ))}
              </div>
            </div>
          )}

          {warrantyNote && (
            <p className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2">{warrantyNote}</p>
          )}

          {hardwareNote && (
            <p className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2">
              {hardwareNote}
            </p>
          )}

          <p className="text-xs text-gray-500">
            Devices already on file are matched by serial / service tag, any MAC, or computer name — including devices UniFi
            imported. They're only added to: blank fields are filled, and new MACs, shares and accounts are added. A value
            that's different in ConnectWise (IP, OS, RAM…) is kept unless you tick "Also replace values that changed".
            Dell machines also get their warranty from Dell.
          </p>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="button" onClick={runImport} disabled={!selected.size || importing} className="btn-primary">
              {importing ? 'Importing…' : `Import ${selected.size || ''} device${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
