import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Camera, UserPlus, X, Check, ArrowDownAZ, CalendarDays, MapPin, CloudDownload } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { UnifiImport } from './UnifiImport.jsx';
import { Modal } from '../ui/Modal.jsx';
import { CredentialField } from '../ui/CredentialField.jsx';
import { PasswordInput } from '../ui/PasswordInput.jsx';
import { DragList } from '../ui/DragList.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { OfficeFilterBar, OfficeSelect, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor } from '../ui/office.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { noAutofill } from '../ui/noAutofill.js';
import { matchesQuery } from '../../utils/search.js';
import { sortByName, isSortedByName } from '../../utils/sort.js';
import { formatDate, toDateInput } from '../../utils/date.js';
import { useIntegrations } from '../../hooks/useIntegrations.js';

// --- Camera system form -------------------------------------------------------

function CameraForm({ customerId, camera, locations, companyName, defaultLocationId, onClose, onSaved }) {
  const [form, setForm] = useState({
    label:         camera?.label         ?? '',
    location_id:   camera?.location_id   ?? defaultLocationId ?? '',
    channel_count: camera?.channel_count ?? '',
    system_type:   camera?.system_type   ?? 'NVR',
    model:         camera?.model         ?? '',
    serial_number: camera?.serial_number ?? '',
    ip_address:      camera?.ip_address      ?? '',
    username:        camera?.username        ?? '',
    password:        '',
    shared_with:     camera?.shared_with     ?? '',
    notes:           camera?.notes           ?? '',
    install_date:    toDateInput(camera?.install_date),
    system_location: camera?.system_location ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, channel_count: form.channel_count ? parseInt(form.channel_count) : null };
      if (!payload.password) delete payload.password;
      if (camera) {
        await customersApi.cameras.update(customerId, camera.id, payload);
      } else {
        await customersApi.cameras.create(customerId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save camera system.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
          <input className="input" value={form.label} onChange={set('label')} placeholder="Main NVR" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
          <select className="input" value={form.system_type} onChange={set('system_type')}>
            <option>NVR</option><option>DVR</option><option>Cloud</option><option>Hybrid</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Channels</label>
          <input className="input" type="number" min="1" value={form.channel_count}
            onChange={set('channel_count')} onWheel={e => e.currentTarget.blur()} />
        </div>
      </div>

      <OfficeSelect locations={locations} companyName={companyName}
        value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
          <input className="input" value={form.model} onChange={set('model')} placeholder="Hikvision DS-7616NI-Q2" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Serial #</label>
          <input className="input" value={form.serial_number} onChange={set('serial_number')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Install Date</label>
          <input className="input" type="date" value={form.install_date} onChange={set('install_date')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            System Location <span className="text-gray-600 font-normal">(where the box sits)</span>
          </label>
          <input className="input" value={form.system_location} onChange={set('system_location')}
            placeholder="e.g. Server closet, back wall rack" />
        </div>
      </div>

      <div className="border-t border-surface-600 pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Our Login</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">IP Address</label>
            <input className="input" value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
            <input className="input" value={form.username} onChange={set('username')} autoComplete="off" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Password {camera && <span className="text-gray-600">(blank = keep)</span>}
            </label>
            <input className="input font-mono" type="password" value={form.password}
              onChange={set('password')} autoComplete="new-password" />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">General Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : camera ? 'Update System' : 'Add System'}
        </button>
      </div>
    </form>
  );
}

// --- Shared access user form --------------------------------------------------

function SharedUserForm({ customerId, cameraId, entry, onClose, onSaved }) {
  const [form, setForm] = useState({
    label:    entry?.label    ?? '',
    username: entry?.username ?? '',
    password: '',
    notes:    entry?.notes    ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (entry) {
        await customersApi.cameras.shared.update(customerId, cameraId, entry.id, payload);
      } else {
        await customersApi.cameras.shared.create(customerId, cameraId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Who is this? *</label>
        <input className="input" value={form.label} onChange={set('label')} required
          placeholder="e.g. Customer, ABC Monitoring, Owner" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
          <input className="input" value={form.username} onChange={set('username')} autoComplete="off" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Password {entry && <span className="text-gray-600">(blank = keep)</span>}
          </label>
          <input className="input font-mono" type="password" value={form.password}
            onChange={set('password')} autoComplete="new-password" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <input className="input" value={form.notes} onChange={set('notes')}
          placeholder="e.g. viewer access only, no PTZ control" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.label} className="btn-primary">
          {saving ? 'Saving…' : entry ? 'Update' : 'Add User'}
        </button>
      </div>
    </form>
  );
}

// --- Shared users list (inline in camera card) --------------------------------

function SharedAccessSection({ customerId, cameraId }) {
  const [modal, setModal] = useState(null);
  const { data: users = [], refetch } = useQuery({
    queryKey: ['cameras', cameraId, 'shared'],
    queryFn: () => customersApi.cameras.shared.list(customerId, cameraId).then(r => r.data),
  });

  const remove = async (id, label) => {
    if (!confirm(`Remove access for "${label}"?`)) return;
    await customersApi.cameras.shared.remove(customerId, cameraId, id);
    refetch();
  };

  return (
    <div className="mt-3 pt-3 border-t border-surface-600">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Additional Logins {users.length > 0 && <span className="text-gray-600">({users.length})</span>}
        </p>
        <button
          onClick={() => setModal('new')}
          className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1"
        >
          <UserPlus size={11} /> Add Login
        </button>
      </div>

      {users.length === 0 ? (
        <p className="text-gray-600 text-xs">No additional logins. Click Add Login to record the customer's or a monitoring company's access.</p>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-start justify-between bg-surface-600/50 rounded-lg px-3 py-2">
              <div className="flex-1">
                <p className="text-gray-300 text-sm font-medium">{u.label}</p>
                <div className="flex items-center gap-6 mt-1">
                  <div>
                    <span className="text-gray-600 text-xs">User: </span>
                    <span className="text-gray-400 text-xs font-mono">{u.username || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600 text-xs">Pass: </span>
                    <CredentialField
                      hasValue={u.has_password}
                      onReveal={() => customersApi.cameras.shared.reveal(customerId, cameraId, u.id).then(r => r.data.value)}
                    />
                  </div>
                </div>
                {u.notes && <p className="text-gray-600 text-xs mt-0.5">{u.notes}</p>}
              </div>
              <div className="flex gap-1 ml-3 shrink-0">
                <button onClick={() => setModal(u)} className="btn-ghost p-1 text-gray-600 hover:text-gray-300">
                  <Pencil size={12} />
                </button>
                <button onClick={() => remove(u.id, u.label)} className="btn-ghost p-1 text-gray-600 hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add Login' : 'Edit Login'}
        size="sm"
      >
        {modal !== null && (
          <SharedUserForm
            customerId={customerId}
            cameraId={cameraId}
            entry={modal === 'new' ? null : modal}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>
    </div>
  );
}

// --- Individual camera form ---------------------------------------------------

const CAMERA_TYPES = ['', 'Dome', 'Bullet', 'Turret', 'PTZ', 'Fisheye', 'Multi-sensor', 'Other'];

function CameraDeviceForm({ customerId, systemId, cam, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:          cam?.name          ?? '',
    channel:       cam?.channel       ?? '',
    ip_address:    cam?.ip_address    ?? '',
    mac_address:   cam?.mac_address   ?? '',
    manufacturer:  cam?.manufacturer  ?? '',
    model:         cam?.model         ?? '',
    serial_number: cam?.serial_number ?? '',
    camera_type:   cam?.camera_type   ?? '',
    resolution:    cam?.resolution    ?? '',
    firmware:      cam?.firmware      ?? '',
    connected_to:  cam?.connected_to  ?? '',
    install_date:  toDateInput(cam?.install_date),
    username:      cam?.username      ?? '',
    password:      '',
    notes:         cam?.notes         ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (cam) await customersApi.cameras.cams.update(customerId, systemId, cam.id, payload);
      else     await customersApi.cameras.cams.create(customerId, systemId, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save camera.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Name / Location *</label>
          <input className="input" value={form.name} onChange={set('name')} required
            placeholder="e.g. Front Door, Warehouse NE corner" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Channel / Port</label>
          <input className="input" value={form.channel} onChange={set('channel')} placeholder="e.g. 4" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">IP Address</label>
          <input className="input font-mono" value={form.ip_address} onChange={set('ip_address')}
            placeholder="192.168.1.64" {...noAutofill} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">MAC Address</label>
          <input className="input font-mono" value={form.mac_address} onChange={set('mac_address')}
            placeholder="AA:BB:CC:DD:EE:FF" {...noAutofill} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Manufacturer</label>
          <input className="input" value={form.manufacturer} onChange={set('manufacturer')} placeholder="Hikvision" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
          <input className="input" value={form.model} onChange={set('model')} placeholder="DS-2CD2143G2-I" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Serial #</label>
          <input className="input" value={form.serial_number} onChange={set('serial_number')} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
          <select className="input" value={form.camera_type} onChange={set('camera_type')}>
            {CAMERA_TYPES.map(t => <option key={t} value={t}>{t || '—'}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Resolution</label>
          <input className="input" value={form.resolution} onChange={set('resolution')} placeholder="4MP" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Firmware</label>
          <input className="input" value={form.firmware} onChange={set('firmware')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Connected To <span className="text-gray-600 font-normal">(switch / port / injector)</span>
          </label>
          <input className="input" value={form.connected_to} onChange={set('connected_to')}
            placeholder="e.g. PoE switch port 6" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Install Date</label>
          <input className="input" type="date" value={form.install_date} onChange={set('install_date')} />
        </div>
      </div>

      {/* Many camera lines are activated with a per-camera password rather than the
          NVR's, so each camera can carry its own login. Encrypted like every other. */}
      <div className="border-t border-surface-600 pt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
          <input className="input" value={form.username} onChange={set('username')} {...noAutofill} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Password {cam && <span className="text-gray-600">(blank = keep)</span>}
          </label>
          <PasswordInput value={form.password} onChange={set('password')} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
          {saving ? 'Saving…' : cam ? 'Update Camera' : 'Add Camera'}
        </button>
      </div>
    </form>
  );
}

// --- Cameras list (inline in the system card) ---------------------------------

function CameraRow({ cam, customerId, systemId, onEdit, onDelete }) {
  // Compact spec line - only the fields that are actually filled in.
  const specs = [
    cam.camera_type,
    cam.resolution,
    [cam.manufacturer, cam.model].filter(Boolean).join(' '),
    cam.serial_number && `S/N: ${cam.serial_number}`,
    cam.firmware && `FW: ${cam.firmware}`,
    cam.connected_to,
    cam.install_date && `Installed ${formatDate(cam.install_date)}`,
  ].filter(Boolean);

  return (
    <div className="flex items-start justify-between gap-3 bg-surface-600/50 rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {cam.channel && (
            <span className="text-xs font-mono text-gray-400 bg-surface-700 rounded-sm px-1.5 py-0.5 shrink-0">
              CH {cam.channel}
            </span>
          )}
          <p className="text-gray-300 text-sm font-medium">{cam.name || 'Unnamed camera'}</p>
          {cam.unifi_device_id && (
            <span className="badge bg-blue-900/40 text-blue-300"
              title={`Imported from UniFi Protect${cam.unifi_synced_at ? ` · last synced ${formatDate(cam.unifi_synced_at)}` : ''}`}>UniFi</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
          {cam.ip_address && (
            <span className="text-xs"><span className="text-gray-600">IP: </span>
              <span className="text-gray-400 font-mono">{cam.ip_address}</span></span>
          )}
          {cam.mac_address && (
            <span className="text-xs"><span className="text-gray-600">MAC: </span>
              <span className="text-gray-400 font-mono">{cam.mac_address}</span></span>
          )}
          {(cam.username || cam.has_password) && (
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="text-gray-600">Login: </span>
              <span className="text-gray-400 font-mono">{cam.username || '—'}</span>
              {cam.has_password && (
                <CredentialField
                  hasValue={cam.has_password}
                  onReveal={() => customersApi.cameras.cams.reveal(customerId, systemId, cam.id).then(r => r.data.value)}
                />
              )}
            </span>
          )}
        </div>
        {specs.length > 0 && (
          <p className="text-gray-600 text-xs mt-1">{specs.join(' · ')}</p>
        )}
        {cam.notes && <p className="text-gray-600 text-xs mt-0.5 whitespace-pre-wrap">{cam.notes}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={onEdit} className="btn-ghost p-1 text-gray-600 hover:text-gray-300"><Pencil size={12} /></button>
        <button onClick={onDelete} className="btn-ghost p-1 text-gray-600 hover:text-red-400"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function CamerasSection({ customerId, system, onMutate }) {
  const [modal, setModal] = useState(null);
  // Cameras ride along on the system row (see the cameras route) - no extra fetch.
  const cams = system.cameras ?? [];

  const remove = async (cam) => {
    if (!confirm(`Delete "${cam.name || 'this camera'}"?`)) return;
    await customersApi.cameras.cams.remove(customerId, system.id, cam.id);
    onMutate();
  };
  const sortAlpha = async () => {
    await customersApi.cameras.cams.reorder(customerId, system.id, sortByName(cams, c => c.name).map(c => c.id));
    onMutate();
  };

  return (
    <div className="mt-3 pt-3 border-t border-surface-600">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Cameras {cams.length > 0 && <span className="text-gray-600">({cams.length})</span>}
        </p>
        <div className="flex items-center gap-1">
          {cams.length > 1 && (
            <button onClick={sortAlpha} disabled={isSortedByName(cams, c => c.name)}
              className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1 disabled:opacity-30"
              title="Sort cameras A–Z">
              <ArrowDownAZ size={12} /> Sort
            </button>
          )}
          <button onClick={() => setModal('new')} className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1">
            <Plus size={11} /> Add Camera
          </button>
        </div>
      </div>

      {cams.length === 0 ? (
        <p className="text-gray-600 text-xs">No cameras logged. Click Add Camera to record each one.</p>
      ) : (
        <DragList
          items={cams}
          onReorder={(items) =>
            customersApi.cameras.cams.reorder(customerId, system.id, items.map(i => i.id)).then(onMutate)}
          itemClassName="flex items-start gap-1 mb-2"
          renderItem={(cam, handle) => (
            <>
              <div className="pt-2">{handle}</div>
              <div className="flex-1 min-w-0">
                <CameraRow
                  cam={cam}
                  customerId={customerId}
                  systemId={system.id}
                  onEdit={() => setModal(cam)}
                  onDelete={() => remove(cam)}
                />
              </div>
            </>
          )}
        />
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add Camera' : 'Edit Camera'} size="lg">
        {modal !== null && (
          <CameraDeviceForm
            customerId={customerId}
            systemId={system.id}
            cam={modal === 'new' ? null : modal}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); onMutate(); }}
          />
        )}
      </Modal>
    </div>
  );
}

// --- Main tab -----------------------------------------------------------------

export function CamerasTab({ customerId, locations = [], companyName }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [office, setOffice] = useOfficeFilter(customerId, 'cameras', locations);
  const [importing, setImporting] = useState(false);
  const integrations = useIntegrations();
  const { data: allCameras = [], refetch } = useQuery({
    queryKey: ['customers', customerId, 'cameras'],
    queryFn: () => customersApi.cameras.list(customerId).then(r => r.data),
  });
  const cameras = allCameras.filter(c => officeMatches(c, office) && matchesQuery(c, search));

  const remove = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await customersApi.cameras.remove(customerId, id);
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search systems & cameras (label, model, IP, MAC, serial…)" className="w-full sm:w-72" />
          <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} />
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto w-full sm:w-auto">
          {integrations.unifi && (
          <button onClick={() => setImporting(true)} title="Import cameras from UniFi Protect"
            className="btn-secondary flex items-center justify-center gap-2 text-sm flex-1 sm:flex-none whitespace-nowrap">
            <CloudDownload size={14} /> Import from UniFi Protect
          </button>
          )}
          <button onClick={() => setModal('new')} className="btn-primary flex items-center justify-center gap-2 text-sm flex-1 sm:flex-none whitespace-nowrap">
            <Plus size={14} /> Add System
          </button>
        </div>
      </div>

      {allCameras.length === 0 ? (
        <EmptyState icon={Camera} title="No camera systems"
          description="Add NVR/DVR systems for this customer." />
      ) : cameras.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No camera systems match.</p>
      ) : (
        <div className="space-y-4">
          {cameras.map(c => (
            <div key={c.id} className="card p-4">
              {/* System header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-gray-200 font-medium">{c.label || c.model || 'Camera System'}</h4>
                    <OfficeBadge locations={locations} locationId={c.location_id} companyName={companyName} />
                    {c.unifi_host_id && (
                      <span className="badge bg-blue-900/40 text-blue-300"
                        title={`Linked to UniFi Protect${c.unifi_synced_at ? ` · last synced ${formatDate(c.unifi_synced_at)}` : ''}`}>UniFi Protect</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                    {c.system_type  && <span>{c.system_type}</span>}
                    {c.channel_count && <span>{c.channel_count}ch</span>}
                    {c.model        && <span>{c.model}</span>}
                    {c.serial_number && <span>S/N: {c.serial_number}</span>}
                    {c.ip_address   && <span>{c.ip_address}</span>}
                    {c.system_location && (
                      <span className="inline-flex items-center gap-1"><MapPin size={11} />{c.system_location}</span>
                    )}
                    {c.install_date && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays size={11} />Installed {formatDate(c.install_date)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-3">
                  <button onClick={() => setModal(c)} className="btn-ghost p-1.5"><Pencil size={13} /></button>
                  <button onClick={() => remove(c.id, c.label || c.model || 'system')}
                    className="btn-ghost p-1.5 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>

              {/* Our credentials */}
              <div className="pt-3 border-t border-surface-600">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Our Login</p>
                <div className="flex gap-8">
                  <div>
                    <span className="text-gray-600 text-xs">Username: </span>
                    <span className="text-gray-300 text-sm font-mono">{c.username || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600 text-xs">Password: </span>
                    <CredentialField
                      hasValue={c.has_password}
                      onReveal={() => customersApi.cameras.reveal(customerId, c.id).then(r => r.data.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Additional logins - customer, monitoring company, owner… */}
              <SharedAccessSection customerId={customerId} cameraId={c.id} />

              {/* The individual cameras on this system */}
              <CamerasSection customerId={customerId} system={c} onMutate={refetch} />

              {c.notes && <p className="mt-3 text-gray-600 text-xs border-t border-surface-600 pt-2">{c.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add Camera System' : 'Edit Camera System'} size="lg">
        {modal !== null && (
          <CameraForm
            customerId={customerId}
            camera={modal === 'new' ? null : modal}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>

      <Modal open={importing} onClose={() => setImporting(false)} title="Import from UniFi Protect" size="lg">
        {importing && (
          <UnifiImport
            focus="cameras"
            customerId={customerId}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setImporting(false)}
            onImported={() => refetch()}
          />
        )}
      </Modal>
    </div>
  );
}
