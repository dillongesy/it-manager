import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, BadgeCheck, X } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { Modal } from '../ui/Modal.jsx';
import { CredentialField } from '../ui/CredentialField.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { OfficeFilterBar, OfficeSelect, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor } from '../ui/office.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { matchesQuery } from '../../utils/search.js';
import { nextRenewalFor, intervalLabel } from '../../utils/renewal.js';
import { CadenceSelect } from '../ui/CadenceSelect.jsx';
import { needsYearAnchor } from '../../utils/cadence.js';
import { formatDate, parseDateOnly, toDateInput, isUnusableDate } from '../../utils/date.js';

const fmtDate = (d) => formatDate(d, { year: 'numeric', month: 'short', day: 'numeric' });

// Auto-renewal intervals. The count beside "Annually" turns it into "every N years",
// which is how a domain registration or a multi-year cert actually renews.
const INTERVAL_OPTS = [
  { value: 'monthly',  label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
];

// ─── Expiration / renewal badge ───────────────────────────────────────────────

// Auto-renewing subscriptions show their computed next renewal (neutral/blue — no
// action needed); manual licenses show their expiration date color-coded by urgency.
function ExpirationBadge({ license }) {
  if (license.auto_renew) {
    const next = nextRenewalFor(license);
    if (!next) return null;
    return (
      <span className="text-xs px-2 py-0.5 rounded-sm font-medium bg-blue-900/30 text-blue-300">
        Auto-renews {fmtDate(next)} · {intervalLabel(license.renewal_interval, license.renewal_interval_count)}
      </span>
    );
  }
  if (!license.renewal_date) return null;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((parseDateOnly(license.renewal_date) - todayMidnight) / 86400000);
  let cls;
  if (days < 0)        cls = 'bg-red-900/40 text-red-400';
  else if (days <= 30) cls = 'bg-red-900/30 text-red-400';
  else if (days <= 90) cls = 'bg-amber-900/40 text-amber-400';
  else                 cls = 'bg-green-900/30 text-green-400';
  const suffix = days < 0
    ? ` (expired ${Math.abs(days)}d ago)`
    : days <= 90 ? ` (${days}d)` : '';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-sm font-medium ${cls}`}>
      Expires {fmtDate(license.renewal_date)}{suffix}
    </span>
  );
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────

const blankKey = () => ({ _localId: Math.random(), id: null, title: '', key: '' });

function LicenseForm({ customerId, license, locations, companyName, defaultLocationId, onClose, onSaved }) {
  const [form, setForm] = useState({
    program_name:   license?.program_name   ?? '',
    vendor:         license?.vendor         ?? '',
    vendor_contact: license?.vendor_contact ?? '',
    version:          license?.version        ?? '',
    renewal_date:     toDateInput(license?.renewal_date),
    auto_renew:       license?.auto_renew     ?? false,
    renewal_interval: license?.renewal_interval ?? 'monthly',
    // How many intervals between renewals — 3 for a domain bought three years at a
    // time. Only meaningful on an annual interval; 1 is the ordinary subscription.
    renewal_interval_count: license?.renewal_interval_count ?? 1,
    payment_method:   license?.payment_method ?? '',
    location_id:      license?.location_id    ?? defaultLocationId ?? '',
    notes:            license?.notes          ?? '',
  });
  // Each entry: { _localId, id (server id or null for new), title, key }
  const [keys, setKeys] = useState(
    license?.license_keys?.length
      ? license.license_keys.map(k => ({ _localId: Math.random(), id: k.id, title: k.title, key: '' }))
      : [blankKey()]
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const setKey = (localId, field) => e =>
    setKeys(ks => ks.map(k => k._localId === localId ? { ...k, [field]: e.target.value } : k));
  const addKey    = () => setKeys(ks => [...ks, blankKey()]);
  const removeKey = (localId) => setKeys(ks => ks.filter(k => k._localId !== localId));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        license_keys: keys.map(k => ({ id: k.id, title: k.title, key: k.key })),
      };
      if (license) {
        await customersApi.licenses.update(customerId, license.id, payload);
      } else {
        await customersApi.licenses.create(customerId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save license.');
    } finally { setSaving(false); }
  };

  const isEditing = !!license;
  // "each month" / "each year" / "every 3 years" — the anchor date rolls forward by
  // whole intervals, so a multi-year term never needs re-keying either.
  const rollsForward = needsYearAnchor(form.renewal_interval, form.renewal_interval_count)
    ? `every ${form.renewal_interval_count} years`
    : form.renewal_interval === 'annually' ? 'each year' : 'each month';

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      {license?.source_device_id && (
        <p className="text-xs text-blue-300 bg-blue-900/20 rounded-sm p-2">
          This license is auto-managed from a device's “License Expires” date — its program name and
          renewal date re-sync when the device is edited. You can still add vendor info, keys, and notes here.
        </p>
      )}

      {/* Core fields */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Program Name *</label>
        <input className="input" value={form.program_name} onChange={set('program_name')}
          placeholder="e.g. Microsoft 365 Business, SonicWall NSM" required autoFocus autoComplete="off" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Vendor</label>
          <input className="input" value={form.vendor} onChange={set('vendor')}
            placeholder="e.g. Microsoft, SonicWall" autoComplete="off" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Vendor Contact</label>
          <input className="input" value={form.vendor_contact} onChange={set('vendor_contact')}
            placeholder="Phone, email, or support URL" autoComplete="off" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Version</label>
          <input className="input" value={form.version} onChange={set('version')}
            placeholder="e.g. 2021, 7.1, v3" autoComplete="off" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Expiration Date</label>
          <input className="input" type="date" value={form.renewal_date} onChange={set('renewal_date')} />
          {/* A stored date with an impossible year (a mistyped 6-digit year) can't be
              shown in a date input. Say so, rather than blanking the field silently and
              wiping a date the user never touched. */}
          {isUnusableDate(license?.renewal_date) && !form.renewal_date && (
            <p className="text-xs text-amber-400 mt-1">
              The saved date was invalid and couldn't be loaded — pick the correct one (saving now clears it).
            </p>
          )}
        </div>
      </div>

      {/* Auto-renewal */}
      <div className="border border-surface-600 rounded-lg p-3 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" className="h-4 w-4 accent-brand"
            checked={form.auto_renew}
            onChange={(e) => setForm(f => ({ ...f, auto_renew: e.target.checked }))} />
          <span className="text-sm font-medium text-gray-300">Automatically renews</span>
        </label>
        {form.auto_renew && (
          <>
            <p className="text-xs text-gray-600 -mt-1">
              The expiration date above is the renewal anchor — it rolls forward {rollsForward} automatically.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Renewal Interval</label>
                <CadenceSelect options={INTERVAL_OPTS} frequency={form.renewal_interval}
                  count={form.renewal_interval_count}
                  onChange={({ frequency, count }) =>
                    setForm(f => ({ ...f, renewal_interval: frequency, renewal_interval_count: count }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Paid With (Card)</label>
                <input className="input" value={form.payment_method} onChange={set('payment_method')}
                  placeholder="Who? Last digits?" autoComplete="off" />
              </div>
            </div>
          </>
        )}
      </div>

      <OfficeSelect locations={locations} companyName={companyName}
        value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />

      {/* License keys */}
      <div className="border-t border-surface-600 pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">License Keys</p>
        </div>

        <div className="space-y-2">
          {keys.map((k, idx) => (
            <div key={k._localId} className="flex gap-2 items-start">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <div>
                  {idx === 0 && <label className="block text-xs text-gray-500 mb-0.5">Key Title</label>}
                  <input
                    className="input text-sm"
                    value={k.title}
                    onChange={setKey(k._localId, 'title')}
                    placeholder="e.g. Product Key, Volume License"
                    autoComplete="off"
                  />
                </div>
                <div>
                  {idx === 0 && (
                    <label className="block text-xs text-gray-500 mb-0.5">
                      License Key {isEditing && k.id && <span className="text-gray-600">(blank = keep)</span>}
                    </label>
                  )}
                  <input
                    className="input text-sm font-mono tracking-wider"
                    value={k.key}
                    onChange={setKey(k._localId, 'key')}
                    placeholder={isEditing && k.id ? '••••••••••••••••' : 'XXXX-XXXX-XXXX-XXXX'}
                    autoComplete="off"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeKey(k._localId)}
                className={`btn-ghost p-1.5 text-gray-600 hover:text-red-400 shrink-0 ${idx === 0 && isEditing ? 'mt-5' : idx === 0 ? 'mt-5' : ''}`}
                title="Remove key"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={addKey}
          className="btn-ghost text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-300 mt-2">
          <Plus size={12} /> Add Key
        </button>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')}
          placeholder="Seat count, restrictions, support contract details…" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.program_name.trim()} className="btn-primary">
          {saving ? 'Saving…' : license ? 'Update License' : 'Add License'}
        </button>
      </div>
    </form>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function LicensingTab({ customerId, locations = [], companyName }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [office, setOffice] = useOfficeFilter(customerId, 'licenses', locations);
  const { data: allLicenses = [], refetch } = useQuery({
    queryKey: ['customers', customerId, 'licenses'],
    queryFn: () => customersApi.licenses.list(customerId).then(r => r.data),
  });
  const licenses = allLicenses.filter(l => officeMatches(l, office) && matchesQuery(l, search));

  const remove = async (id, name) => {
    if (!confirm(`Delete license "${name}"?`)) return;
    await customersApi.licenses.remove(customerId, id);
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search licenses (program, vendor, version…)" className="w-full sm:w-72" />
          <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} />
        </div>
        <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm shrink-0 ml-auto">
          <Plus size={14} /> Add License
        </button>
      </div>

      {allLicenses.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="No licenses"
          description="Track software licenses, subscription keys, and renewal dates." />
      ) : licenses.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No licenses match.</p>
      ) : (
        <div className="space-y-3">
          {licenses.map(lic => (
            <div key={lic.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">

                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h4 className="text-gray-200 font-medium">{lic.program_name}</h4>
                    {lic.version && (
                      <span className="text-xs text-gray-600 bg-surface-600 px-1.5 py-0.5 rounded-sm">
                        v{lic.version}
                      </span>
                    )}
                    <OfficeBadge locations={locations} locationId={lic.location_id} companyName={companyName} />
                    {lic.source_device_id && <span className="badge bg-blue-900/40 text-blue-300 text-xs">From device</span>}
                    <ExpirationBadge license={lic} />
                  </div>

                  {/* Vendor row */}
                  {(lic.vendor || lic.vendor_contact || lic.payment_method) && (
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-3">
                      {lic.vendor && <span><span className="text-gray-600">Vendor: </span>{lic.vendor}</span>}
                      {lic.vendor_contact && <span><span className="text-gray-600">Contact: </span>{lic.vendor_contact}</span>}
                      {lic.payment_method && <span><span className="text-gray-600">Paid with: </span>{lic.payment_method}</span>}
                    </div>
                  )}

                  {/* Keys */}
                  {lic.license_keys?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-surface-600 space-y-1.5">
                      {lic.license_keys.map(k => (
                        <div key={k.id} className="flex items-center gap-3">
                          {k.title && (
                            <span className="text-xs text-gray-500 shrink-0 w-32 truncate" title={k.title}>
                              {k.title}:
                            </span>
                          )}
                          <CredentialField
                            hasValue={k.has_key}
                            onReveal={() =>
                              customersApi.licenses.revealKey(customerId, lic.id, k.id).then(r => r.data.value)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {lic.notes && (
                    <p className="mt-2 text-xs text-gray-600 border-t border-surface-600 pt-2">{lic.notes}</p>
                  )}
                </div>

                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setModal(lic)} className="btn-ghost p-1.5 text-gray-600 hover:text-gray-300">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => remove(lic.id, lic.program_name)}
                    className="btn-ghost p-1.5 text-gray-600 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add License' : 'Edit License'} size="lg">
        {modal !== null && (
          <LicenseForm
            customerId={customerId}
            license={modal === 'new' ? null : modal}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>
    </div>
  );
}
