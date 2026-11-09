import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, FileDown } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { Modal } from '../ui/Modal.jsx';
import { ExportModal } from './ExportModal.jsx';
import { noAutofill } from '../ui/noAutofill.js';
import { formatPhone } from '../../utils/phone.js';
import { externalHref } from '../../utils/url.js';
import { DragList } from '../ui/DragList.jsx';
import { OfficeSelect, OfficeBadge } from '../ui/office.jsx';
import api from '../../api/client.js';

// --- Inline editable field ----------------------------------------------------

function InlineField({ value, onSave, multiline, asLink, phone }) {
  const fmt = phone ? formatPhone : (v) => v ?? '';
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(fmt(value ?? ''));
  const [saving, setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(val);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    const props = {
      className: 'input text-sm py-1',
      value: val,
      onChange: e => setVal(fmt(e.target.value)),
      autoFocus: true,
      ...noAutofill,
      onKeyDown: e => {
        if (!multiline && e.key === 'Enter') save();
        if (e.key === 'Escape') setEditing(false);
      },
    };
    return (
      <div className="flex items-start gap-2 flex-1">
        {multiline
          ? <textarea {...props} className="input text-sm py-1 resize-none flex-1" rows={3} />
          : <input {...props} className="input text-sm py-1 flex-1" />}
        <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 p-1 mt-0.5 shrink-0">
          <Check size={14} />
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-300 p-1 mt-0.5 shrink-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  const display = fmt(value ?? '');
  return (
    <div className="group flex items-center gap-1.5 w-full">
      {asLink && value
        ? <a href={externalHref(value)} target="_blank" rel="noopener noreferrer"
            className="text-sm text-accent hover:underline break-all">{value}</a>
        : <span className="text-sm whitespace-pre-wrap wrap-break-word text-gray-300">
            {display || <span className="text-gray-600 italic">not set</span>}
          </span>}
      <button
        onClick={() => { setVal(fmt(value ?? '')); setEditing(true); }}
        className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hover:text-gray-300"
        aria-label="Edit"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}

// --- Contact modal ------------------------------------------------------------

function ContactModal({ customerId, contact, branches = [], companyName, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: contact?.name ?? '', title: contact?.title ?? '',
    phone: formatPhone(contact?.phone ?? ''), email: contact?.email ?? '',
    address: contact?.address ?? '', city: contact?.city ?? '',
    state: contact?.state ?? '', zip: contact?.zip ?? '',
    location_id: contact?.location_id ?? '',
    is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (contact) {
        await api.patch(`/customers/${customerId}/contacts/${contact.id}`, form);
      } else {
        await api.post(`/customers/${customerId}/contacts`, form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save contact.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Name *</label>
          <input className="input" {...noAutofill} value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Title / Position</label>
          <input className="input" {...noAutofill} value={form.title} onChange={set('title')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Phone</label>
          <input className="input" {...noAutofill} type="tel" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
          <input className="input" {...noAutofill} type="email" value={form.email} onChange={set('email')} />
        </div>
      </div>
      {branches.length > 0 && (
        <OfficeSelect locations={branches} companyName={companyName} label="Office / Branch"
          value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />
      )}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-1">
        Address <span className="font-normal normal-case text-gray-600">(optional — for a branch office or this contact's location)</span>
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Street Address</label>
        <input className="input" {...noAutofill} value={form.address} onChange={set('address')} placeholder="123 Main St" />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-xs font-medium text-gray-400 mb-1">City</label>
          <input className="input" {...noAutofill} value={form.city} onChange={set('city')} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-gray-400 mb-1">State</label>
          <input className="input" {...noAutofill} value={form.state} onChange={set('state')} maxLength={2} />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">ZIP</label>
          <input className="input" {...noAutofill} value={form.zip} onChange={set('zip')} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <input className="input" {...noAutofill} value={form.notes} onChange={set('notes')} />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={form.is_primary} onChange={set('is_primary')} className="accent-brand" />
        Primary contact
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.name} className="btn-primary">
          {saving ? 'Saving…' : contact ? 'Update' : 'Add Contact'}
        </button>
      </div>
    </form>
  );
}

// --- Billing rate modal (add + edit) -----------------------------------------

function RateModal({ customerId, rate, onClose, onSaved }) {
  const [form, setForm] = useState({
    label: rate?.label ?? '',
    rate:  rate?.rate  != null ? String(parseFloat(rate.rate).toFixed(2)) : '',
    notes: rate?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (isNaN(parseFloat(form.rate))) { setError('Rate must be a valid number.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        label: form.label.trim(),
        rate:  parseFloat(form.rate),
        notes: form.notes,
      };
      if (rate) {
        await api.patch(`/customers/${customerId}/rates/${rate.id}`, payload);
      } else {
        await api.post(`/customers/${customerId}/rates`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save rate.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Label *</label>
        <input className="input" {...noAutofill} value={form.label} onChange={set('label')} required
          placeholder="e.g. Standard, After Hours, Weekend" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Rate ($/hr) *</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
          <input className="input pl-7" {...noAutofill} value={form.rate} onChange={set('rate')}
            required placeholder="0.00" inputMode="decimal" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Notes</label>
        <input className="input" {...noAutofill} value={form.notes} onChange={set('notes')}
          placeholder="e.g. applies after 5pm weekdays" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.label || !form.rate} className="btn-primary">
          {saving ? 'Saving…' : rate ? 'Update Rate' : 'Add Rate'}
        </button>
      </div>
    </form>
  );
}

// --- Branch office modal ------------------------------------------------------

function BranchModal({ customerId, branch, onClose, onSaved }) {
  const [form, setForm] = useState({
    label:                 branch?.label                 ?? '',
    business_name:         branch?.business_name         ?? '',
    address:               branch?.address               ?? '',
    city:                  branch?.city                  ?? '',
    state:                 branch?.state                 ?? '',
    zip:                   branch?.zip                   ?? '',
    phone:                 formatPhone(branch?.phone                 ?? ''),
    wan_ip:                branch?.wan_ip                ?? '',
    firewall_link:         branch?.firewall_link         ?? '',
    notes:                 branch?.notes                 ?? '',
    billing_contact_name:  branch?.billing_contact_name  ?? '',
    billing_contact_email: branch?.billing_contact_email ?? '',
    billing_contact_phone: formatPhone(branch?.billing_contact_phone ?? ''),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (branch) await customersApi.locations.update(customerId, branch.id, form);
      else        await customersApi.locations.create(customerId, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save branch office.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label</label>
          <input className="input" {...noAutofill} value={form.label} onChange={set('label')} placeholder="e.g. North Branch, Warehouse" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Business Name (if different)</label>
          <input className="input" {...noAutofill} value={form.business_name} onChange={set('business_name')} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Street Address</label>
        <input className="input" {...noAutofill} value={form.address} onChange={set('address')} placeholder="123 Main St" />
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-xs font-medium text-gray-400 mb-1">City</label>
          <input className="input" {...noAutofill} value={form.city} onChange={set('city')} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-gray-400 mb-1">State</label>
          <input className="input" {...noAutofill} value={form.state} onChange={set('state')} maxLength={2} />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">ZIP</label>
          <input className="input" {...noAutofill} value={form.zip} onChange={set('zip')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Phone</label>
          <input className="input" {...noAutofill} type="tel" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} placeholder="(555) 000-0000" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Static WAN IP</label>
          <input className="input" {...noAutofill} value={form.wan_ip} onChange={set('wan_ip')} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Firewall Management Link</label>
        <input className="input" {...noAutofill} value={form.firewall_link} onChange={set('firewall_link')} placeholder="https://" />
      </div>
      <div className="border-t border-surface-600 pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Billing Contact</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
            <input className="input" {...noAutofill} value={form.billing_contact_name} onChange={set('billing_contact_name')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input className="input" {...noAutofill} value={form.billing_contact_email} onChange={set('billing_contact_email')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Phone</label>
            <input className="input" {...noAutofill} type="tel" value={form.billing_contact_phone}
              onChange={e => setForm(f => ({ ...f, billing_contact_phone: formatPhone(e.target.value) }))} />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : branch ? 'Update Branch' : 'Add Branch'}
        </button>
      </div>
    </form>
  );
}

// --- Main tab -----------------------------------------------------------------

export function OverviewTab({ customer, onUpdate }) {
  const [contactModal, setContactModal] = useState(null);
  const [rateModal, setRateModal]       = useState(null); // null=closed 'new'=add rate={…}=edit
  const [branchModal, setBranchModal]   = useState(null); // null=closed 'new'=add branch={…}=edit
  const [exportOpen, setExportOpen]     = useState(false);

  const save = (field) => async (value) => {
    await customersApi.update(customer.id, { [field]: value });
    onUpdate();
  };

  const deleteContact = async (id) => {
    await api.delete(`/customers/${customer.id}/contacts/${id}`);
    onUpdate();
  };

  const deleteRate = async (id) => {
    await api.delete(`/customers/${customer.id}/rates/${id}`);
    onUpdate();
  };

  const deleteBranch = async (id) => {
    if (!confirm('Delete this branch office?')) return;
    await customersApi.locations.remove(customer.id, id);
    onUpdate();
  };

  const contacts = customer.contacts       ?? [];
  const rates    = customer.billing_rates  ?? [];
  const branches = customer.locations      ?? [];

  return (
    <div className="space-y-8">

      {/* Company Info */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Company Info</h3>
          <button onClick={() => setExportOpen(true)}
            className="btn-secondary text-sm flex items-center gap-2"
            title="Export this customer to a PDF (for the customer) or an Excel workbook (for a new IT provider)">
            <FileDown size={14} /> Export
          </button>
        </div>
        <div className="space-y-3">
          {[
            ['Business Name',       'name'],
            ['Street Address',      'address'],
            ['City',                'city'],
            ['State',               'state'],
            ['ZIP',                 'zip'],
            ['Main Office / Line',  'phone',    { phone: true }],
            ['Static WAN IP',       'wan_ip'],
          ].map(([label, field, extra]) => (
            <div key={field} className="flex items-start gap-3">
              <span className="text-gray-500 text-sm w-32 shrink-0 pt-0.5">{label}</span>
              <InlineField value={customer[field]} onSave={save(field)} {...(extra ?? {})} />
            </div>
          ))}
          <div className="flex items-start gap-3">
            <span className="text-gray-500 text-sm w-32 shrink-0 pt-0.5">Firewall Mgmt</span>
            <InlineField value={customer.firewall_link} onSave={save('firewall_link')} asLink />
          </div>
          <div className="flex items-start gap-3">
            <span className="text-gray-500 text-sm w-32 shrink-0 pt-0.5">Notes</span>
            <InlineField value={customer.notes} onSave={save('notes')} multiline />
          </div>

          {/* Billing Contact */}
          <div className="pt-4 mt-1 border-t border-surface-700">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Billing Contact</p>
            {[
              ['Name',  'billing_contact_name'],
              ['Email', 'billing_contact_email'],
              ['Phone', 'billing_contact_phone', { phone: true }],
            ].map(([label, field, extra]) => (
              <div key={field} className="flex items-start gap-3 mb-3 last:mb-0">
                <span className="text-gray-500 text-sm w-32 shrink-0 pt-0.5">{label}</span>
                <InlineField value={customer[field]} onSave={save(field)} {...(extra ?? {})} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Branch Offices */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Branch Offices</h3>
          <button onClick={() => setBranchModal('new')} className="btn-ghost text-xs flex items-center gap-1 py-1">
            <Plus size={12} /> Add Branch
          </button>
        </div>
        {branches.length === 0 ? (
          <p className="text-gray-600 text-sm">No branch offices. Add one for a location with its own address, phone, or WAN IP.</p>
        ) : (
          <div className="space-y-2">
            {branches.map(b => (
              <div key={b.id} className="flex items-start justify-between p-3 bg-surface-700 rounded-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-100 font-medium text-sm">{b.label || b.business_name || 'Branch office'}</span>
                    {b.business_name && b.label && <span className="text-gray-500 text-xs">({b.business_name})</span>}
                  </div>
                  {(b.address || b.city || b.state || b.zip) && (
                    <p className="text-gray-400 text-xs mt-1">
                      {[b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {b.phone && <span className="text-gray-400 text-xs">{b.phone}</span>}
                    {b.wan_ip && <span className="text-gray-400 text-xs">WAN: {b.wan_ip}</span>}
                    {b.firewall_link && (
                      <a href={externalHref(b.firewall_link)} target="_blank" rel="noopener noreferrer" className="text-accent text-xs hover:underline">Firewall</a>
                    )}
                  </div>
                  {(b.billing_contact_name || b.billing_contact_email || b.billing_contact_phone) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 pt-1.5 border-t border-surface-600">
                      <span className="text-gray-600 text-xs shrink-0">Billing:</span>
                      {b.billing_contact_name  && <span className="text-gray-400 text-xs">{b.billing_contact_name}</span>}
                      {b.billing_contact_email && <span className="text-gray-400 text-xs">{b.billing_contact_email}</span>}
                      {b.billing_contact_phone && <span className="text-gray-400 text-xs">{b.billing_contact_phone}</span>}
                    </div>
                  )}
                  {b.notes && <p className="text-gray-600 text-xs mt-1 whitespace-pre-wrap">{b.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0 ml-3">
                  <button onClick={() => setBranchModal(b)} className="btn-ghost p-1.5"><Pencil size={12} /></button>
                  <button onClick={() => deleteBranch(b.id)} className="btn-ghost p-1.5 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Contacts */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacts</h3>
          <button onClick={() => setContactModal('new')} className="btn-ghost text-xs flex items-center gap-1 py-1">
            <Plus size={12} /> Add
          </button>
        </div>
        {contacts.length === 0 ? (
          <p className="text-gray-600 text-sm">No contacts yet.</p>
        ) : (
          <div className="space-y-2">
            <DragList
              items={contacts}
              onReorder={(items) => customersApi.contacts.reorder(customer.id, items.map(i => i.id)).then(onUpdate)}
              itemClassName="items-start gap-1"
              renderItem={(c, handle) => (
                <div className="flex items-start justify-between p-3 bg-surface-700 rounded-lg flex-1">
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5">{handle}</div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-200 font-medium text-sm">{c.name}</span>
                        {c.is_primary && <span className="badge bg-brand/20 text-brand text-xs">Primary</span>}
                        {c.location_id && <OfficeBadge locations={branches} locationId={c.location_id} companyName={customer.name} />}
                      </div>
                      {c.title && <p className="text-gray-500 text-xs mt-0.5">{c.title}</p>}
                      <div className="flex gap-4 mt-1">
                        {c.phone && <span className="text-gray-400 text-xs">{c.phone}</span>}
                        {c.email && <span className="text-gray-400 text-xs">{c.email}</span>}
                      </div>
                      {(c.address || c.city || c.state || c.zip) && (
                        <p className="text-gray-500 text-xs mt-1">
                          {[c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {c.notes && <p className="text-gray-600 text-xs mt-1">{c.notes}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-3">
                    <button onClick={() => setContactModal(c)} className="btn-ghost p-1.5"><Pencil size={12} /></button>
                    <button onClick={() => deleteContact(c.id)} className="btn-ghost p-1.5 hover:text-red-400"><Trash2 size={12} /></button>
                  </div>
                </div>
              )}
            />
          </div>
        )}
      </section>

      {/* Billing Rates */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Billing Rates</h3>
          <button onClick={() => setRateModal('new')} className="btn-ghost text-xs flex items-center gap-1 py-1">
            <Plus size={12} /> Add Rate
          </button>
        </div>
        {rates.length === 0 ? (
          <p className="text-gray-600 text-sm">No billing rates set.</p>
        ) : (
          <div className="space-y-1.5">
            <DragList
              items={rates}
              onReorder={(items) => customersApi.rates.reorder(customer.id, items.map(i => i.id)).then(onUpdate)}
              itemClassName="items-center gap-1"
              renderItem={(r, handle) => (
                <div className="flex items-center justify-between p-3 bg-surface-700 rounded-lg flex-1">
                  <div className="flex items-center gap-2">
                    {handle}
                    <div>
                      <span className="text-gray-300 text-sm font-medium">{r.label}</span>
                      {r.notes && <p className="text-gray-500 text-xs mt-0.5">{r.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-accent font-semibold text-sm">
                      ${parseFloat(r.rate).toFixed(2)}/hr
                    </span>
                    <button onClick={() => setRateModal(r)} className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => deleteRate(r.id)} className="btn-ghost p-1.5 hover:text-red-400">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            />
          </div>
        )}
      </section>

      {/* Modals */}
      <ExportModal customer={customer} open={exportOpen} onClose={() => setExportOpen(false)} />

      <Modal
        open={branchModal !== null}
        onClose={() => setBranchModal(null)}
        title={branchModal === 'new' ? 'Add Branch Office' : 'Edit Branch Office'}
      >
        {branchModal !== null && (
          <BranchModal
            customerId={customer.id}
            branch={branchModal === 'new' ? null : branchModal}
            onClose={() => setBranchModal(null)}
            onSaved={() => { setBranchModal(null); onUpdate(); }}
          />
        )}
      </Modal>

      <Modal
        open={contactModal !== null}
        onClose={() => setContactModal(null)}
        title={contactModal === 'new' ? 'Add Contact' : 'Edit Contact'}
      >
        {contactModal !== null && (
          <ContactModal
            customerId={customer.id}
            contact={contactModal === 'new' ? null : contactModal}
            branches={branches}
            companyName={customer.name}
            onClose={() => setContactModal(null)}
            onSaved={() => { setContactModal(null); onUpdate(); }}
          />
        )}
      </Modal>

      <Modal
        open={rateModal !== null}
        onClose={() => setRateModal(null)}
        title={rateModal === 'new' ? 'Add Billing Rate' : 'Edit Billing Rate'}
        size="sm"
      >
        {rateModal !== null && (
          <RateModal
            customerId={customer.id}
            rate={rateModal === 'new' ? null : rateModal}
            onClose={() => setRateModal(null)}
            onSaved={() => { setRateModal(null); onUpdate(); }}
          />
        )}
      </Modal>
    </div>
  );
}
