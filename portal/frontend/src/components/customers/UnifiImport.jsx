import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Router, Shield, Server, Wifi, Camera, HardDrive, Link2, Lock, KeyRound, Printer, Monitor, Phone, Zap, HelpCircle } from 'lucide-react';
import { integrationsApi } from '../../api/integrations.js';
import { SearchInput } from '../ui/SearchInput.jsx';
import { ActionChip, MatchLine, ResultSection, SetupSteps, Env, OfficeTarget, NewerToggle, effectiveAction, countDiffers } from './SyncPreview.jsx';

// "Import from UniFi" — from the Devices tab (network gear, plus the firewall's WAN,
// VLANs and rules) or the Cameras tab (Protect cameras).
//   1. pick a UniFi console (the one this customer was linked to opens straight away)
//   2. tick devices / cameras — each row previews: new, update · N fields, up to date
//   3. import → summary. The console is remembered as this customer's.
// Matching / merge rules live server-side in lib/unifi.js.

const FIELD_LABEL = {
  label: 'Name', manufacturer: 'Manufacturer', model: 'Model', serial_number: 'Serial', driver_url: 'Mgmt link',
  port_count: 'Ports', managed_switch: 'Managed', internal_ips: 'Internal IPs', ip_address: 'IP', mac_address: 'MAC',
  firmware_version: 'Firmware', wan_subnet_mask: 'WAN mask', wan_gateway: 'WAN gateway', wan_dns: 'WAN DNS',
  external_ips: 'External IPs', vlans: 'VLANs', firewall_rules: 'Firewall rules',
  // cameras / camera system
  name: 'Name', camera_type: 'Type', firmware: 'Firmware', system_type: 'Type',
  // WiFi credentials
  password: 'Password', extra_notes: 'Notes',
  ip_assignment: 'IP assignment', vpns: 'VPNs', computer_name: 'Computer name', location_id: 'Office',
  other_macs: 'Other MACs', notes: 'Notes',
};
const IP_LABEL = { dhcp: 'DHCP', reservation: 'DHCP reservation', static: 'Static' };

const KIND_ICON = {
  gateway: Shield, switch: Router, nas: HardDrive, console: Server, other: Wifi, camera: Camera, wifi: KeyRound,
  // clients
  printer: Printer, server: Server, network: Router, power: Zap, computer: Monitor, voip: Phone, unknown: HelpCircle,
};
const KIND_LABEL = { gateway: 'Firewall', switch: 'Switch', nas: 'NAS', console: 'Console', other: 'Network' };

// "WAN 104.222.91.35, 3 VLANs and 4 firewall rules" — what a new firewall arrives with.
function gatewayExtras(f = {}) {
  const n = (count, word) => (count ? `${count} ${word}${count !== 1 ? 's' : ''}` : null);
  const parts = [
    f.external_ips?.length ? `WAN ${f.external_ips.join(', ')}` : null,
    n(f.vlans?.length, 'VLAN'),
    n(f.firewall_rules?.length, 'firewall rule'),
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
}

function Row({ item, checked, onToggle, facts, takeNewer }) {
  const p = item.preview;
  const eff = effectiveAction(p, takeNewer);
  const disabled = p.action === 'ambiguous';
  const Icon = KIND_ICON[item.kind] ?? Wifi;
  return (
    <div className={`px-3 py-2.5 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="h-5 w-5 mt-0.5 accent-brand shrink-0" checked={checked}
          disabled={disabled} onChange={onToggle} aria-label={`Select ${item.name}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon size={14} className="text-gray-500 shrink-0" />
            <span className="text-gray-100 font-medium break-all">{item.name}</span>
            {item.online && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Online now" />}
            <ActionChip action={eff.action} count={eff.count} createLabel={item.kind === 'camera' ? 'New camera' : item.kind === 'wifi' ? 'New credential' : 'New device'} />
          </div>
          {facts.length > 0 && <p className="text-xs text-gray-500 mt-0.5 break-words">{facts.join(' · ')}</p>}
          {p.action === 'create' && item.gateway && gatewayExtras(item.fields) && (
            <p className="text-xs text-gray-500 mt-0.5">Brings {gatewayExtras(item.fields)} with it.</p>
          )}
          <MatchLine preview={p} labels={FIELD_LABEL} noun={item.kind === 'camera' ? 'camera' : item.kind === 'wifi' ? 'credential' : 'device'}
            takeNewer={takeNewer} source="UniFi" />
        </div>
      </div>
    </div>
  );
}

function Checklist({ title, items, selected, setSelected, factsFor, extra, takeNewer }) {
  const selectable = items.filter(i => i.preview.action !== 'ambiguous');
  const allChecked = selectable.length > 0 && selectable.every(i => selected.has(i.key));
  const toggle = (k) => setSelected(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="card overflow-hidden">
      <label className="flex items-center gap-3 px-3 py-2.5 border-b border-surface-600 bg-surface-700/50 cursor-pointer">
        <input type="checkbox" className="h-5 w-5 accent-brand" checked={allChecked}
          onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map(i => i.key)))} />
        <span className="text-sm text-gray-200 font-medium">{title}</span>
        <span className="text-xs text-gray-500 ml-auto">{items.filter(i => selected.has(i.key)).length} of {items.length} selected</span>
      </label>
      {extra}
      <div className="divide-y divide-surface-600 sm:max-h-[45vh] sm:overflow-y-auto">
        {items.map(i => <Row key={i.key} item={i} checked={selected.has(i.key)} onToggle={() => toggle(i.key)} facts={factsFor(i)} takeNewer={takeNewer} />)}
      </div>
    </div>
  );
}

