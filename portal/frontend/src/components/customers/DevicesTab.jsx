import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Monitor, Server, Printer, Network, HardDrive, Shield, Router, HelpCircle, Copy, Check, ArrowDownAZ, CloudDownload, ScreenShare, ShieldCheck, Wifi, Globe, ExternalLink, TerminalSquare } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { integrationsApi } from '../../api/integrations.js';
import { ConnectWiseImport } from './ConnectWiseImport.jsx';
import { UnifiImport } from './UnifiImport.jsx';
import { DellWarrantySync } from './DellWarrantySync.jsx';
import { MenuButton } from '../ui/MenuButton.jsx';
import { Modal } from '../ui/Modal.jsx';
import { CredentialField } from '../ui/CredentialField.jsx';
import { PasswordInput } from '../ui/PasswordInput.jsx';
import { DragList } from '../ui/DragList.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { OfficeFilterBar, OfficeSelect, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor, officeName } from '../ui/office.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { matchesQuery } from '../../utils/search.js';
import { externalHref } from '../../utils/url.js';
import { copyText } from '../../utils/clipboard.js';
import { formatDate, toDateInput } from '../../utils/date.js';
import { alphaCompare, ipCompare, dateCompare, sortWith, isSortedWith } from '../../utils/sort.js';
import { pluralize } from '../../utils/plural.js';
import { useIntegrations } from '../../hooks/useIntegrations.js';

const DEVICE_TYPES = [
  { value: 'workstation', label: 'Workstation', icon: Monitor },
  { value: 'server',      label: 'Server',      icon: Server },
  { value: 'firewall',    label: 'Firewall',    icon: Shield },
  { value: 'switch',      label: 'Switch',      icon: Router },
  { value: 'printer',     label: 'Printer',     icon: Printer },
  { value: 'nas',         label: 'NAS',         icon: HardDrive },
  { value: 'network',     label: 'Network',     icon: Network },
  { value: 'other',       label: 'Other',       icon: HelpCircle },
];

const POE_OPTIONS = [
  { value: '',      label: '—' },
  { value: 'none',  label: 'Non-PoE' },
  { value: 'poe',   label: 'PoE' },
  { value: 'poe+',  label: 'PoE+' },
  { value: 'poe++', label: 'PoE++' },
];
// How the device's IP is assigned (filled by the UniFi import, editable on any device).
const IP_ASSIGNMENT_OPTIONS = [
  { value: '',            label: '—' },
  { value: 'dhcp',        label: 'DHCP' },
  { value: 'reservation', label: 'DHCP reservation' },
  { value: 'static',      label: 'Static' },
];
const MANAGED_OPTIONS = [
  { value: '',      label: '—' },
  { value: 'true',  label: 'Managed' },
  { value: 'false', label: 'Unmanaged' },
];

// --- Per-type field registry ---------------------------------------------------
// One source of truth so the FORM and the DISPLAY always show the same fields, in
// the same order, for a given device type.

// `suggest: true` → field offers autocomplete from values entered on OTHER customers
// (cuts down typos/casing drift on recurring values like manufacturer/model/OS).
// Unique-per-device fields (tag, serial, IP, name, assignee) intentionally don't.
const FIELD_DEFS = {
  assigned_to:      { label: 'Assigned To',      placeholder: 'Front desk' },
  computer_name:    { label: 'Computer Name',    placeholder: '' },
  model:            { label: 'Model',            placeholder: 'Dell OptiPlex 7090', suggest: true },
  service_tag:      { label: 'Service Tag',      placeholder: '' },
  processor:        { label: 'Processor',        placeholder: 'i7-12700', suggest: true },
  ram:              { label: 'RAM',              placeholder: '16GB', suggest: true },
  operating_system: { label: 'Operating System', placeholder: 'Windows 11 Pro', suggest: true },
  warranty_expires: { label: 'Warranty Expires', placeholder: '', type: 'date' },
  ip_address:       { label: 'IP Address',       placeholder: '192.168.1.50' },
  ip_assignment:    { label: 'IP Assignment',    type: 'select', options: IP_ASSIGNMENT_OPTIONS },
  mac_address:      { label: 'MAC Address',      placeholder: '00:11:22:33:44:55' },
  driver_url:       { label: 'Driver / Mgmt Link', placeholder: 'https://…', link: true },
  managed_by:       { label: 'Managed By',       placeholder: 'Us / ISP / 3rd-party', suggest: true },
  manager_email:    { label: 'Manager Email',    placeholder: '', suggest: true },
  // Network gear
  manufacturer:     { label: 'Manufacturer',     placeholder: 'SonicWall / Ubiquiti / Cisco', suggest: true },
  firmware_version: { label: 'Firmware',         placeholder: '7.0.1' },
  serial_number:    { label: 'Serial Number',    placeholder: '' },
  license_expires:  { label: 'License Expires',  placeholder: '', type: 'date' },
  poe_type:         { label: 'PoE',              type: 'select', options: POE_OPTIONS },
  managed_switch:   { label: 'Managed?',         type: 'select', options: MANAGED_OPTIONS, bool: true },
  port_count:       { label: 'Ports',            placeholder: '24', type: 'number' },
};

const COMPUTER_SCALARS = ['assigned_to', 'computer_name', 'ip_address', 'ip_assignment', 'model', 'service_tag', 'mac_address', 'processor', 'ram', 'operating_system', 'warranty_expires'];

// Scalar fields shown per type, in display order.
const TYPE_SCALARS = {
  workstation: COMPUTER_SCALARS,
  server:      COMPUTER_SCALARS,
  firewall:    ['manufacturer', 'model', 'firmware_version', 'serial_number', 'mac_address', 'managed_by', 'manager_email', 'driver_url', 'license_expires'],
  switch:      ['manufacturer', 'model', 'ip_address', 'ip_assignment', 'firmware_version', 'serial_number', 'mac_address', 'port_count', 'poe_type', 'managed_switch', 'managed_by', 'manager_email', 'driver_url'],
  printer:     ['manufacturer', 'model', 'ip_address', 'ip_assignment', 'mac_address', 'driver_url'],
  nas:         ['manufacturer', 'model', 'ip_address', 'ip_assignment', 'mac_address'],
  network:     ['manufacturer', 'model', 'ip_address', 'ip_assignment', 'mac_address', 'managed_by', 'manager_email'],
  other:       ['manufacturer', 'model', 'ip_address', 'ip_assignment', 'mac_address'],
};

// Which credential blocks each type uses, and what to call them.
const TYPE_CREDS = {
  workstation: [['user', 'User'], ['admin', 'Admin']],
  server:      [['user', 'User'], ['admin', 'Admin']],
  firewall:    [['admin', 'Admin']],
  switch:      [['admin', 'Admin']],
  printer:     [['admin', 'Printer Admin']],
  nas:         [['user', 'NAS Login']],
  network:     [['admin', 'Admin']],
  other:       [['user', 'User'], ['admin', 'Admin']],
};

