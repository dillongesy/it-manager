import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, Download, Trash2, FileText, Image as ImageIcon, Eye, Pencil, Search, Check, X, ChevronDown } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { FileViewer } from '../ui/FileViewer.jsx';
import { Combobox } from '../ui/Combobox.jsx';
import { OfficeFilterBar, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor, branchLabel } from '../ui/office.jsx';
import { matchesQuery } from '../../utils/search.js';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isImage = (m) => (m ?? '').startsWith('image/');
const canView = (m) => isImage(m) || m === 'application/pdf';

/**
 * Shared file list used by both the Files tab and the Proposals tab.
 * `kind` ('file' | 'proposal') scopes the list and uploads. Categories are
 * user-defined free text, filterable; files can be renamed and viewed in-browser.
 */
export function FileManager({ customerId, kind, locations = [], companyName, emptyHint, defaultPlaceholder }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [viewing, setViewing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [office, setOffice] = useOfficeFilter(customerId, `files-${kind}`, locations);
  // Office a new upload is tagged with — follows the active filter, like the other tabs.
  const [uploadOffice, setUploadOffice] = useState(defaultOfficeFor(office));
  useEffect(() => { setUploadOffice(defaultOfficeFor(office)); }, [office]);

  const { data: files = [], refetch } = useQuery({
    queryKey: ['customers', customerId, 'files', kind],
    queryFn: () => customersApi.files.list(customerId, kind).then(r => r.data),
  });

  const categories = [...new Set(files.map(f => f.category).filter(Boolean))].sort();

  const upload = async (fileList) => {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      for (const file of fileList) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', kind);
        if (uploadCategory.trim()) fd.append('category', uploadCategory.trim());
        if (uploadOffice) fd.append('location_id', uploadOffice);
        await customersApi.files.upload(customerId, fd);
      }
      refetch();
    } finally { setUploading(false); }
  };

  const download = async (file) => {
    const { data } = await customersApi.files.download(customerId, file.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data);
    a.download = file.original_name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const remove = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await customersApi.files.remove(customerId, id);
    refetch();
  };

  // Filter by office + search text + selected category
  const visible = files.filter(f => {
    if (!officeMatches(f, office)) return false;
    if (filterCat && f.category !== filterCat) return false;
    if (!matchesQuery(f, search)) return false;
    return true;
  });
  const showOffice = office === 'all';

  // Group filtered files by category for display
  const groups = {};
  for (const f of visible) {
    const key = f.category || 'Uncategorized';
    (groups[key] = groups[key] || []).push(f);
  }
  const groupNames = Object.keys(groups).sort((a, b) =>
    a === 'Uncategorized' ? 1 : b === 'Uncategorized' ? -1 : a.localeCompare(b));

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 mb-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-brand bg-brand/5 text-brand' : 'border-surface-500 hover:border-surface-400 text-gray-500'
        }`}
      >
        <Upload size={20} className="mx-auto mb-2" />
        <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Drop files here or click to browse'}</p>
        <p className="text-xs mt-1 text-gray-600">Max 50 MB per file</p>
        <div className="flex items-center justify-center gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
          <label className="text-xs text-gray-500">Category:</label>
          <div className="w-48">
            <Combobox value={uploadCategory} onChange={setUploadCategory} options={categories}
              placeholder={defaultPlaceholder ?? 'optional — e.g. Floor Plans'} />
          </div>
          {locations.length > 0 && (
            <select className="input w-48 text-sm" value={uploadOffice} onChange={e => setUploadOffice(e.target.value)}>
              <option value="">{companyName ? `${companyName} (Main)` : 'Main Office'}</option>
              {locations.map(l => <option key={l.id} value={l.id}>{branchLabel(l)}</option>)}
            </select>
          )}
        </div>
        <input ref={inputRef} type="file" multiple className="hidden"
          onClick={e => e.stopPropagation()}
          onChange={e => { upload(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Office filter (only when the customer has branches) */}
      <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} className="mb-3" />

      {/* Filter bar */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input pl-9 text-sm" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44 text-sm" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing here yet" description={emptyHint} />
      ) : visible.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-6">No matches.</p>
      ) : (
        <div className="space-y-5">
          {groupNames.map(cat => (
            <div key={cat}>
              <CategoryHeading
                name={cat}
                count={files.filter(f => f.category === cat).length}
                // "Uncategorized" is files with no category, not a real name to rename.
                renamable={cat !== 'Uncategorized' || categories.includes('Uncategorized')}
                categories={categories}
                onRename={async (to) => {
                  await customersApi.files.renameCategory(customerId, kind, cat, to);
                  if (filterCat === cat) setFilterCat(to);
                  refetch();
                }}
              />
              <div className="space-y-1.5">
                {groups[cat].map(f => (
                  <div key={f.id} className="card px-4 py-3 flex items-center gap-3">
                    {isImage(f.mime_type) ? <ImageIcon size={16} className="text-gray-500 shrink-0" />
                                          : <FileText size={16} className="text-gray-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      {renaming === f.id ? (
                        <RenameInline file={f} customerId={customerId} locations={locations} companyName={companyName}
                          categories={categories}
                          onDone={() => { setRenaming(null); refetch(); }}
                          onCancel={() => setRenaming(null)} />
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-gray-200 text-sm truncate">{f.original_name}</p>
                            {showOffice && <OfficeBadge locations={locations} locationId={f.location_id} companyName={companyName} />}
                          </div>
                          <p className="text-gray-600 text-xs">
                            {formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString()}
                          </p>
                        </>
                      )}
                    </div>
                    {kind === 'proposal' && (
                      <ProposalStatusBadge file={f} customerId={customerId} onChanged={refetch} />
                    )}
                    {canView(f.mime_type) && (
                      <button onClick={() => setViewing(f)} className="btn-ghost p-1.5 text-gray-500 hover:text-accent" title="View">
                        <Eye size={14} />
                      </button>
                    )}
                    <button onClick={() => setRenaming(f.id)} className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200" title="Rename / recategorize">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => download(f)} className="btn-ghost p-1.5 text-gray-500 hover:text-accent" title="Download">
                      <Download size={14} />
                    </button>
                    <button onClick={() => remove(f.id, f.original_name)} className="btn-ghost p-1.5 text-gray-500 hover:text-red-400" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && <FileViewer customerId={customerId} file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// Category heading with an inline rename — renames the category on every file in
// it. Renaming onto another existing category merges the two, so ask first.
function CategoryHeading({ name, count, renamable, categories, onRename }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const cancel = () => { setDraft(null); setError(''); };

  const save = async () => {
    const to = (draft ?? '').trim();
    if (!to || to === name) return cancel();
    if (categories.includes(to)
        && !confirm(`"${to}" already exists. Move all ${count} file(s) from "${name}" into it?`)) return;
    try { await onRename(to); cancel(); }
    catch (err) { setError(err.response?.data?.error ?? 'Rename failed.'); }
  };

  if (draft !== null) {
    return (
      <form className="flex items-center gap-1 mb-2 flex-wrap" onSubmit={e => { e.preventDefault(); save(); }}>
        <input autoFocus className="input py-1 text-sm w-48 sm:w-64" value={draft} maxLength={100}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') cancel(); }}
          autoComplete="off" aria-label="Category name" />
        <button type="submit" disabled={!draft.trim()} title="Save name"
          className="btn-ghost p-1 text-green-400 disabled:opacity-30"><Check size={14} /></button>
        <button type="button" onClick={cancel} title="Cancel"
          className="btn-ghost p-1 text-gray-500 hover:text-gray-200"><X size={14} /></button>
        {error && <span className="text-red-400 text-xs">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 mb-2">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{name}</h4>
      {renamable && (
        <button onClick={() => setDraft(name)} title="Rename category"
          className="btn-ghost p-1 text-gray-600 hover:text-gray-200">
          <Pencil size={11} />
        </button>
      )}
    </div>
  );
}

// Status badge + inline changer for proposals.
const STATUS_STYLES = {
  pending:  'bg-amber-900/40 text-amber-400',
  accepted: 'bg-green-900/40 text-green-400',
  rejected: 'bg-red-900/40 text-red-400',
};
const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };

function ProposalStatusBadge({ file, customerId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const status = file.proposal_status || 'pending';

  const set = async (val) => {
    setSaving(true);
    setOpen(false);
    try {
      await customersApi.files.update(customerId, file.id, { proposal_status: val });
      onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-sm ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
      >
        {STATUS_LABEL[status]}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden shadow-xl min-w-[110px]">
          {Object.entries(STATUS_LABEL).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => set(val)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-700 ${val === status ? 'font-semibold' : ''} ${STATUS_STYLES[val]?.replace(/bg-\S+/, '').trim() ?? ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline rename + recategorize. The extension is preserved server-side regardless.
function RenameInline({ file, customerId, locations = [], companyName, categories = [], onDone, onCancel }) {
  const dot = file.original_name.lastIndexOf('.');
  const baseName = dot > 0 ? file.original_name.slice(0, dot) : file.original_name;
  const ext = dot > 0 ? file.original_name.slice(dot) : '';
  const [name, setName] = useState(baseName);
  const [category, setCategory] = useState(file.category ?? '');
  const [locationId, setLocationId] = useState(file.location_id ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await customersApi.files.update(customerId, file.id, { original_name: name, category, location_id: locationId || null });
      onDone();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input className="input text-sm py-1" value={name} onChange={e => setName(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }} />
        {ext && <span className="text-gray-500 text-xs shrink-0">{ext}</span>}
      </div>
      <div className="w-40 shrink-0">
        <Combobox value={category} onChange={setCategory} options={categories} placeholder="category" />
      </div>
      {locations.length > 0 && (
        <select className="input text-sm py-1 w-40 shrink-0" value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">{companyName ? `${companyName} (Main)` : 'Main Office'}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{branchLabel(l)}</option>)}
        </select>
      )}
      <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 p-1 shrink-0"><Check size={14} /></button>
      <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 p-1 shrink-0"><X size={14} /></button>
    </div>
  );
}