function ConsolePicker({ q, onPick, linkedIds }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { const { data } = await integrationsApi.unifi.consoles(true); qc.setQueryData(['unifi', 'consoles'], data.consoles); }
    catch { /* the query shows it */ } finally { setRefreshing(false); }
  };
  const all = q.data ?? [];
  const s = search.trim().toLowerCase();
  const visible = (s ? all.filter(c => `${c.name} ${c.model} ${c.public_ip} ${c.linked.map(l => l.name).join(' ')}`.toLowerCase().includes(s)) : all)
    .slice().sort((a, b) => (linkedIds.has(b.id) - linkedIds.has(a.id)));

  return (
    <>
      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Find a console (name, model, IP, customer)…" className="flex-1" />
        <button type="button" onClick={refresh} title="Refresh from UniFi" className="btn-ghost p-2 shrink-0">
          <RefreshCw size={15} className={refreshing || q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      {q.isLoading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Loading consoles from UniFi…</p>
      ) : visible.length === 0 ? (
        <p className="text-gray-500 text-sm py-6 text-center">{all.length ? 'No console matches.' : 'No consoles on this UniFi account.'}</p>
      ) : (
        <div className="card divide-y divide-surface-600 sm:max-h-[55vh] sm:overflow-y-auto">
          {visible.map(c => (
            <button key={c.id} type="button" onClick={() => onPick(c.id)}
              className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-surface-700">
              <span className={`w-2 h-2 rounded-full mt-2 shrink-0 ${c.online ? 'bg-green-400' : 'bg-gray-600'}`} title={c.online ? 'Online' : 'Offline'} />
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-gray-200 font-medium">{c.name}</span>
                  {linkedIds.has(c.id) && <span className="badge bg-blue-900/40 text-blue-300">Linked here</span>}
                  {!c.owner && <span className="badge bg-surface-600 text-gray-400" title="Shared with your UniFi account — device list only">Shared</span>}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {[c.model, c.public_ip, `${c.device_count} device${c.device_count !== 1 ? 's' : ''}`,
                    c.camera_count ? `${c.camera_count} camera${c.camera_count !== 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')}
                </span>
                {c.linked.length > 0 && !linkedIds.has(c.id) && (
                  <span className="block text-xs text-gray-500 mt-0.5">Linked to {c.linked.map(l => l.name).join(', ')}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function UnifiImport({ customerId, locations, companyName, defaultLocationId, focus = 'devices', onClose, onImported }) {
  const qc = useQueryClient();
  const linksQ = useQuery({
    queryKey: ['integration-links', customerId, 'unifi'],
    queryFn: () => integrationsApi.links(customerId, 'unifi').then(r => r.data.links),
    retry: false,
  });
  const linkedIds = useMemo(() => new Set((linksQ.data ?? []).map(l => l.external_id)), [linksQ.data]);

  const [hostId, setHostId] = useState(null);
  const [chose, setChose] = useState(false);              // picked by hand (don't auto-jump back to the link)
  const [siteId, setSiteId] = useState('');
  const [cameraSystemId, setCameraSystemId] = useState('');
  const [devSel, setDevSel] = useState(() => new Set());
  const [camSel, setCamSel] = useState(() => new Set());
  const [wifiSel, setWifiSel] = useState(() => new Set());
  const [cliSel, setCliSel] = useState(() => new Set());
  const [moveExisting, setMoveExisting] = useState(false);
  // Also replace values UniFi reports differently (off = only fill blanks and add new things).
  const [takeNewer, setTakeNewer] = useState(false);
  const [locationId, setLocationId] = useState(defaultLocationId ?? '');
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Open the linked console straight away (most recently synced first).
  useEffect(() => {
    if (!chose && !hostId && linksQ.data?.length) {
      setHostId(linksQ.data[0].external_id);
      if (linksQ.data[0].location_id) setLocationId(linksQ.data[0].location_id);
    }
  }, [linksQ.data, chose, hostId]);

  const consolesQ = useQuery({
    queryKey: ['unifi', 'consoles'],
    queryFn: () => integrationsApi.unifi.consoles().then(r => r.data.consoles),
    staleTime: 60_000,
    retry: false,
  });
  const pickConsole = (id) => { setChose(true); setHostId(id); setSiteId(''); setCameraSystemId(''); };

  const previewKey = ['unifi', 'preview', customerId, hostId, siteId, cameraSystemId];
  const previewQ = useQuery({
    queryKey: previewKey,
    queryFn: () => integrationsApi.unifi.preview(customerId, { hostId, siteId, cameraSystemId }).then(r => r.data),
    enabled: !!hostId,
    retry: false,
  });
  const plan = previewQ.data;

  // Pre-tick what would change (or everything new) — on the tab the dialog was opened from.
  useEffect(() => {
    if (!plan) return;
    const worth = (i) => i.preview.action === 'create' || i.preview.action === 'update';
    setDevSel(focus === 'cameras' ? new Set() : new Set(plan.devices.filter(worth).map(i => i.key)));
    setCamSel(new Set((plan.cameras?.items ?? []).filter(worth).map(i => i.key)));
    setWifiSel(focus === 'cameras' ? new Set() : new Set((plan.wifi ?? []).filter(worth).map(i => i.key)));
    // Clients: only the important kinds (printers, servers, NAS, network gear, UPS) start ticked.
    setCliSel(focus === 'cameras' ? new Set() : new Set((plan.clients ?? []).filter(c => c.preview && c.important && worth(c)).map(c => c.key)));
  }, [plan, focus]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await integrationsApi.unifi.preview(customerId, { hostId, siteId, cameraSystemId }, true);
      qc.setQueryData(previewKey, data);
    } catch { /* the query shows it */ } finally { setRefreshing(false); }
  };

  // Ticking "replace values that changed" also ticks the records it would change.
  const chooseNewer = (on) => {
    setTakeNewer(on);
    if (!on || !plan) return;
    const add = (set, rows, ok = () => true) => {
      const n = new Set(set);
      for (const r of rows ?? []) if (r.preview?.differs?.length && ok(r)) n.add(r.key);
      return n;
    };
    if (focus !== 'cameras') {
      setDevSel(s => add(s, plan.devices));
      setCliSel(s => add(s, plan.clients, c => c.important));
      setWifiSel(s => add(s, plan.wifi));
    }
    setCamSel(s => add(s, plan.cameras?.items));
  };

  const runImport = async () => {
    setImporting(true); setError('');
    try {
      const { data } = await integrationsApi.unifi.import(customerId, {
        hostId, siteId: siteId || plan?.site?.id, deviceKeys: [...devSel], clientKeys: [...cliSel], cameraKeys: [...camSel], wifiKeys: [...wifiSel],
        cameraSystemId, locationId, moveExisting, takeNewer,
      });
      setResult(data);
      qc.invalidateQueries({ queryKey: ['integration-links', customerId] });
      qc.invalidateQueries({ queryKey: ['customers', customerId, 'credentials'] });
      // Either tab may have opened this; both can have changed.
      qc.invalidateQueries({ queryKey: ['customers', customerId, 'devices'] });
      qc.invalidateQueries({ queryKey: ['customers', customerId, 'cameras'] });
      qc.invalidateQueries({ queryKey: ['customers', customerId, 'remote-links'] });
      onImported();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Import failed.');
    } finally { setImporting(false); }
  };

  const err = consolesQ.error || previewQ.error;
  if (err?.response?.status === 503) {
    return (
      <SetupSteps title="UniFi isn't connected yet" onClose={onClose} steps={[
        <>Sign in at <b>unifi.ui.com</b> with the account that owns the customers' consoles, then <b>Settings → API Keys → Create API Key</b>.</>,
        <>In the Portal backend <Env>.env</Env>, set <Env>UNIFI_API_KEY</Env>, then restart the backend.</>,
      ]} />
    );
  }

  if (result) {
    const c = result.cameras;
    const changed = (r) => <>{r.device ?? r.name} <span className="text-gray-500">— {r.changes.map(x => FIELD_LABEL[x.field] ?? x.field).join(', ')}</span></>;
    return (
      <div className="space-y-4">
        <ResultSection title="Devices created" rows={result.created} className="text-green-400" render={r => <>{r.device} <span className="text-gray-500">({r.device_type})</span></>} />
        <ResultSection title="Devices updated" rows={result.updated} className="text-amber-400" render={changed} />
        <ResultSection title="Devices already up to date" rows={result.unchanged} className="text-gray-400" render={r => r.device} />
        <ResultSection title="Skipped" rows={result.skipped} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>} />
        <ResultSection title="Failed" rows={result.failed} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.error}</span></>} />
        {c.system && <p className="text-sm text-gray-300">Camera system <span className="text-gray-100">{c.system.label}</span> — {c.system.action}.</p>}
        <ResultSection title="Cameras created" rows={c.created} className="text-green-400" render={r => r.name} />
        <ResultSection title="Cameras updated" rows={c.updated} className="text-amber-400" render={changed} />
        <ResultSection title="Cameras already up to date" rows={c.unchanged} className="text-gray-400" render={r => r.name} />
        <ResultSection title="Cameras skipped" rows={c.skipped} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>} />
        <ResultSection title="Cameras failed" rows={c.failed} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.error}</span></>} />
        <ResultSection title="WiFi added to Credentials" rows={result.wifi?.created} className="text-green-400" render={r => r.name} />
        <ResultSection title="WiFi updated" rows={result.wifi?.updated} className="text-amber-400" render={changed} />
        <ResultSection title="WiFi already up to date" rows={result.wifi?.unchanged} className="text-gray-400" render={r => r.name} />
        <ResultSection title="WiFi skipped" rows={result.wifi?.skipped} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.reason}</span></>} />
        <ResultSection title="WiFi failed" rows={result.wifi?.failed} className="text-red-400" render={r => <>{r.name} <span className="text-gray-500">— {r.error}</span></>} />
        <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
      </div>
    );
  }

  if (!hostId) {
    return (
      <div className="space-y-4">
        {err && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{err.response?.data?.error || 'Could not reach UniFi.'}</p>}
        <ConsolePicker q={consolesQ} onPick={pickConsole} linkedIds={linkedIds} />
        <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Cancel</button></div>
      </div>
    );
  }

  const devices = plan?.devices ?? [];
  const cams = plan?.cameras;
  const wifi = (plan?.wifi ?? []).map(w => ({ ...w, name: w.label, kind: 'wifi' }));
  // Clients worth offering, grouped (printers first); the bloat is only counted.
  const GROUP_ORDER = ['Printers & scanners', 'Servers & storage', 'Network gear', 'Power & management', 'Computers', 'Phones', 'Unrecognized'];
  const clients = (plan?.clients ?? []).filter(c => !c.hidden && c.preview)
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const hiddenCounts = Object.entries((plan?.clients ?? []).filter(c => c.hidden)
    .reduce((acc, c) => ({ ...acc, [c.group]: (acc[c.group] ?? 0) + 1 }), {}));
  const total = devSel.size + cliSel.size + camSel.size + wifiSel.size;
  // Matched records the import would move, if "also move" is ticked.
  const target = locationId || null;
  const elsewhere = [...devices.filter(d => devSel.has(d.key)), ...clients.filter(c => cliSel.has(c.key))]
    .filter(r => r.preview.device && (r.preview.device.location_id ?? null) !== target).length
    + wifi.filter(w => wifiSel.has(w.key) && w.preview.credential && (w.preview.credential.location_id ?? null) !== target).length;
  const devFacts = (d) => [KIND_LABEL[d.kind], d.model, d.ip, d.fields?.ip_assignment && IP_LABEL[d.fields.ip_assignment], d.mac, d.firmware && `fw ${d.firmware}`].filter(Boolean);
  const cliFacts = (c) => [c.group, c.vendor, c.ip && `${c.ip}${c.ip_assignment ? ` (${IP_LABEL[c.ip_assignment]})` : ''}`,
    // A machine seen on both its network port and Wi-Fi is one row with both MACs.
    ...(c.macs?.length > 1 ? c.macs.map(m => (m.note ? `${m.mac} (${m.note})` : m.mac)) : [c.mac]),
    c.network, c.online ? null : `offline${c.last_seen ? ` since ${new Date(c.last_seen).toLocaleDateString()}` : ''}`].filter(Boolean);
  const camFacts = (c) => [c.fields.manufacturer, c.fields.model, c.fields.camera_type, c.ip, c.mac].filter(Boolean);
  const wifiFacts = (w) => [w.notes, w.ppsk_count ? `${w.ppsk_count} private key${w.ppsk_count !== 1 ? 's' : ''}` : null].filter(Boolean);
  const devicesFirst = focus !== 'cameras';

  const deviceBlock = devices.length > 0 && (
    <Checklist takeNewer={takeNewer} key="d" title="UniFi network devices" items={devices} selected={devSel} setSelected={setDevSel} factsFor={devFacts} />
  );
  const clientBlock = clients.length > 0 && (
    <Checklist takeNewer={takeNewer} key="cl" title="Other devices on the network" items={clients} selected={cliSel} setSelected={setCliSel} factsFor={cliFacts}
      extra={(
        <p className="px-3 py-2 border-b border-surface-600 text-xs text-gray-500">
          Printers, servers, NAS boxes, other network gear and UPSes start ticked; computers (ConnectWise brings those) and
          phones don't. Each is labelled DHCP, DHCP reservation or Static.
          {hiddenCounts.length > 0 && <> Not offered: {hiddenCounts.map(([g, n]) => `${g} ${n}`).join(' · ')}.</>}
        </p>
      )} />
  );
  const wifiBlock = wifi.length > 0 && (
    <Checklist takeNewer={takeNewer} key="w" title="WiFi & VPN keys → Credentials" items={wifi} selected={wifiSel} setSelected={setWifiSel} factsFor={wifiFacts}
      extra={(
        <p className="px-3 py-2 border-b border-surface-600 text-xs text-gray-500">
          Each SSID goes in the customer's Credentials tab under <span className="text-gray-300">WiFi</span>, and a site-to-site VPN's
          pre-shared key under <span className="text-gray-300">VPN</span> — stored encrypted like every other credential, never shown here.
        </p>
      )} />
  );
  const cameraBlock = cams && (
    <Checklist takeNewer={takeNewer} key="c" title="Protect cameras" items={cams.items} selected={camSel} setSelected={setCamSel} factsFor={camFacts}
      extra={(
        <div className="px-3 py-2.5 border-b border-surface-600 text-xs space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500">Camera system:</span>
            <select className="input py-1 text-sm w-auto max-w-full" value={cameraSystemId} onChange={e => setCameraSystemId(e.target.value)}>
              {/* '' = automatic: the system matched to this console, else a new one */}
              <option value="">
                {!cameraSystemId && cams.system.target ? `${cams.system.target.label} (matched by ${cams.system.reason})`
                  : !cameraSystemId ? `New system: ${cams.system.fields.label}` : 'Automatic'}
              </option>
              {cams.candidates.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              {(cameraSystemId || cams.system.target) && <option value="new">New system: {cams.system.fields.label}</option>}
            </select>
            <ActionChip {...effectiveAction(cams.system, takeNewer)} createLabel="New system" />
          </div>
          {cams.system.changes.length > 0 && (
            <p className="text-gray-500">System: {cams.system.changes.map(c => `${FIELD_LABEL[c.field] ?? c.field} ${c.mode === 'fill' ? '+' : '→'} ${c.to}`).join(' · ')}</p>
          )}
          {cams.system.differs?.length > 0 && (
            <p className="text-gray-500">
              {takeNewer ? 'Replacing: ' : 'Kept as is: '}
              {cams.system.differs.map(c => `${FIELD_LABEL[c.field] ?? c.field} ${c.from}${takeNewer ? ` → ${c.to}` : ` (UniFi has ${c.to})`}`).join(' · ')}
            </p>
          )}
        </div>
      )} />
  );

  return (
    <div className="space-y-4">
      {(error || err) && (
        <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error || err.response?.data?.error || 'Could not reach UniFi.'}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setChose(true); setHostId(null); }} className="btn-ghost px-2 py-1 text-sm flex items-center gap-1">
          <ArrowLeft size={14} /> Consoles
        </button>
        <span className="text-sm text-gray-300 min-w-0 break-words">
          <span className="text-gray-100 font-medium">{plan?.console?.name ?? 'Loading…'}</span>
          {plan?.console?.model && <span className="text-gray-600"> · {plan.console.model}</span>}
        </span>
        {linkedIds.has(hostId) && <span className="badge bg-blue-900/40 text-blue-300 flex items-center gap-1"><Link2 size={11} /> Linked</span>}
        <button type="button" onClick={refresh} title="Refresh from UniFi" className="btn-ghost p-2 ml-auto">
          <RefreshCw size={15} className={refreshing || previewQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <OfficeTarget locations={locations} companyName={companyName} value={locationId} onChange={setLocationId}
        move={moveExisting} onMoveChange={setMoveExisting} elsewhere={elsewhere} noun="devices and credentials" />

      <NewerToggle source="UniFi" checked={takeNewer} onChange={chooseNewer}
        count={countDiffers(devices) + countDiffers(clients) + countDiffers(wifi) + countDiffers(cams?.items) + (cams?.system?.differs?.length ? 1 : 0)} />

      {plan?.sites?.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Network site:</span>
          <select className="input py-1 w-auto" value={siteId || plan.site?.id || ''} onChange={e => setSiteId(e.target.value)}>
            {plan.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* Only the network side is limited on a shared console — cameras come through either way. */}
      {plan?.limited && (focus !== 'cameras' || devices.length > 0) && (
        <p className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2 flex gap-2"><Lock size={13} className="shrink-0 mt-0.5" />{plan.limited}</p>
      )}
      {plan?.notes?.length > 0 && (
        <ul className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2 space-y-0.5">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      {plan?.wan?.length > 0 && (
        <p className="text-xs text-gray-500">
          WAN: {plan.wan.map(w => `${w.name} (${w.type}${w.ip ? ` ${w.ip}` : ''})`).join(' · ')}
        </p>
      )}

      {previewQ.isLoading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Reading the console…</p>
      ) : plan && !devices.length && !clients.length && !cams && !wifi.length ? (
        <p className="text-gray-500 text-sm py-6 text-center">Nothing on this console to import.</p>
      ) : (
        <div className="space-y-4">{devicesFirst ? [deviceBlock, clientBlock, wifiBlock, cameraBlock] : [cameraBlock, deviceBlock, clientBlock, wifiBlock]}</div>
      )}

      {plan?.skipped?.length > 0 && (
        <p className="text-xs text-gray-500">Not imported (not cameras): {plan.skipped.join(', ')}.</p>
      )}

      <p className="text-xs text-gray-500">
        Matched to what's on file by any MAC, serial or name (WiFi by SSID) — including devices ConnectWise imported. Records on file are
        only added to: blank fields are filled, and new MACs, IPs, VLANs, rules and VPNs are added. A value that's different in UniFi is kept
        unless you tick "Also replace values that changed".
      </p>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={runImport} disabled={!total || importing || !plan} className="btn-primary">
          {importing ? 'Importing…' : `Import ${total || ''} item${total !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