const hasDrives = (t) => t === 'workstation' || t === 'server';
// NAS shares, plus shared folders on PCs/servers (e.g. a Scans folder for scan-to-folder).
const hasShares = (t) => t === 'nas' || t === 'workstation' || t === 'server';
// Firewalls show internal + external (WAN) IP lists; switches show internal only.
const hasInternalIps = (t) => t === 'firewall' || t === 'switch';
const hasExternalIps = (t) => t === 'firewall';
// VLANs apply to firewalls and switches; plain-english rules to firewalls.
const hasVlans = (t) => t === 'firewall' || t === 'switch';
const hasRules = (t) => t === 'firewall';

function DeviceIcon({ type, size = 16 }) {
  const dt = DEVICE_TYPES.find(d => d.value === type) ?? DEVICE_TYPES[DEVICE_TYPES.length - 1];
  return <dt.icon size={size} className="text-gray-500" />;
}

// --- Repeating-row editors (storage drives / NAS share paths) ------------------

function RowListEditor({ rows, onChange, columns, addLabel }) {
  const update = (i, key, val) => onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const add = () => onChange([...rows, Object.fromEntries(columns.map(c => [c.key, '']))]);
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          {columns.map(c => (
            <input
              key={c.key}
              className={`input ${c.width ?? 'flex-1'}`}
              value={row[c.key] ?? ''}
              onChange={e => update(i, c.key, e.target.value)}
              placeholder={c.placeholder}
              autoComplete="off" data-1p-ignore data-lpignore="true"
            />
          ))}
          <button type="button" onClick={() => remove(i)}
            className="btn-ghost p-2 hover:text-red-400 shrink-0" aria-label="Remove row">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="btn-ghost text-xs flex items-center gap-1 py-1">
        <Plus size={12} /> {addLabel}
      </button>
    </div>
  );
}

// --- VLAN editor (firewall/switch) ---------------------------------------------
// Each VLAN carries network details plus a nested list of static devices.

const VLAN_FIELDS = [
  ['vlan_id', 'VLAN ID', '10'],
  ['name', 'Name', 'Staff'],
  ['ip_group', 'IP Group / Subnet', '10.0.10.0/24'],
  ['gateway', 'Default Gateway', '10.0.10.1'],
  ['subnet_mask', 'Subnet Mask', '255.255.255.0'],
  ['dhcp_range', 'DHCP Range', '10.0.10.100-10.0.10.200'],
  ['static_ranges', 'Static Ranges', '10.0.10.2-10.0.10.99'],
  ['dns', 'DNS', '10.0.10.1, 1.1.1.1'],
];

// Stable client-side id for drag-tracking + React keys. Persists into the JSONB
// (harmless) so order survives saves and existing VLANs get an id on first edit.
const vlanId = () => `v_${Math.random().toString(36).slice(2, 10)}`;
export const withVlanIds = (vlans) => (vlans ?? []).map(v => ({ id: v.id ?? vlanId(), ...v }));

