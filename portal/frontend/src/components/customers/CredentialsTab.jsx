import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, KeyRound, ChevronDown, ChevronRight, ChevronUp, Copy, Check, ArrowDownAZ, X } from 'lucide-react';
import { copyText } from '../../utils/clipboard.js';
import { customersApi } from '../../api/customers.js';
import { Modal } from '../ui/Modal.jsx';
import { CredentialField } from '../ui/CredentialField.jsx';
import { PasswordInput } from '../ui/PasswordInput.jsx';
import { Combobox } from '../ui/Combobox.jsx';
import { DragList } from '../ui/DragList.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { OfficeFilterBar, OfficeSelect, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor } from '../ui/office.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { matchesQuery } from '../../utils/search.js';
import { sortByName, isSortedByName } from '../../utils/sort.js';

// ─── Credential form ──────────────────────────────────────────────────────────

function CredForm({ customerId, cred, existingCategories, defaultCategory, locations, companyName, defaultLocationId, onClose, onSaved }) {
  const [form, setForm] = useState({
    category:    cred?.category    ?? defaultCategory ?? '',
    location_id: cred?.location_id ?? defaultLocationId ?? '',
    label:       cred?.label       ?? '',
    username:    cred?.username    ?? '',
    password:    '',
    url:         cred?.url         ?? '',
    two_fa_note: cred?.two_fa_note ?? '',
    extra_notes: cred?.extra_notes ?? '',
  });
  const [custom, setCustom] = useState(
    (cred?.custom_fields ?? []).map(f => ({
      label: f.label ?? '',
      secret: !!f.secret,
      value: f.secret ? '' : (f.value ?? ''),
      keep_id: f.secret ? f.id : null,
      had_value: !!f.has_value,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const setCustomField = (i, key, val) => setCustom(cs => cs.map((c, idx) => idx === i ? { ...c, [key]: val } : c));
  const addCustom    = () => setCustom(cs => [...cs, { label: '', secret: false, value: '', keep_id: null, had_value: false }]);
  const removeCustom = (i) => setCustom(cs => cs.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, custom_fields: custom };
      if (!payload.password) delete payload.password;
      if (cred) {
        await customersApi.credentials.update(customerId, cred.id, payload);
      } else {
        await customersApi.credentials.create(customerId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save credential.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Section *</label>
          <Combobox
            value={form.category}
            onChange={v => setForm(f => ({ ...f, category: v }))}
            options={existingCategories}
            placeholder="e.g. Microsoft 365, Domain, Dentrix"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Label *</label>
          <input className="input" value={form.label} onChange={set('label')} required
            placeholder="e.g. Global Admin, Customer ID, FQDN" />
        </div>
      </div>

      <OfficeSelect locations={locations} companyName={companyName}
        value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
          <input className="input" value={form.username} onChange={set('username')}
            autoComplete="off" data-1p-ignore data-lpignore="true" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Password {cred && <span className="text-gray-600">(blank = keep)</span>}
          </label>
          <PasswordInput value={form.password} onChange={set('password')} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">URL / Portal</label>
        <input className="input" value={form.url} onChange={set('url')} placeholder="https://" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">2FA Location</label>
        <input className="input" value={form.two_fa_note} onChange={set('two_fa_note')}
          placeholder="e.g. Office iPad, Jane's" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Extra Notes</label>
        <textarea className="input resize-none" rows={2} value={form.extra_notes}
          onChange={set('extra_notes')} />
      </div>

      {/* Custom fields — FQDN, customer ID, support #, DB password, security Qs, etc.
          Tick "secret" to encrypt + mask. They display inline with the entry. */}
      <div className="border-t border-surface-600 pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Custom Fields</p>
          <button type="button" onClick={addCustom} className="btn-ghost text-xs flex items-center gap-1 py-1">
            <Plus size={12} /> Add Field
          </button>
        </div>
        {custom.length === 0 ? (
          <p className="text-gray-600 text-xs">None. Add fields like “FQDN”, “Customer ID”, “Support #”, “DB Password”.</p>
        ) : (
          <div className="space-y-2">
            {custom.map((c, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className="input w-40 shrink-0"
                  value={c.label}
                  onChange={e => setCustomField(i, 'label', e.target.value)}
                  placeholder="Field name"
                />
                <div className="flex-1">
                  {c.secret
                    ? <PasswordInput
                        value={c.value}
                        onChange={e => setCustomField(i, 'value', e.target.value)}
                        placeholder={c.had_value ? '•••••••• (blank = keep)' : 'Value'}
                      />
                    : <input
                        className="input"
                        value={c.value}
                        onChange={e => setCustomField(i, 'value', e.target.value)}
                        placeholder="Value"
                      />}
                </div>
                <label className="flex items-center gap-1 text-xs text-gray-400 shrink-0 pt-2.5" title="Encrypt & mask this value">
                  <input type="checkbox" checked={c.secret}
                    onChange={e => setCustomField(i, 'secret', e.target.checked)}
                    className="accent-brand" />
                  secret
                </label>
                <button type="button" onClick={() => removeCustom(i)}
                  className="btn-ghost p-2 hover:text-red-400 shrink-0" aria-label="Remove field">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.label || !form.category.trim()} className="btn-primary">
          {saving ? 'Saving…' : cred ? 'Update' : 'Add Credential'}
        </button>
      </div>
    </form>
  );
}

// ─── One credential row ─────────────────────────────────────────────────────--

function CredRow({ c, customerId, locations, companyName, showOffice, isFirst, isLast, onEdit, onDelete, onMove }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        {/* Left: label + meta */}
        <div className="min-w-0 w-48 shrink-0">
          <p className="text-gray-100 text-sm font-medium">
            {c.label}
            {c.unifi_wifi_id && (
              <span className="badge bg-blue-900/40 text-blue-300 ml-2 align-middle" title="WiFi network imported from UniFi — re-import to pick up a changed password">UniFi</span>
            )}
          </p>
          {showOffice && <OfficeBadge locations={locations} locationId={c.location_id} companyName={companyName} className="mt-1" />}
          {c.two_fa_note && <p className="text-gray-500 text-xs mt-0.5">2FA: {c.two_fa_note}</p>}
          {c.url && (
            <a href={c.url} target="_blank" rel="noopener noreferrer"
              className="text-accent text-xs hover:underline truncate block mt-0.5">{c.url}</a>
          )}
          {c.extra_notes && <p className="text-gray-500 text-xs mt-0.5">{c.extra_notes}</p>}
        </div>

        {/* Middle: values — username, password, then any custom fields, all aligned.
            Flexes to use available width so long usernames stay on one line; wraps
            only when there genuinely isn't room. */}
        <div className="flex-1 min-w-[18rem] max-w-2xl space-y-1.5">
          {c.username && (
            <ValueRow label="Username">
              <span className="text-gray-200 text-sm font-mono wrap-break-word">{c.username}</span>
              <CopyBtn text={c.username} />
            </ValueRow>
          )}
          {c.has_password && (
            <ValueRow label="Password">
              <CredentialField
                hasValue={c.has_password}
                onReveal={() => customersApi.credentials.reveal(customerId, c.id).then(r => r.data.value)}
              />
            </ValueRow>
          )}
          {(c.custom_fields ?? []).map(cf => (
            <ValueRow key={cf.id} label={cf.label}>
              {cf.secret
                ? <CredentialField
                    hasValue={cf.has_value}
                    onReveal={() => customersApi.credentials.revealCustom(customerId, c.id, cf.id).then(r => r.data.value)}
                  />
                : <>
                    <span className="text-gray-200 text-sm font-mono wrap-break-word">{cf.value || '—'}</span>
                    {cf.value && <CopyBtn text={cf.value} />}
                  </>}
            </ValueRow>
          ))}
        </div>

        {/* Right: reorder + actions */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col">
            <button onClick={() => onMove('up')} disabled={isFirst}
              className="btn-ghost p-0.5 text-gray-600 hover:text-gray-200 disabled:opacity-20" title="Move up">
              <ChevronUp size={13} />
            </button>
            <button onClick={() => onMove('down')} disabled={isLast}
              className="btn-ghost p-0.5 text-gray-600 hover:text-gray-200 disabled:opacity-20" title="Move down">
              <ChevronDown size={13} />
            </button>
          </div>
          <button onClick={onEdit} className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200"><Pencil size={13} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function ValueRow({ label, children }) {
  return (
    <div className="flex items-baseline gap-2">
      {/* wrap-break-word so a long field name wraps inside its column instead of
          overflowing and overlapping the value to its right. */}
      <span className="text-gray-600 text-xs w-28 shrink-0 text-right wrap-break-word">{label}</span>
      <div className="flex items-center gap-1 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  return (
    <button onClick={onCopy} title="Copy"
      className="text-gray-600 hover:text-accent transition-colors p-0.5 shrink-0">
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────--

function Section({ category, creds, allSectionCreds, customerId, existingCategories, ownCategories, locations, companyName, showOffice, defaultLocationId, isFirst, isLast, dragHandle, onMutate }) {
  const [open, setOpen]   = useState(true);
  const [modal, setModal] = useState(null);
  const [renaming, setRenaming]   = useState(null); // draft name while editing the title
  const [renameErr, setRenameErr] = useState('');

  const cancelRename = () => { setRenaming(null); setRenameErr(''); };
  // Renaming onto another of this customer's section names merges the two, so
  // ask first rather than letting a typo silently fold one section into another.
  const saveRename = async () => {
    const to = (renaming ?? '').trim();
    if (!to || to === category) return cancelRename();
    if (ownCategories.includes(to)
        && !confirm(`"${to}" already exists. Move all ${allSectionCreds.length} credential(s) from "${category}" into it?`)) return;
    try {
      await customersApi.credentials.renameSection(customerId, category, to);
      cancelRename();
      onMutate();
    } catch (err) {
      setRenameErr(err.response?.data?.error ?? 'Rename failed.');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this credential?')) return;
    await customersApi.credentials.remove(customerId, id);
    onMutate();
  };
  const move = async (id, direction) => { await customersApi.credentials.move(customerId, id, direction); onMutate(); };
  const moveSection = async (direction) => { await customersApi.credentials.moveSection(customerId, category, direction); onMutate(); };

  // Sort A–Z persists like a drag-reorder. It always sorts the WHOLE section —
  // not just the rows surviving the search/office filter — so a filtered view
  // can't shuffle hidden entries to the bottom.
  const credLabel  = (c) => c.label;
  const alphaSorted = isSortedByName(allSectionCreds, credLabel);
  const sortAlpha = async () => {
    const ids = sortByName(allSectionCreds, credLabel).map(c => c.id);
    await customersApi.credentials.reorder(customerId, ids);
    onMutate();
  };

  return (
    <div className="border border-surface-600 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-surface-700 px-3 py-2.5">
        <div className="flex items-center gap-1">
          {dragHandle}
          <div className="flex flex-col">
            <button onClick={() => moveSection('up')} disabled={isFirst}
              className="text-gray-600 hover:text-gray-200 disabled:opacity-20" title="Move section up">
              <ChevronUp size={12} />
            </button>
            <button onClick={() => moveSection('down')} disabled={isLast}
              className="text-gray-600 hover:text-gray-200 disabled:opacity-20" title="Move section down">
              <ChevronDown size={12} />
            </button>
          </div>
          {renaming !== null ? (
            <form className="flex items-center gap-1 ml-1 min-w-0 flex-wrap"
              onSubmit={(e) => { e.preventDefault(); saveRename(); }}>
              <input autoFocus className="input py-1 text-sm w-44 sm:w-64" value={renaming}
                onChange={e => setRenaming(e.target.value)} maxLength={255}
                onKeyDown={e => { if (e.key === 'Escape') cancelRename(); }}
                autoComplete="off" data-1p-ignore data-lpignore="true" aria-label="Section name" />
              <button type="submit" disabled={!renaming.trim()} title="Save name"
                className="btn-ghost p-1 text-green-400 disabled:opacity-30"><Check size={14} /></button>
              <button type="button" onClick={cancelRename} title="Cancel"
                className="btn-ghost p-1 text-gray-500 hover:text-gray-200"><X size={14} /></button>
              {renameErr && <span className="text-red-400 text-xs">{renameErr}</span>}
            </form>
          ) : (
            <>
              <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left ml-1">
                {open ? <ChevronDown size={13} className="text-gray-500 shrink-0" />
                      : <ChevronRight size={13} className="text-gray-500 shrink-0" />}
                <span className="text-gray-100 font-medium text-sm">{category}</span>
                <span className="text-gray-600 text-xs">({creds.length})</span>
              </button>
              <button onClick={() => setRenaming(category)} title="Rename section"
                className="btn-ghost p-1 text-gray-600 hover:text-gray-200">
                <Pencil size={11} />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={sortAlpha} disabled={alphaSorted || allSectionCreds.length < 2}
            className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1 disabled:opacity-30"
            title={alphaSorted ? 'Already sorted A–Z' : `Sort ${category} A–Z`}>
            <ArrowDownAZ size={12} /> Sort
          </button>
          <button onClick={() => setModal('new')} className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1">
            <Plus size={11} /> Add
          </button>
        </div>
      </div>

      {open && (
        <div className="divide-y divide-surface-700">
          <DragList
            items={creds}
            onReorder={(items) => customersApi.credentials.reorder(customerId, items.map(i => i.id)).then(onMutate)}
            itemClassName="flex items-start"
            renderItem={(c, handle) => {
              const i = creds.findIndex(x => x.id === c.id);
              return (
                <>
                  <div className="pt-3 pl-1">{handle}</div>
                  <div className="flex-1 min-w-0">
                    <CredRow
                      c={c}
                      customerId={customerId}
                      locations={locations}
                      companyName={companyName}
                      showOffice={showOffice}
                      isFirst={i === 0}
                      isLast={i === creds.length - 1}
                      onEdit={() => setModal(c)}
                      onDelete={() => remove(c.id)}
                      onMove={(dir) => move(c.id, dir)}
                    />
                  </div>
                </>
              );
            }}
          />
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? `Add to ${category}` : 'Edit Credential'}>
        {modal !== null && (
          <CredForm
            customerId={customerId}
            cred={modal === 'new' ? null : modal}
            existingCategories={existingCategories}
            defaultCategory={category}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultLocationId}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); onMutate(); }}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function CredentialsTab({ customerId, locations = [], companyName }) {
  const [addModal, setAddModal] = useState(false);
  const [search, setSearch] = useState('');
  const [office, setOffice] = useOfficeFilter(customerId, 'credentials', locations);

  const { data, refetch } = useQuery({
    queryKey: ['customers', customerId, 'credentials'],
    queryFn: () => customersApi.credentials.list(customerId).then(r => r.data),
  });

  // Section names used by ANY customer — fed into the section combobox so existing
  // sections (e.g. "NAS") autocomplete across customers.
  const { data: globalSections = [] } = useQuery({
    queryKey: ['credential-section-suggestions'],
    queryFn: () => customersApi.credentials.sectionSuggestions(customerId).then(r => r.data),
    staleTime: 60_000,
  });

  const allCreds = data?.credentials ?? [];
  const creds    = allCreds.filter(c => officeMatches(c, office) && matchesQuery(c, search));
  const sections = data?.sections ?? [];
  const showOffice = office === 'all';
  const defaultLocationId = defaultOfficeFor(office);

  // Group creds by category; order sections by the server's section order.
  const groups = {};
  for (const c of creds) {
    const key = c.category || 'General';
    (groups[key] = groups[key] || []).push(c);
  }
  // Unfiltered per-section groups — what "Sort A–Z" reorders (the visible groups
  // above may be a filtered subset).
  const allGroups = {};
  for (const c of allCreds) {
    const key = c.category || 'General';
    (allGroups[key] = allGroups[key] || []).push(c);
  }
  const orderedCats = sections.map(s => s.category).filter(cat => groups[cat]);
  for (const k of Object.keys(groups)) if (!orderedCats.includes(k)) orderedCats.push(k);
  // Every section this customer has, filtered out or not — renaming onto one merges.
  const ownCategories = [...new Set([...sections.map(s => s.category), ...Object.keys(allGroups)])];

  // Combobox options: this customer's sections first, then any others company-wide
  // (deduped case-insensitively).
  const existingCategories = [...orderedCats];
  const seen = new Set(orderedCats.map(c => c.toLowerCase()));
  for (const s of globalSections) {
    if (!seen.has(s.toLowerCase())) { existingCategories.push(s); seen.add(s.toLowerCase()); }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search credentials (section, label, username…)" className="w-full sm:w-72" />
          <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} />
        </div>
        <button onClick={() => setAddModal(true)} className="btn-primary flex items-center gap-2 text-sm shrink-0 ml-auto">
          <Plus size={14} /> Add Credential
        </button>
      </div>

      {allCreds.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No credentials yet"
          description="Add sections for Microsoft 365, Domain, email accounts, and anything else you need."
          action={
            <button onClick={() => setAddModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={14} /> Add First Credential
            </button>
          }
        />
      ) : orderedCats.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No credentials match.</p>
      ) : (
        <div className="space-y-3">
          <DragList
            items={orderedCats.map(c => ({ id: c }))}
            onReorder={(items) => customersApi.credentials.reorderSections(customerId, items.map(i => i.id)).then(refetch)}
            renderItem={(item, handle) => {
              const i = orderedCats.indexOf(item.id);
              return (
                <Section
                  category={item.id}
                  creds={groups[item.id]}
                  allSectionCreds={allGroups[item.id] ?? groups[item.id]}
                  customerId={customerId}
                  existingCategories={existingCategories}
                  ownCategories={ownCategories}
                  locations={locations}
                  companyName={companyName}
                  showOffice={showOffice}
                  defaultLocationId={defaultLocationId}
                  isFirst={i === 0}
                  isLast={i === orderedCats.length - 1}
                  dragHandle={handle}
                  onMutate={refetch}
                />
              );
            }}
          />
        </div>
      )}

      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Credential">
        <CredForm
          customerId={customerId}
          cred={null}
          existingCategories={existingCategories}
          defaultCategory=""
          locations={locations}
          companyName={companyName}
          defaultLocationId={defaultLocationId}
          onClose={() => setAddModal(false)}
          onSaved={() => { setAddModal(false); refetch(); }}
        />
      </Modal>
    </div>
  );
}