function VlanEditor({ vlans, onChange }) {
  const blank = () => ({ id: vlanId(), vlan_id: '', name: '', ip_group: '', gateway: '', subnet_mask: '',
    dhcp_range: '', static_ranges: '', client_isolation: false, dns: '', notes: '', static_devices: [] });
  const update = (id, patch) => onChange(vlans.map(v => v.id === id ? { ...v, ...patch } : v));
  const add = () => onChange([...vlans, blank()]);
  const remove = (id) => onChange(vlans.filter(v => v.id !== id));

  return (
    <div>
      <div className="space-y-3">
        <DragList
          items={vlans}
          onReorder={onChange}
          renderItem={(v, handle) => (
            <div className="border border-surface-600 rounded-lg p-3 bg-surface-700/40">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  {handle}
                  VLAN {v.vlan_id || '—'}{v.name ? ` · ${v.name}` : ''}
                </span>
                <button type="button" onClick={() => remove(v.id)} className="btn-ghost p-1 hover:text-red-400" aria-label="Remove VLAN">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {VLAN_FIELDS.map(([key, label, ph]) => (
                  <div key={key}>
                    <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                    <input className="input text-sm py-1" value={v[key] ?? ''} placeholder={ph}
                      onChange={e => update(v.id, { [key]: e.target.value })}
                      autoComplete="off" data-1p-ignore data-lpignore="true" />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 mt-2 cursor-pointer">
                <input type="checkbox" checked={!!v.client_isolation}
                  onChange={e => update(v.id, { client_isolation: e.target.checked })} className="accent-brand" />
                Client isolation enabled
              </label>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-0.5">VLAN Notes</label>
                <input className="input text-sm py-1" value={v.notes ?? ''}
                  onChange={e => update(v.id, { notes: e.target.value })}
                  autoComplete="off" data-1p-ignore data-lpignore="true" />
              </div>

              {/* Static devices nested in this VLAN */}
              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Static Devices</label>
                <RowListEditor
                  rows={v.static_devices ?? []}
                  onChange={(rows) => update(v.id, { static_devices: rows })}
                  addLabel="Add static device"
                  columns={[
                    { key: 'name', placeholder: 'NVR / Printer', width: 'w-36' },
                    { key: 'ip',   placeholder: '10.0.10.20',   width: 'w-32' },
                    { key: 'mac',  placeholder: 'MAC (optional)', width: 'w-40' },
                    { key: 'notes', placeholder: 'note' },
                  ]}
                />
              </div>
            </div>
          )}
        />
      </div>
      <button type="button" onClick={add} className="btn-ghost text-xs flex items-center gap-1 py-1 mt-3">
        <Plus size={12} /> Add VLAN
      </button>
    </div>
  );
}

// --- Firewall rules editor (plain english) -------------------------------------

// --- VPN editor (firewall) -----------------------------------------------------
// Documents a firewall's VPNs - settings and who uses them, never the keys (a site-to-site
// key lives in Credentials). The UniFi import fills these; anything typed here survives it.

const VPN_FIELDS = [
  ['type', 'Type', 'WireGuard server / Site-to-site IPsec / SSL VPN'],
  ['name', 'Name', 'Staff VPN'],
  ['subnet', 'VPN Subnet', '192.168.2.0/24'],
  ['port', 'Port', '51820'],
  ['peer', 'Remote Peer', '203.0.113.20'],
  ['remote_subnets', 'Remote Subnets', '10.20.0.0/24'],
  ['users', 'Users', 'Mandy (192.168.2.3)'],
  ['details', 'Settings', 'IKEv2 AES256/SHA256 DH14'],
];

function VpnEditor({ vpns, onChange }) {
  const update = (i, patch) => onChange(vpns.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const add = () => onChange([...vpns, { type: '', name: '', subnet: '', port: '', peer: '', remote_subnets: '', users: '', details: '', notes: '', enabled: true }]);
  const remove = (i) => onChange(vpns.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-3">
      {vpns.map((v, i) => (
        <div key={v.external_id || i} className="bg-surface-700/50 rounded-sm p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{v.source === 'unifi' ? 'From UniFi — refreshed on the next import (notes are kept)' : 'Entered by hand'}</span>
            <button type="button" onClick={() => remove(i)} className="btn-ghost p-1.5 hover:text-red-400" aria-label="Remove VPN"><Trash2 size={13} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {VPN_FIELDS.map(([key, label, placeholder]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                <input className="input" value={v[key] ?? ''} placeholder={placeholder}
                  onChange={e => update(i, { [key]: e.target.value })} autoComplete="off" data-1p-ignore data-lpignore="true" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Notes</label>
            <input className="input" value={v.notes ?? ''} onChange={e => update(i, { notes: e.target.value })}
              autoComplete="off" data-1p-ignore data-lpignore="true" />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="btn-ghost text-xs flex items-center gap-1 py-1">
        <Plus size={12} /> Add VPN
      </button>
    </div>
  );
}

function RulesEditor({ rules, onChange }) {
  const update = (i, patch) => onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const add = () => onChange([...rules, { number: '', text: '' }]);
  const remove = (i) => onChange(rules.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input className="input w-16 shrink-0" value={r.number ?? ''} placeholder="#"
            onChange={e => update(i, { number: e.target.value })}
            autoComplete="off" data-1p-ignore data-lpignore="true" />
          <textarea className="input resize-none flex-1" rows={2} value={r.text ?? ''}
            placeholder="e.g. Allow Staff VLAN → Internet; block Guest VLAN → LAN"
            onChange={e => update(i, { text: e.target.value })} />
          <button type="button" onClick={() => remove(i)} className="btn-ghost p-2 hover:text-red-400 shrink-0" aria-label="Remove rule">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="btn-ghost text-xs flex items-center gap-1 py-1">
        <Plus size={12} /> Add rule
      </button>
    </div>
  );
}

// --- Autocomplete input -------------------------------------------------------
// Free-typed text field that suggests values entered for the same field on other
// customers/devices (server-side distinct match). You can always type a new value;
// the dropdown just helps keep recurring values (e.g. "SonicWall") consistent.

function AutocompleteInput({ customerId, field, deviceType, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = (value || '').trim();
    const t = setTimeout(async () => {
      try {
        const { data } = await customersApi.devices.suggest(customerId, field, deviceType, q);
        // Hide an exact-match-only list (nothing useful to pick).
        setOptions((data || []).filter(o => o.toLowerCase() !== q.toLowerCase()));
      } catch { setOptions([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [value, field, deviceType, customerId]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input" value={value} placeholder={placeholder} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden max-h-48 overflow-y-auto shadow-xl">
          {options.map(o => (
            <button key={o} type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-surface-700">
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Form ----------------------------------------------------------------------

function DeviceForm({ customerId, device, locations, companyName, defaultLocationId, onClose, onSaved }) {
  const [form, setForm] = useState({
    device_type: device?.device_type ?? 'workstation',
    location_id: device?.location_id ?? defaultLocationId ?? '',
    label: device?.label ?? '', assigned_to: device?.assigned_to ?? '',
    computer_name: device?.computer_name ?? '', model: device?.model ?? '',
    service_tag: device?.service_tag ?? '', processor: device?.processor ?? '',
    ram: device?.ram ?? '', operating_system: device?.operating_system ?? '',
    warranty_expires: toDateInput(device?.warranty_expires),
    ip_address: device?.ip_address ?? '', ip_assignment: device?.ip_assignment ?? '', mac_address: device?.mac_address ?? '', driver_url: device?.driver_url ?? '',
    managed_by: device?.managed_by ?? '', manager_email: device?.manager_email ?? '',
    manufacturer: device?.manufacturer ?? '', firmware_version: device?.firmware_version ?? '',
    serial_number: device?.serial_number ?? '',
    wan_subnet_mask: device?.wan_subnet_mask ?? '', wan_gateway: device?.wan_gateway ?? '', wan_dns: device?.wan_dns ?? '',
    license_expires: toDateInput(device?.license_expires),
    poe_type: device?.poe_type ?? '',
    managed_switch: device?.managed_switch == null ? '' : String(device.managed_switch),
    port_count: device?.port_count ?? '',
    username: device?.username ?? '', password: '',
    admin_username: device?.admin_username ?? '', admin_password: '',
    ssl_vpn_psk: '',
    apps_installed: device?.apps_installed ?? '', notes: device?.notes ?? '',
  });
  // New computers start with a C: drive by default; existing devices keep theirs.
  const [drives, setDrives] = useState(
    device?.storage_drives?.length
      ? device.storage_drives
      : (device ? [] : [{ label: 'C:', size: '' }])
  );
  const [shares, setShares] = useState(device?.share_paths ?? []);
  // A device's other network cards (Wi-Fi vs the network port) - [{ mac, note }].
  const [otherMacs, setOtherMacs] = useState(device?.other_macs ?? []);
  // IP lists stored as ["10.0.0.1", …]; edited as [{ ip }] rows for the editor.
  const [internalIps, setInternalIps] = useState((device?.internal_ips ?? []).map(ip => ({ ip })));
  const [externalIps, setExternalIps] = useState((device?.external_ips ?? []).map(ip => ({ ip })));
  const [vlans, setVlans] = useState(withVlanIds(device?.vlans));
  const [rules, setRules] = useState(device?.firewall_rules ?? []);
  const [vpns, setVpns] = useState(device?.vpns ?? []);
  // Printer scan/fax options (email_password kept blank; blank on save = keep existing).
  const [printer, setPrinter] = useState(() => {
    const po = device?.printer_options ?? {};
    return {
      scan_to_folder: !!po.scan_to_folder,
      scan_paths: Array.isArray(po.scan_paths) ? po.scan_paths : [],
      scan_to_email: !!po.scan_to_email,
      email_server: po.email_server ?? '',
      email_account: po.email_account ?? '',
      email_password: '',
      email_password_set: !!po.email_password_set,
      email_notes: po.email_notes ?? '',
      has_fax: !!po.has_fax,
      fax_number: po.fax_number ?? '',
    };
  });
  const setPrinterField = (k, v) => setPrinter(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const type = form.device_type;
  const scalars = TYPE_SCALARS[type] ?? [];
  const creds = TYPE_CREDS[type] ?? [];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (!payload.admin_password) delete payload.admin_password;
      // Blank secret = keep existing; only firewalls send a PSK.
      if (!payload.ssl_vpn_psk || type !== 'firewall') delete payload.ssl_vpn_psk;
      // Coerce the select/number fields to their stored types.
      payload.managed_switch = form.managed_switch === '' ? null : form.managed_switch === 'true';
      payload.port_count = form.port_count === '' ? null : Number(form.port_count);
      // Only send the lists relevant to this type; keep the others empty.
      payload.storage_drives = hasDrives(type) ? drives.filter(d => d.label || d.size) : [];
      payload.share_paths    = hasShares(type) ? shares.filter(s => s.path || s.note) : [];
      payload.internal_ips   = hasInternalIps(type) ? internalIps.map(r => r.ip).filter(Boolean) : [];
      payload.external_ips   = hasExternalIps(type) ? externalIps.map(r => r.ip).filter(Boolean) : [];
      payload.vlans          = hasVlans(type) ? vlans : [];
      payload.firewall_rules = hasRules(type) ? rules.filter(r => r.text) : [];
      payload.vpns           = type === 'firewall' ? vpns.filter(v => v.name || v.type) : [];
      payload.other_macs     = otherMacs.filter(m => m.mac);
      // Printer-only options (omit the blank email_password unless newly entered).
      if (type === 'printer') {
        const po = { ...printer, scan_paths: printer.scan_paths.filter(s => s.path || s.note) };
        if (!po.email_password) delete po.email_password;
        delete po.email_password_set;
        payload.printer_options = po;
      } else {
        payload.printer_options = {};
      }
      if (device) {
        await customersApi.devices.update(customerId, device.id, payload);
      } else {
        await customersApi.devices.create(customerId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save. Check that migrations ran and ENCRYPTION_KEY is in .env.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      {/* Type + label always shown */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
          <select className="input" value={form.device_type} onChange={set('device_type')}>
            {DEVICE_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label / Name</label>
          <input className="input" value={form.label} onChange={set('label')}
            placeholder={type === 'printer' ? 'Front Office Printer' : type === 'nas' ? 'Backup NAS' : 'Reception PC'} />
        </div>
      </div>

      <OfficeSelect locations={locations} companyName={companyName}
        value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />

      {/* Type-specific scalar fields, two per row */}
      <div className="grid grid-cols-2 gap-3">
        {scalars.map(key => {
          const def = FIELD_DEFS[key];
          return (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-400 mb-1">{def.label}</label>
              {def.type === 'select'
                ? <select className="input" value={form[key]} onChange={set(key)}>
                    {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                : def.suggest
                ? <AutocompleteInput
                    customerId={customerId} field={key} deviceType={type}
                    value={form[key]} onChange={(v) => setForm(f => ({ ...f, [key]: v }))}
                    placeholder={def.placeholder}
                  />
                : <input
                    className="input"
                    type={def.type === 'date' ? 'date' : def.type === 'number' ? 'number' : 'text'}
                    value={form[key]}
                    onChange={set(key)}
                    placeholder={def.placeholder}
                    {...(def.type ? {} : { autoComplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true' })}
                  />}
            </div>
          );
        })}
      </div>

      {(otherMacs.length > 0 || form.mac_address) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Other MAC Addresses</label>
          <RowListEditor
            rows={otherMacs}
            onChange={setOtherMacs}
            addLabel="Add MAC address"
            columns={[{ key: 'mac', placeholder: '00:11:22:33:44:55' }, { key: 'note', placeholder: 'Wi-Fi / Dock', width: 'w-32' }]}
          />
        </div>
      )}

      {/* IP address lists (firewall/switch) */}
      {hasInternalIps(type) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Internal IP Address(es)</label>
          <RowListEditor
            rows={internalIps}
            onChange={setInternalIps}
            addLabel="Add internal IP"
            columns={[{ key: 'ip', placeholder: '10.0.0.1' }]}
          />
        </div>
      )}
      {hasExternalIps(type) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">External / WAN IP Address(es)</label>
          <RowListEditor
            rows={externalIps}
            onChange={setExternalIps}
            addLabel="Add external IP"
            columns={[{ key: 'ip', placeholder: '203.0.113.10' }]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">WAN Subnet Mask</label>
              <input className="input" value={form.wan_subnet_mask} onChange={set('wan_subnet_mask')}
                placeholder="255.255.255.248" autoComplete="off" data-1p-ignore data-lpignore="true" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">WAN Default Gateway</label>
              <input className="input" value={form.wan_gateway} onChange={set('wan_gateway')}
                placeholder="203.0.113.1" autoComplete="off" data-1p-ignore data-lpignore="true" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">WAN DNS</label>
              <input className="input" value={form.wan_dns} onChange={set('wan_dns')}
                placeholder="8.8.8.8, 1.1.1.1" autoComplete="off" data-1p-ignore data-lpignore="true" />
            </div>
          </div>
        </div>
      )}

      {hasVlans(type) && (
        <div className="border-t border-surface-600 pt-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">VLANs</label>
          <VlanEditor vlans={vlans} onChange={setVlans} />
        </div>
      )}

      {hasRules(type) && (
        <div className="border-t border-surface-600 pt-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Firewall Rules (plain english)</label>
          <RulesEditor rules={rules} onChange={setRules} />
        </div>
      )}

      {type === 'firewall' && (
        <div className="border-t border-surface-600 pt-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">VPNs</label>
          <VpnEditor vpns={vpns} onChange={setVpns} />
        </div>
      )}

      {type === 'firewall' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            SSL VPN Pre-Shared Key {device && <span className="text-gray-600">(blank = keep)</span>}
          </label>
          <PasswordInput value={form.ssl_vpn_psk} onChange={set('ssl_vpn_psk')} />
        </div>
      )}

      {/* Storage drives (workstation/server) */}
      {hasDrives(type) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Storage Drives</label>
          <RowListEditor
            rows={drives}
            onChange={setDrives}
            addLabel="Add drive"
            columns={[
              { key: 'label', placeholder: 'C: / Data', width: 'w-32' },
              { key: 'size',  placeholder: '512GB SSD' },
            ]}
          />
        </div>
      )}

      {/* Share paths (NAS) */}
      {hasShares(type) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{type === 'nas' ? 'Share Paths' : 'Shared Folders'}</label>
          <RowListEditor
            rows={shares}
            onChange={setShares}
            addLabel="Add share"
            columns={[
              { key: 'path', placeholder: '\\\\nas\\backups', width: 'w-48' },
              { key: 'note', placeholder: 'nightly backups / group share / etc.' },
            ]}
          />
        </div>
      )}

      {/* Printer scan / fax options */}
      {type === 'printer' && (
        <div className="border-t border-surface-600 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Scan / Fax</p>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={printer.scan_to_folder} className="accent-brand"
              onChange={e => setPrinterField('scan_to_folder', e.target.checked)} />
            Scan to folder
          </label>
          {printer.scan_to_folder && (
            <div className="pl-6">
              <label className="block text-xs text-gray-500 mb-1">Scan Paths</label>
              <RowListEditor
                rows={printer.scan_paths}
                onChange={(rows) => setPrinterField('scan_paths', rows)}
                addLabel="Add scan path"
                columns={[
                  { key: 'path', placeholder: '\\\\server\\scans', width: 'w-56' },
                  { key: 'note', placeholder: 'note (dept, purpose)' },
                ]}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={printer.scan_to_email} className="accent-brand"
              onChange={e => setPrinterField('scan_to_email', e.target.checked)} />
            Scan to email
          </label>
          {printer.scan_to_email && (
            <div className="pl-6 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Email Server (SMTP)</label>
                <input className="input text-sm" value={printer.email_server} autoComplete="off"
                  onChange={e => setPrinterField('email_server', e.target.value)} placeholder="smtp.office365.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Email Account</label>
                <input className="input text-sm" value={printer.email_account} autoComplete="off"
                  onChange={e => setPrinterField('email_account', e.target.value)} placeholder="scanner@customer.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">
                  Email Password {device && printer.email_password_set && <span className="text-gray-600">(blank = keep)</span>}
                </label>
                <PasswordInput value={printer.email_password}
                  onChange={e => setPrinterField('email_password', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Notes (port, TLS, etc.)</label>
                <input className="input text-sm" value={printer.email_notes} autoComplete="off"
                  onChange={e => setPrinterField('email_notes', e.target.value)} placeholder="port 587, STARTTLS" />
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={printer.has_fax} className="accent-brand"
              onChange={e => setPrinterField('has_fax', e.target.checked)} />
            Has fax
          </label>
          {printer.has_fax && (
            <div className="pl-6">
              <label className="block text-xs text-gray-500 mb-0.5">Fax Number</label>
              <input className="input text-sm w-56" value={printer.fax_number} autoComplete="off"
                onChange={e => setPrinterField('fax_number', e.target.value)} placeholder="(555) 000-0000" />
            </div>
          )}
        </div>
      )}

      {/* Credentials (per type) */}
      {creds.length > 0 && (
        <div className="border-t border-surface-600 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Credentials</p>
          <div className="grid grid-cols-2 gap-3">
            {creds.map(([kind, label]) => {
              const userKey = kind === 'admin' ? 'admin_username' : 'username';
              const passKey = kind === 'admin' ? 'admin_password' : 'password';
              return (
                <div key={kind} className="contents">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">{label} Username</label>
                    <input className="input" value={form[userKey]} onChange={set(userKey)} autoComplete="off" data-1p-ignore data-lpignore="true" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      {label} Password {device && <span className="text-gray-600">(blank = keep)</span>}
                    </label>
                    <PasswordInput value={form[passKey]} onChange={set(passKey)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notable apps - only for computers */}
      {hasDrives(type) && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Notable Apps</label>
          <input className="input" value={form.apps_installed} onChange={set('apps_installed')} placeholder="QuickBooks, Dentrix, etc." />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : device ? 'Update Device' : 'Add Device'}
        </button>
      </div>
    </form>
  );
}

// --- Display -------------------------------------------------------------------

function fmt(key, value) {
  if (value == null || value === '') return null;
  const def = FIELD_DEFS[key];
  if (def?.type === 'date') return formatDate(value);
  if (def?.bool) return value === true || value === 'true' ? 'Managed' : 'Unmanaged';
  if (def?.type === 'select') return def.options.find(o => o.value === value)?.label ?? value;
  return value;
}

// A management/driver link plus a one-click Copy button. Some firewall admin pages
// silently drop a clicked cross-site navigation (they answer only a pasted/bookmarked
// URL), so Copy → paste is the reliable path - the button makes that one click.
function LinkField({ href }) {
  const [copied, setCopied] = useState(false);
  const url = externalHref(href);
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">link</a>
      <button type="button" onClick={copy} title={copied ? 'Copied!' : `Copy ${url}`}
        className="text-gray-600 hover:text-gray-300 shrink-0">
        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

// Opens the machine in ScreenConnect - the same Join link ScreenConnect's own button uses.
// Two ways in: Remote joins the session; Backstage opens ScreenConnect's Join-with-options
// dialog, where Backstage is picked (ScreenConnect has no link straight into Backstage).
function RemoteButton({ remote }) {
  const seen = remote.online ? 'online now' : remote.last_seen ? `last seen ${formatDate(remote.last_seen)}` : 'offline';
  return (
    <span className="flex items-center">
      <a href={remote.url} target="_blank" rel="noopener noreferrer"
        title={`Open ${remote.session_name} in ScreenConnect — ${seen} (matched by ${remote.matched_by})`}
        className="btn-ghost px-2 py-1 text-xs flex items-center gap-1.5 text-accent">
        <ScreenShare size={13} /> Remote
        <span className={`w-1.5 h-1.5 rounded-full ${remote.online ? 'bg-green-400' : 'bg-gray-600'}`} />
      </a>
      {remote.options_url && (
        <a href={remote.options_url} target="_blank" rel="noopener noreferrer"
          title="Opens ScreenConnect's Join-with-options dialog — choose Backstage there to work without disturbing the user"
          className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 text-gray-400 hover:text-accent">
          <TerminalSquare size={13} /> Backstage
        </a>
      )}
    </span>
  );
}

// The device's own web page through Auvik's Remote Browser - HTTPS, HTTP or another port.
function WebUiButton({ web }) {
  const otherPort = () => {
    const port = window.prompt('Which port does the device\'s web page use?', '8443');
    if (!port) return;
    if (!/^\d{1,5}$/.test(port.trim()) || Number(port) > 65535) { window.alert('That isn\'t a port number.'); return; }
    window.open(web.port_url_template.replace('-PORT.', `-${port.trim()}.`), '_blank', 'noopener');
  };
  return (
    <MenuButton compact label="Web UI" icon={Globe} items={[
      { label: 'HTTPS (443)', icon: Globe, hint: `Auvik Remote Browser — ${web.auvik_name}`, onClick: () => window.open(web.https_url, '_blank', 'noopener') },
      { label: 'HTTP (80)', icon: Globe, hint: 'For older printers without HTTPS', onClick: () => window.open(web.http_url, '_blank', 'noopener') },
      { label: 'Other port…', icon: Globe, hint: 'e.g. 8443, 8080', onClick: otherPort },
      { label: 'Open the site in Auvik', icon: ExternalLink, hint: `${web.site} — for a remote tunnel`, onClick: () => window.open(web.site_url, '_blank', 'noopener') },
    ]} />
  );
}

function DeviceCard({ device: d, customerId, locations, companyName, remote, web, onEdit, onDelete }) {
  const scalars = TYPE_SCALARS[d.device_type] ?? [];
  const creds = TYPE_CREDS[d.device_type] ?? [];
  const drives = Array.isArray(d.storage_drives) ? d.storage_drives : [];
  const shares = Array.isArray(d.share_paths) ? d.share_paths : [];
  const internalIps = Array.isArray(d.internal_ips) ? d.internal_ips : [];
  const externalIps = Array.isArray(d.external_ips) ? d.external_ips : [];

  return (
    <div className="card p-4">
      {/* Wraps on a phone, so Remote / Backstage / edit / delete never run off the card. */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="text-gray-200 font-medium">{d.label || d.model || d.computer_name || 'Unnamed Device'}</h5>
            <OfficeBadge locations={locations} locationId={d.location_id} companyName={companyName} />
            {d.rmm_endpoint_id && (
              <span className="badge bg-blue-900/40 text-blue-300"
                title={`Imported from ConnectWise RMM${d.rmm_synced_at ? ` · last synced ${formatDate(d.rmm_synced_at)}` : ''}`}>
                ConnectWise
              </span>
            )}
            {d.unifi_device_id && (
              <span className="badge bg-blue-900/40 text-blue-300"
                title={`Imported from UniFi${d.unifi_synced_at ? ` · last synced ${formatDate(d.unifi_synced_at)}` : ''}`}>
                UniFi
              </span>
            )}
          </div>
          {d.assigned_to && <p className="text-gray-500 text-xs mt-0.5">{d.assigned_to}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-1 items-start ml-auto">
          {remote && <RemoteButton remote={remote} />}
          {web && <WebUiButton web={web} />}
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil size={13} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Uniform grid: every field for this type is shown in the same position,
          blank when empty, so cards in a group line up consistently. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
        {scalars.map(key => {
          const def = FIELD_DEFS[key];
          const val = fmt(key, d[key]);
          return (
            <div key={key}>
              <span className="text-gray-600">{def.label}: </span>
              {def.link && val
                ? <LinkField href={val} />
                : <span className="text-gray-400">{val ?? '—'}</span>}
              {key === 'warranty_expires' && val && d.warranty_coverage && (
                <span className="text-gray-600" title={`From Dell${d.warranty_checked_at ? `, checked ${formatDate(d.warranty_checked_at)}` : ''}`}>
                  {' '}· {d.warranty_coverage}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {Array.isArray(d.other_macs) && d.other_macs.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-gray-600">Other MACs: </span>
          {d.other_macs.map((m, i) => (
            <span key={m.mac} className="text-gray-400">
              {i > 0 && ', '}<span className="font-mono">{m.mac}</span>
              {m.note && <span className="text-gray-600"> ({m.note})</span>}
            </span>
          ))}
        </div>
      )}

      {internalIps.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-gray-600">Internal IPs: </span>
          <span className="text-gray-400 font-mono">{internalIps.join(', ')}</span>
        </div>
      )}

      {externalIps.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-gray-600">External IPs: </span>
          <span className="text-gray-400 font-mono">{externalIps.join(', ')}</span>
        </div>
      )}

      {d.device_type === 'firewall' && (d.wan_subnet_mask || d.wan_gateway || d.wan_dns) && (
        <div className="mt-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
          {d.wan_subnet_mask && <span><span className="text-gray-600">WAN Mask: </span><span className="text-gray-400 font-mono">{d.wan_subnet_mask}</span></span>}
          {d.wan_gateway && <span><span className="text-gray-600">WAN Gateway: </span><span className="text-gray-400 font-mono">{d.wan_gateway}</span></span>}
          {d.wan_dns && <span><span className="text-gray-600">WAN DNS: </span><span className="text-gray-400 font-mono">{d.wan_dns}</span></span>}
        </div>
      )}

      {Array.isArray(d.vlans) && d.vlans.length > 0 && (
        <div className="mt-3">
          <p className="text-gray-600 text-xs mb-1.5">VLANs</p>
          <div className="space-y-1.5">
            {d.vlans.map((v, i) => (
              <div key={i} className="text-xs bg-surface-700/50 rounded-sm p-2">
                <div className="text-gray-300">
                  <span className="font-semibold">VLAN {v.vlan_id || '—'}</span>
                  {v.name && <span> · {v.name}</span>}
                  {v.ip_group && <span className="text-gray-500 font-mono"> · {v.ip_group}</span>}
                  {v.client_isolation && <span className="text-accent"> · isolated</span>}
                </div>
                <div className="text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {v.gateway && <span>GW {v.gateway}</span>}
                  {v.subnet_mask && <span>Mask {v.subnet_mask}</span>}
                  {v.dhcp_range && <span>DHCP {v.dhcp_range}</span>}
                  {v.static_ranges && <span>Static {v.static_ranges}</span>}
                  {v.dns && <span>DNS {v.dns}</span>}
                </div>
                {v.notes && <div className="text-gray-600 mt-0.5">{v.notes}</div>}
                {Array.isArray(v.static_devices) && v.static_devices.length > 0 && (
                  <div className="mt-1 pl-2 border-l border-surface-500 space-y-0.5">
                    {v.static_devices.map((sd, j) => (
                      <div key={j} className="text-gray-500">
                        <span className="text-gray-400">{sd.name || '—'}</span>
                        {sd.ip && <span className="font-mono"> {sd.ip}</span>}
                        {sd.mac && <span className="font-mono text-gray-600"> ({sd.mac})</span>}
                        {sd.notes && <span> — {sd.notes}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(d.firewall_rules) && d.firewall_rules.length > 0 && (
        <div className="mt-3">
          <p className="text-gray-600 text-xs mb-1">Firewall Rules</p>
          <div className="space-y-0.5">
            {d.firewall_rules.map((r, i) => (
              <div key={i} className="text-xs text-gray-400">
                {r.number && <span className="text-gray-600 font-mono mr-1">#{r.number}</span>}
                {r.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(d.vpns) && d.vpns.length > 0 && (
        <div className="mt-3">
          <p className="text-gray-600 text-xs mb-1.5">VPNs</p>
          <div className="space-y-1.5">
            {d.vpns.map((v, i) => (
              <div key={v.external_id || i} className="text-xs bg-surface-700/50 rounded-sm p-2">
                <div className="text-gray-300">
                  <span className="font-semibold">{v.type || 'VPN'}</span>
                  {v.name && <span> · {v.name}</span>}
                  {v.enabled === false && <span className="text-gray-500"> · disabled</span>}
                </div>
                <div className="text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {v.subnet && <span>Subnet {v.subnet}</span>}
                  {v.port && <span>Port {v.port}</span>}
                  {v.peer && <span>Peer {v.peer}</span>}
                  {v.local && <span>Local {v.local}</span>}
                  {v.remote_subnets && <span>Remote {v.remote_subnets}</span>}
                  {v.details && <span>{v.details}</span>}
                </div>
                {v.users && <div className="text-gray-500 mt-0.5">Users: {v.users}</div>}
                {v.notes && <div className="text-gray-600 mt-0.5">{v.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {d.device_type === 'firewall' && d.has_ssl_vpn_psk && (
        <div className="mt-3 pt-3 border-t border-surface-600">
          <p className="text-gray-600 text-xs mb-1">SSL VPN Pre-Shared Key</p>
          <CredentialField
            hasValue
            onReveal={() => customersApi.devices.reveal(customerId, d.id, 'ssl_vpn_psk').then(r => r.data.value)}
          />
        </div>
      )}

      {drives.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-gray-600">Storage: </span>
          <span className="text-gray-400">
            {drives.map(dr => [dr.label, dr.size].filter(Boolean).join(' ')).filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {shares.length > 0 && (
        <div className="mt-3 text-xs">
          <p className="text-gray-600 mb-1">{d.device_type === 'nas' ? 'Share Paths' : 'Shared Folders'}</p>
          <div className="space-y-0.5">
            {shares.map((s, i) => (
              <div key={i} className="break-words">
                <span className="text-gray-300 font-mono">{s.path}</span>
                {s.note && <span className="text-gray-500"> — {s.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Local accounts - read-only, kept current by the ConnectWise import. */}
      {Array.isArray(d.local_accounts) && d.local_accounts.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-gray-600">Local accounts: </span>
          {d.local_accounts.map((a, i) => (
            <span key={a.username} className="text-gray-400">
              {i > 0 && ', '}{a.username}
              {a.admin && <span className="text-accent" title="Administrator"> (admin)</span>}
            </span>
          ))}
          <span className="text-gray-600" title="From ConnectWise RMM — refreshed on each import"> · from ConnectWise</span>
        </div>
      )}

      {creds.some(([kind]) => {
        const u = kind === 'admin' ? d.admin_username : d.username;
        const p = kind === 'admin' ? d.has_admin_password : d.has_password;
        return u || p;
      }) && (
        <div className="mt-3 pt-3 border-t border-surface-600 grid grid-cols-2 gap-4">
          {creds.map(([kind, label]) => {
            const u = kind === 'admin' ? d.admin_username : d.username;
            const has = kind === 'admin' ? d.has_admin_password : d.has_password;
            if (!u && !has) return null;
            return (
              <div key={kind}>
                <p className="text-gray-600 text-xs mb-1">{label}</p>
                <p className="text-gray-300 text-sm font-mono">{u || '—'}</p>
                <CredentialField
                  hasValue={has}
                  onReveal={() => customersApi.devices.reveal(customerId, d.id, kind === 'admin' ? 'admin_password' : 'password').then(r => r.data.value)}
                />
              </div>
            );
          })}
        </div>
      )}

      {d.device_type === 'printer' && d.printer_options && (() => {
        const po = d.printer_options;
        const anything = po.scan_to_folder || po.scan_to_email || po.has_fax;
        if (!anything) return null;
        return (
          <div className="mt-3 pt-3 border-t border-surface-600 text-xs space-y-1">
            {po.scan_to_folder && (
              <div>
                <span className="text-gray-600">Scan to folder: </span>
                {(po.scan_paths ?? []).length === 0
                  ? <span className="text-gray-400">yes</span>
                  : <span className="text-gray-400 font-mono">{po.scan_paths.map(s => s.path + (s.note ? ` (${s.note})` : '')).join(', ')}</span>}
              </div>
            )}
            {po.scan_to_email && (
              <div className="flex flex-wrap items-center gap-x-3">
                <span className="text-gray-600">Scan to email:</span>
                {po.email_account && <span className="text-gray-400">{po.email_account}</span>}
                {po.email_server && <span className="text-gray-500">@ {po.email_server}</span>}
                {po.email_password_set && (
                  <CredentialField hasValue onReveal={() =>
                    customersApi.devices.reveal(customerId, d.id, 'printer_email_password').then(r => r.data.value)} />
                )}
                {po.email_notes && <span className="text-gray-600">· {po.email_notes}</span>}
              </div>
            )}
            {po.has_fax && (
              <div><span className="text-gray-600">Fax: </span><span className="text-gray-400">{po.fax_number || 'yes'}</span></div>
            )}
          </div>
        );
      })()}

      {d.apps_installed && (
        <p className="mt-2 text-gray-600 text-xs">Apps: <span className="text-gray-400">{d.apps_installed}</span></p>
      )}
      {d.notes && <p className="mt-1 text-gray-600 text-xs whitespace-pre-wrap">{d.notes}</p>}
    </div>
  );
}

// --- Tab -----------------------------------------------------------------------

// Group heading for a device type - singular for a group of one, correctly
// pluralized otherwise ("Switch" → "Switches", not "Switchs"). "NAS" reads badly
// pluralized on its own, so it borrows "device" as its noun.
const typeLabel = (t, count = 2) => {
  const dt = DEVICE_TYPES.find(d => d.value === t);
  if (!dt) return pluralize(t, count);
  if (t === 'nas') return `NAS ${pluralize('device', count)}`;
  return pluralize(dt.label, count);
};

// --- Sort menu ---------------------------------------------------------------
// Each device-type group's "Sort ▾" offers the keys that make sense for that type and
// that at least one of its devices actually has (no "IP address" on a group with no IPs).
// Blanks sink to the bottom and ties fall back to the name, so a sort is always stable.

const deviceName = (d) => d.label || d.model || d.computer_name || '';
const deviceIp = (d) => d.ip_address || (Array.isArray(d.internal_ips) ? d.internal_ips.find(Boolean) : '') || '';
const COMPUTERS = ['workstation', 'server'];
const byName = (a, b) => alphaCompare(deviceName(a), deviceName(b));
const then = (compare) => (a, b) => compare(a, b) || byName(a, b);
const text = (field) => then((a, b) => alphaCompare(a[field], b[field]));

const SORT_OPTIONS = [
  { id: 'name',          label: 'Name',                hint: 'A–Z, as each card is titled', icon: ArrowDownAZ, value: deviceName, compare: byName },
  { id: 'ip',            label: 'IP address',          hint: '192.168.1.2 before 192.168.1.10', icon: Globe, value: deviceIp, compare: then((a, b) => ipCompare(deviceIp(a), deviceIp(b))) },
  { id: 'model',         label: 'Model',               hint: 'A–Z', icon: Monitor, value: d => d.model, compare: text('model') },
  { id: 'manufacturer',  label: 'Manufacturer',        hint: 'A–Z, then model', icon: Router, value: d => d.manufacturer,
    compare: then((a, b) => alphaCompare(a.manufacturer, b.manufacturer) || alphaCompare(a.model, b.model)) },
  { id: 'computer_name', label: 'Computer name',       hint: 'A–Z', icon: Monitor, types: COMPUTERS, value: d => d.computer_name, compare: text('computer_name') },
  { id: 'assigned_to',   label: 'Assigned to',         hint: 'A–Z', icon: Monitor, types: COMPUTERS, value: d => d.assigned_to, compare: text('assigned_to') },
  { id: 'warranty',      label: 'Warranty expiration', hint: 'Soonest first', icon: ShieldCheck, value: d => d.warranty_expires,
    compare: then((a, b) => dateCompare(a.warranty_expires, b.warranty_expires)) },
  { id: 'license',       label: 'License expiration',  hint: 'Soonest first', icon: ShieldCheck, value: d => d.license_expires,
    compare: then((a, b) => dateCompare(a.license_expires, b.license_expires)) },
];

/** The Sort menu's options for one type group. */
function sortOptionsFor(type, group, { hasOffices, officeOf }) {
  const options = SORT_OPTIONS.filter(o => (!o.types || o.types.includes(type)) && (o.id === 'name' || group.some(d => String(o.value(d) ?? '').trim())));
  if (hasOffices) {
    options.push({ id: 'office', label: 'Office', hint: 'Main office first, then each branch', icon: Globe,
      compare: then((a, b) => (Number(!!a.location_id) - Number(!!b.location_id)) || alphaCompare(officeOf(a), officeOf(b))) });
  }
  return options;
}

export function DevicesTab({ customerId, locations = [], companyName }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [office, setOffice] = useOfficeFilter(customerId, 'devices', locations);
  const [sync, setSync] = useState(null);      // 'connectwise' | 'unifi' | 'dell'
  const integrations = useIntegrations();
  const { data, refetch } = useQuery({
    queryKey: ['customers', customerId, 'devices'],
    queryFn: () => customersApi.devices.list(customerId).then(r => r.data),
  });
  // Remote (ScreenConnect) buttons - matched server-side; never blocks the tab.
  const { data: remote, error: remoteError, refetch: refetchRemote } = useQuery({
    queryKey: ['customers', customerId, 'remote-links'],
    queryFn: () => integrationsApi.remoteLinks(customerId).then(r => r.data),
    staleTime: 2 * 60_000,
    retry: false,
  });
  // Web UI (Auvik Remote Browser) buttons - matched server-side; never blocks the tab.
  const { data: web, refetch: refetchWeb } = useQuery({
    queryKey: ['customers', customerId, 'auvik-links'],
    queryFn: () => integrationsApi.webLinks(customerId).then(r => r.data),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const afterSync = () => { refetch(); refetchRemote(); refetchWeb(); };

  const allDevices = data?.devices ?? [];
  const devices    = allDevices.filter(d => officeMatches(d, office) && matchesQuery(d, search));
  const typeOrder  = data?.typeOrder ?? [];

  const remove = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await customersApi.devices.remove(customerId, id);
    refetch();
  };

  // Group devices by type, then order the groups by the server's type order.
  const groups = {};
  for (const d of devices) (groups[d.device_type] = groups[d.device_type] || []).push(d);
  // Unfiltered per-type groups - what "Sort A–Z" reorders, so sorting while a
  // search/office filter is on doesn't shuffle the hidden devices to the bottom.
  const allGroups = {};
  for (const d of allDevices) (allGroups[d.device_type] = allGroups[d.device_type] || []).push(d);
  const orderedTypes = typeOrder.map(t => t.device_type).filter(t => groups[t]);
  for (const t of Object.keys(groups)) if (!orderedTypes.includes(t)) orderedTypes.push(t);

  // Drag-reorder the type groups.
  const reorderTypes = (items) => {
    customersApi.devices.reorderTypes(customerId, items.map(i => i.id)).then(refetch);
  };
  // Drag-reorder devices within one type group.
  const reorderDevices = (type) => (items) => {
    customersApi.devices.reorder(customerId, items.map(i => i.id)).then(refetch);
  };
  // Sort one type group by the key picked from its Sort menu; persists like a drag.
  const officeOf = (d) => officeName(locations, d.location_id, companyName) ?? '';
  const sortDevices = (type, compare) => {
    const ids = sortWith(allGroups[type] ?? [], compare).map(d => d.id);
    customersApi.devices.reorder(customerId, ids).then(refetch);
  };

  const typeItems = orderedTypes.map(t => ({ id: t }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto">
          <SearchInput value={search} onChange={setSearch} placeholder="Search devices (name, model, 16GB, IP…)" className="w-full sm:w-72" />
          <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} />
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto w-full sm:w-auto">
          {(integrations.connectwise || integrations.unifi || integrations.dell) && (
          <MenuButton label="Import & sync" icon={CloudDownload} className="flex-1 sm:flex-none" items={[
            integrations.connectwise && { label: 'ConnectWise RMM', icon: Monitor, hint: 'Computers and servers, with their hardware', onClick: () => setSync('connectwise') },
            integrations.unifi && { label: 'UniFi', icon: Wifi, hint: 'Firewall (WAN, VLANs, rules), switches, APs', onClick: () => setSync('unifi') },
            integrations.dell && { label: 'Dell warranties', icon: ShieldCheck, hint: 'Warranty dates by service tag', onClick: () => setSync('dell') },
          ].filter(Boolean)} />
          )}
          <button onClick={() => setModal('new')} className="btn-primary flex items-center justify-center gap-2 text-sm flex-1 sm:flex-none whitespace-nowrap">
            <Plus size={14} /> Add Device
          </button>
        </div>
      </div>

      {remote?.configured === false && (
        <p className="text-xs text-gray-500 bg-surface-700/50 rounded-sm p-2 mb-4">
          Remote buttons are off on this server: set <code className="text-accent">SCREENCONNECT_URL</code> and{' '}
          <code className="text-accent">SCREENCONNECT_API_SECRET</code> in the Portal backend's <code className="text-accent">.env</code>, then restart it.
        </p>
      )}
      {web?.error && (
        <p className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2 mb-4">Web UI buttons are unavailable: {web.error}</p>
      )}
      {(remote?.error || remoteError) && (
        <p className="text-xs text-amber-400 bg-amber-900/20 rounded-sm p-2 mb-4">
          Remote buttons are unavailable: {remote?.error
            ?? (remoteError?.response?.status === 404
              ? 'the Portal backend is running an older version — restart it to pick up the ScreenConnect integration.'
              : remoteError?.response?.data?.error ?? 'the Portal backend could not be reached.')}
        </p>
      )}

      {allDevices.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No devices yet"
          description="Add workstations, servers, printers, NAS, and network equipment."
        />
      ) : devices.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No devices match.</p>
      ) : null}

      <div className="space-y-6">
        <DragList
          items={typeItems}
          onReorder={reorderTypes}
          renderItem={(t, handle) => (
            <div className="mb-6">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  {handle}
                  <DeviceIcon type={t.id} size={13} /> {typeLabel(t.id, (groups[t.id] ?? []).length)}
                </h4>
                {(() => {
                  const group = allGroups[t.id] ?? [];
                  if (group.length < 2) return null;
                  const items = sortOptionsFor(t.id, group, { hasOffices: locations.length > 0, officeOf }).map(o => {
                    const sorted = isSortedWith(group, o.compare);
                    return { label: o.label, icon: o.icon, hint: sorted ? 'Already in this order' : o.hint, disabled: sorted, onClick: () => sortDevices(t.id, o.compare) };
                  });
                  return <MenuButton compact label="Sort" icon={ArrowDownAZ} items={items} className="shrink-0" />;
                })()}
              </div>
              <DragList
                items={groups[t.id]}
                onReorder={reorderDevices(t.id)}
                itemClassName="mb-2"
                renderItem={(d, dHandle) => (
                  <div className="flex items-start gap-1">
                    <div className="pt-4">{dHandle}</div>
                    <div className="flex-1 min-w-0">
                      <DeviceCard
                        device={d}
                        customerId={customerId}
                        locations={locations}
                        companyName={companyName}
                        remote={remote?.links?.[d.id]}
                        web={web?.links?.[d.id]}
                        onEdit={() => setModal(d)}
                        onDelete={() => remove(d.id, d.label || d.model || 'device')}
                      />
                    </div>
                  </div>
                )}
              />
            </div>
          )}
        />
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add Device' : 'Edit Device'} size="lg">
        {modal !== null && (
          <DeviceForm
            customerId={customerId}
            device={modal === 'new' ? null : modal}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>

      <Modal open={sync === 'connectwise'} onClose={() => setSync(null)} title="Import from ConnectWise RMM" size="lg">
        {sync === 'connectwise' && (
          <ConnectWiseImport
            customerId={customerId}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setSync(null)}
            onImported={afterSync}
          />
        )}
      </Modal>

      <Modal open={sync === 'unifi'} onClose={() => setSync(null)} title="Import from UniFi" size="lg">
        {sync === 'unifi' && (
          <UnifiImport
            customerId={customerId}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setSync(null)}
            onImported={afterSync}
          />
        )}
      </Modal>

      <Modal open={sync === 'dell'} onClose={() => setSync(null)} title="Check Dell warranties" size="lg">
        {sync === 'dell' && <DellWarrantySync customerId={customerId} onClose={() => setSync(null)} onApplied={refetch} />}
      </Modal>
    </div>
  );
}
