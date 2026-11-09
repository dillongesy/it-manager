import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Send, Trash2,
  Plus, X, Pencil, Timer, TimerOff, AlertCircle, Printer, FileText, Eye, Ban, Undo2, Upload,
} from 'lucide-react';
import { customersApi } from '../api/customers.js';
import { workOrdersApi } from '../api/workOrders.js';
import { inventoryApi } from '../api/inventory.js';
import { serviceCatalogApi } from '../api/serviceCatalog.js';
import api from '../api/client.js';
import { printWorkOrder } from '../lib/printWorkOrder.js';
import { loadProposalImages, missingProposalsMessage } from '../lib/proposalImages.js';
import { FileViewer } from '../components/ui/FileViewer.jsx';
import { VoidWorkOrderModal } from '../components/work/VoidWorkOrder.jsx';
import { WO_STATUS_BADGE as STATUS_BADGE, WO_STATUS_LABEL as STATUS_LABEL } from '../utils/woStatus.js';
import { formatDate, toDateInput } from '../utils/date.js';
import { CadenceSelect } from '../components/ui/CadenceSelect.jsx';
import { cadenceLabel, cadenceUnit } from '../utils/cadence.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }
const money = (v) => `$${parseFloat(v || 0).toFixed(2)}`;

// ─── Timer hook ───────────────────────────────────────────────────────────────

function useTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const tickRef  = useRef(null);
  const start = () => { startRef.current = Date.now() - elapsed * 1000; setRunning(true);
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000); };
  const stop = () => { clearInterval(tickRef.current); setRunning(false); return elapsed / 3600; };
  const reset = () => { clearInterval(tickRef.current); setRunning(false); setElapsed(0); };
  useEffect(() => () => clearInterval(tickRef.current), []);
  const display = () => {
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  return { running, display, start, stop, reset };
}

// ─── Per-section parts list ─────────────────────────────────────────────────────

function SectionItems({ woId, sectionId, items, onChanged, readonly }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ description: '', quantity: '1', unit_price: '', part_number: '', inventory_item_id: null });
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState([]);
  const [showMatches, setShowMatches] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [addError, setAddError] = useState('');
  const boxRef = useRef(null);
  const qtyRef = useRef(null);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value, ...(k === 'description' ? { inventory_item_id: null } : {}) }));
  const setEdit = k => e => setEditForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const q = form.description.trim();
    if (!adding || form.inventory_item_id || q.length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      try { const { data } = await inventoryApi.list({ search: q, limit: 6 }); setMatches(data || []); setShowMatches(true); }
      catch { setMatches([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [form.description, form.inventory_item_id, adding]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setShowMatches(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const reset = () => { setForm({ description: '', quantity: '1', unit_price: '', part_number: '', inventory_item_id: null }); setAdding(false); };

  const saveItem = async (override) => {
    const src = override ?? form;
    if (!src.description?.trim()) return;
    setSaving(true);
    setAddError('');
    try {
      const { data } = await workOrdersApi.sections.addItem(woId, sectionId, {
        description: src.description.trim(),
        quantity: parseFloat(src.quantity) || 1,
        unit_price: src.unit_price || null,
        part_number: src.part_number || null,
        inventory_item_id: src.inventory_item_id || null,
      });
      onChanged(data);
      if (data.inventory_warning) alert(`Saved, but shared inventory was not updated: ${data.inventory_warning}`);
      setForm({ description: '', quantity: '1', unit_price: '', part_number: '', inventory_item_id: null });
      setMatches([]); setShowMatches(false);
    } catch (err) {
      setAddError(err.response?.data?.error ?? 'Could not save this part. Please try again.');
    } finally { setSaving(false); }
  };

  const pickInventory = (it) => {
    setForm(f => ({
      ...f,
      description: it.name,
      inventory_item_id: it.id,
      part_number: it.sku || '',
      unit_price: it.cost_per_unit != null ? String(it.cost_per_unit) : '',
    }));
    setMatches([]);
    setShowMatches(false);
    qtyRef.current?.focus();
  };

  const startEdit = (it) => {
    setAdding(false);
    setEditError('');
    setEditingId(it.id);
    setEditForm({
      description: it.description,
      quantity: String(it.quantity),
      unit_price: it.unit_price != null ? String(it.unit_price) : '',
      part_number: it.part_number ?? '',
      inventory_item_id: it.inventory_item_id ?? null,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); setEditError(''); };

  const saveEdit = async () => {
    if (!editForm.description?.trim()) return;
    setEditSaving(true);
    setEditError('');
    try {
      const qty = parseFloat(editForm.quantity) || 1;
      const up  = editForm.unit_price !== '' && editForm.unit_price != null ? parseFloat(editForm.unit_price) : null;
      const { data } = await workOrdersApi.items.update(woId, editingId, {
        description: editForm.description.trim(),
        quantity: qty,
        unit_price: up,
        total_price: up != null ? up * qty : null,
        part_number: editForm.part_number || null,
        inventory_item_id: editForm.inventory_item_id || null,
      });
      onChanged(data);
      if (data.inventory_warning) alert(`Saved, but shared inventory was not updated: ${data.inventory_warning}`);
      cancelEdit();
    } catch (err) {
      setEditError(err.response?.data?.error ?? 'Could not save changes. Please try again.');
    } finally { setEditSaving(false); }
  };

  const removeItem = async (it) => {
    const msg = it.inventory_item_id
      ? `Remove "${it.description}"? This will return ${it.quantity} to shared inventory.`
      : `Remove "${it.description}"?`;
    if (!confirm(msg)) return;
    const { data } = await workOrdersApi.items.remove(woId, it.id);
    onChanged(data);
    if (data.inventory_warning) alert(`Removed, but shared inventory was not updated: ${data.inventory_warning}`);
  };

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Parts & Materials</p>
      {items.length > 0 && (
        <div className="space-y-1 mb-2">
          {items.map(it => (
            editingId === it.id ? (
              <div key={it.id} className="bg-surface-700 rounded-lg p-3 space-y-2.5"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Item / Description</label>
                    <input className="input text-sm" value={editForm.description} onChange={setEdit('description')} autoFocus autoComplete="off" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
                    <input className="input text-sm" type="number" min="1" step="1" value={editForm.quantity}
                      onChange={setEdit('quantity')} onFocus={e => e.target.select()} onWheel={e => e.currentTarget.blur()} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Unit Price</label>
                    <input className="input text-sm" type="number" min="0" step="0.01" placeholder="0.00" value={editForm.unit_price}
                      onChange={setEdit('unit_price')} onWheel={e => e.currentTarget.blur()} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Part Number <span className="text-gray-600">(optional)</span></label>
                  <input className="input text-sm" placeholder="P/N" value={editForm.part_number} onChange={setEdit('part_number')} autoComplete="off" />
                </div>
                {editForm.inventory_item_id && (
                  <p className="text-xs text-accent flex items-center gap-1">
                    ● Linked to shared inventory — qty changes will adjust stock
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, inventory_item_id: null }))} className="text-gray-500 hover:text-gray-300 ml-1 underline">unlink</button>
                  </p>
                )}
                {editError && <p className="text-red-400 text-xs bg-red-900/20 rounded-sm p-2">{editError}</p>}
                <div className="flex items-center justify-end gap-2">
                  <span className="text-gray-600 text-xs mr-auto hidden sm:inline">Enter to save · Esc to cancel</span>
                  <button onClick={cancelEdit} className="btn-secondary text-xs py-1">Cancel</button>
                  <button onClick={saveEdit} disabled={editSaving || !editForm.description?.trim()} className="btn-primary text-xs py-1">{editSaving ? '…' : 'Save'}</button>
                </div>
              </div>
            ) : (
              <div key={it.id} className="flex items-center gap-2 text-sm group">
                <span className="flex-1 text-gray-300 min-w-0">
                  {it.description}
                  {it.part_number && <span className="text-gray-600 text-xs ml-2">P/N: {it.part_number}</span>}
                  {it.inventory_item_id && <span className="text-accent text-xs ml-2" title="Linked to shared inventory">●</span>}
                  <span className="text-gray-500 text-xs ml-2">× {it.quantity}</span>
                  {it.unit_price != null && it.quantity > 1 && (
                    <span className="text-gray-500 text-xs ml-2">· {money(it.unit_price)} each</span>
                  )}
                </span>
                <span className="text-gray-400 text-xs text-right whitespace-nowrap shrink-0">
                  {it.total_price != null ? money(it.total_price) : '—'}
                </span>
                {!readonly && (
                  <>
                    <button onClick={() => startEdit(it)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 hover:text-gray-200" title="Edit"><Pencil size={12} /></button>
                    <button onClick={() => removeItem(it)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 hover:text-red-400" title="Remove"><X size={12} /></button>
                  </>
                )}
              </div>
            )
          ))}
        </div>
      )}
      {!readonly && (adding ? (
        <div className="bg-surface-700 rounded-lg p-3 space-y-2.5"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveItem(); } }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="col-span-2 relative" ref={boxRef}>
              <label className="block text-xs text-gray-500 mb-0.5">Item / Description</label>
              <input className="input text-sm" placeholder="Search inventory or type…" value={form.description}
                onChange={set('description')} onFocus={() => matches.length && setShowMatches(true)} autoFocus autoComplete="off" />
              {showMatches && matches.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden max-h-56 overflow-y-auto shadow-xl">
                  {matches.map(it => (
                    <button key={it.id} type="button" onClick={() => pickInventory(it)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-700 border-b border-surface-700 last:border-0">
                      <div className="text-sm text-gray-200">{it.name}</div>
                      <div className="text-xs text-gray-500">{it.sku}{it.quantity != null ? ` · ${it.quantity} in stock` : ''}{it.cost_per_unit != null ? ` · $${it.cost_per_unit}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
              <input ref={qtyRef} className="input text-sm" placeholder="1" type="number" min="1" step="1" value={form.quantity}
                onChange={set('quantity')} onFocus={e => e.target.select()} onWheel={e => e.currentTarget.blur()} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Unit Price</label>
              <input className="input text-sm" placeholder="0.00" type="number" min="0" step="0.01" value={form.unit_price}
                onChange={set('unit_price')} onWheel={e => e.currentTarget.blur()} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Part Number <span className="text-gray-600">(optional)</span></label>
            <input className="input text-sm" placeholder="P/N" value={form.part_number} onChange={set('part_number')} autoComplete="off" />
          </div>
          {form.inventory_item_id && (
            <p className="text-xs text-accent flex items-center gap-1">
              ● Linked — adding will subtract {form.quantity || 1} from shared inventory
              <button type="button" onClick={() => setForm(f => ({ ...f, inventory_item_id: null }))} className="text-gray-500 hover:text-gray-300 ml-1 underline">unlink</button></p>
          )}
          {addError && <p className="text-red-400 text-xs bg-red-900/20 rounded-sm p-2">{addError}</p>}
          <div className="flex items-center justify-end gap-2">
            <span className="text-gray-600 text-xs mr-auto">Press Enter to add</span>
            <button onClick={reset} className="btn-secondary text-xs py-1">Done</button>
            <button onClick={() => saveItem()} disabled={saving || !form.description.trim()} className="btn-primary text-xs py-1">{saving ? '…' : 'Add'}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setEditingId(null); setAdding(true); }} className="btn-ghost text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-300">
          <Plus size={12} /> Add part
        </button>
      ))}
    </div>
  );
}

// ─── Per-section services (one-time + recurring) ─────────────────────────────────

const RECURRENCE_OPTS = [
  { value: 'monthly',    label: 'Monthly' },
  { value: 'quarterly',  label: 'Quarterly' },
  { value: 'semiannual', label: 'Semi-annually' },
  { value: 'annual',     label: 'Annually' },
];
// "/mo", "/yr", "/3yr" — the count is what makes a multi-year term readable.
const recurSuffix = (sv) => `/${cadenceUnit(sv.recurrence, sv.recurrence_count)}`;
const blankService = () => ({ description: '', quantity: '1', unit_price: '', billing_type: 'one_time', recurrence: 'monthly', recurrence_count: 1, notes: '' });

function SectionServices({ woId, sectionId, services, onChanged, readonly }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankService());
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [addError, setAddError] = useState('');
  const [matches, setMatches] = useState([]);
  const [showMatches, setShowMatches] = useState(false);
  const svcBoxRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setEdit = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }));

  // Suggest catalog services as the name is typed (free-form still allowed).
  useEffect(() => {
    const q = form.description.trim();
    if (!adding || q.length < 1) { setMatches([]); return; }
    const t = setTimeout(async () => {
      try { const { data } = await serviceCatalogApi.list({ q }); setMatches(data || []); setShowMatches(true); }
      catch { setMatches([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [form.description, adding]);

  useEffect(() => {
    const onDoc = (e) => { if (svcBoxRef.current && !svcBoxRef.current.contains(e.target)) setShowMatches(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickService = (s) => {
    setForm((f) => ({
      ...f,
      description: s.name,
      unit_price: s.unit_price != null ? String(s.unit_price) : f.unit_price,
      billing_type: s.billing_type ?? f.billing_type,
      recurrence: s.recurrence ?? f.recurrence ?? 'monthly',
      // Without this a catalog service sold "every 3 years" landed here as plain
      // "Annually" and printed that way on the customer's invoice.
      recurrence_count: s.recurrence_count ?? 1,
    }));
    setMatches([]); setShowMatches(false);
  };

  const reset = () => { setForm(blankService()); setAdding(false); setMatches([]); setShowMatches(false); };

  const save = async () => {
    if (!form.description.trim()) return;
    setSaving(true);
    setAddError('');
    try {
      const { data } = await workOrdersApi.sections.addService(woId, sectionId, {
        description: form.description.trim(),
        quantity: parseFloat(form.quantity) || 1,
        unit_price: form.unit_price || null,
        billing_type: form.billing_type,
        recurrence: form.billing_type === 'recurring' ? form.recurrence : null,
        recurrence_count: form.billing_type === 'recurring' ? form.recurrence_count : 1,
        notes: form.notes || null,
      });
      onChanged(data);
      setForm(blankService());
    } catch (err) {
      setAddError(err.response?.data?.error ?? 'Could not save this service. Please try again.');
    } finally { setSaving(false); }
  };

  const startEdit = (sv) => {
    setAdding(false);
    setEditError('');
    setEditingId(sv.id);
    setEditForm({
      description: sv.description,
      quantity: String(sv.quantity),
      unit_price: sv.unit_price != null ? String(sv.unit_price) : '',
      billing_type: sv.billing_type ?? 'one_time',
      recurrence: sv.recurrence ?? 'monthly',
      recurrence_count: sv.recurrence_count ?? 1,
      notes: sv.notes ?? '',
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); setEditError(''); };

  const saveEdit = async () => {
    if (!editForm.description?.trim()) return;
    setEditSaving(true);
    setEditError('');
    try {
      const { data } = await workOrdersApi.services.update(woId, editingId, {
        description: editForm.description.trim(),
        quantity: parseFloat(editForm.quantity) || 1,
        unit_price: editForm.unit_price || null,
        billing_type: editForm.billing_type,
        recurrence: editForm.billing_type === 'recurring' ? editForm.recurrence : null,
        recurrence_count: editForm.billing_type === 'recurring' ? editForm.recurrence_count : 1,
        notes: editForm.notes || null,
      });
      onChanged(data);
      cancelEdit();
    } catch (err) {
      setEditError(err.response?.data?.error ?? 'Could not save changes. Please try again.');
    } finally { setEditSaving(false); }
  };

  const remove = async (sv) => {
    if (!confirm(`Remove service "${sv.description}"?`)) return;
    const { data } = await workOrdersApi.services.remove(woId, sv.id);
    onChanged(data);
  };

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Services</p>
      {services.length > 0 && (
        <div className="space-y-1 mb-2">
          {services.map((sv) => {
            const recurring = sv.billing_type === 'recurring';
            return editingId === sv.id ? (
              <div key={sv.id} className="bg-surface-700 rounded-lg p-3 space-y-2.5"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Service</label>
                    <input className="input text-sm" value={editForm.description} onChange={setEdit('description')} autoFocus autoComplete="off" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
                    <input className="input text-sm" type="number" min="1" step="1" value={editForm.quantity}
                      onChange={setEdit('quantity')} onFocus={(e) => e.target.select()} onWheel={(e) => e.currentTarget.blur()} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Price (each)</label>
                    <input className="input text-sm" type="number" min="0" step="0.01" placeholder="0.00" value={editForm.unit_price}
                      onChange={setEdit('unit_price')} onWheel={(e) => e.currentTarget.blur()} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Billing</label>
                    <select className="input text-sm" value={editForm.billing_type} onChange={setEdit('billing_type')}>
                      <option value="one_time">One-time</option>
                      <option value="recurring">Recurring</option>
                    </select>
                  </div>
                  {editForm.billing_type === 'recurring' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">How often</label>
                      <CadenceSelect options={RECURRENCE_OPTS} inputClass="input text-sm"
                        frequency={editForm.recurrence} count={editForm.recurrence_count}
                        onChange={({ frequency, count }) =>
                          setEditForm((f) => ({ ...f, recurrence: frequency, recurrence_count: count }))} />
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Notes <span className="text-gray-600">(optional)</span></label>
                  <input className="input text-sm" placeholder="Optional notes…" value={editForm.notes} onChange={setEdit('notes')} autoComplete="off" />
                </div>
                {editError && <p className="text-red-400 text-xs bg-red-900/20 rounded-sm p-2">{editError}</p>}
                <div className="flex items-center justify-end gap-2">
                  <span className="text-gray-600 text-xs mr-auto hidden sm:inline">Enter to save · Esc to cancel</span>
                  <button onClick={cancelEdit} className="btn-secondary text-xs py-1">Cancel</button>
                  <button onClick={saveEdit} disabled={editSaving || !editForm.description?.trim()} className="btn-primary text-xs py-1">{editSaving ? '…' : 'Save'}</button>
                </div>
              </div>
            ) : (
              <div key={sv.id} className="flex items-center gap-2 text-sm group">
                <span className="flex-1 text-gray-300 min-w-0">
                  {sv.description}
                  <span className="text-gray-500 text-xs ml-2">× {sv.quantity}</span>
                  <span className={`text-xs ml-2 px-1.5 py-0.5 rounded-sm ${recurring ? 'bg-blue-900/40 text-blue-300' : 'bg-surface-600 text-gray-400'}`}>
                    {recurring ? `Recurring · ${cadenceLabel(sv.recurrence, sv.recurrence_count)}` : 'One-time'}
                  </span>
                  {sv.unit_price != null && sv.quantity > 1 && (
                    <span className="text-gray-500 text-xs ml-3">
                      Per-item: {money(sv.unit_price)}{recurring ? recurSuffix(sv) : ''}
                    </span>
                  )}
                </span>
                <span className="text-gray-400 text-xs text-right whitespace-nowrap shrink-0">
                  {sv.total_price != null ? `${money(sv.total_price)}${recurring ? recurSuffix(sv) : ''}` : '—'}
                </span>
                {!readonly && (
                  <>
                    <button onClick={() => startEdit(sv)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 hover:text-gray-200" title="Edit"><Pencil size={12} /></button>
                    <button onClick={() => remove(sv)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 hover:text-red-400" title="Remove"><X size={12} /></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!readonly && (adding ? (
        <div className="bg-surface-700 rounded-lg p-3 space-y-2.5"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="col-span-2 relative" ref={svcBoxRef}>
              <label className="block text-xs text-gray-500 mb-0.5">Service</label>
              <input className="input text-sm" placeholder="e.g. ThreatLocker Complete, Microsoft 365…"
                value={form.description} onChange={set('description')}
                onFocus={() => matches.length && setShowMatches(true)} autoFocus autoComplete="off" />
              {showMatches && matches.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden max-h-56 overflow-y-auto shadow-xl">
                  {matches.map((s) => (
                    <button key={s.id} type="button" onClick={() => pickService(s)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-700 border-b border-surface-700 last:border-0">
                      <div className="text-sm text-gray-200">{s.name}</div>
                      <div className="text-xs text-gray-500">
                        {s.unit_price != null ? `$${parseFloat(s.unit_price).toFixed(2)}` : 'no price'}
                        {s.billing_type === 'recurring'
                          ? ` · ${cadenceLabel(s.recurrence, s.recurrence_count)}`
                          : ' · one-time'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
              <input className="input text-sm" type="number" min="1" step="1" value={form.quantity}
                onChange={set('quantity')} onFocus={(e) => e.target.select()} onWheel={(e) => e.currentTarget.blur()} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Price (each)</label>
              <input className="input text-sm" type="number" min="0" step="0.01" placeholder="0.00" value={form.unit_price}
                onChange={set('unit_price')} onWheel={(e) => e.currentTarget.blur()} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Billing</label>
              <select className="input text-sm" value={form.billing_type} onChange={set('billing_type')}>
                <option value="one_time">One-time</option>
                <option value="recurring">Recurring</option>
              </select>
            </div>
            {form.billing_type === 'recurring' && (
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">How often</label>
                <CadenceSelect options={RECURRENCE_OPTS} inputClass="input text-sm"
                  frequency={form.recurrence} count={form.recurrence_count}
                  onChange={({ frequency, count }) =>
                    setForm((f) => ({ ...f, recurrence: frequency, recurrence_count: count }))} />
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {form.billing_type === 'recurring'
              ? 'Recurring charges are listed for the biller separately — they are not added to this work order’s one-time total.'
              : 'One-time charges are added to this work order’s total.'}
          </p>
          {addError && <p className="text-red-400 text-xs bg-red-900/20 rounded-sm p-2">{addError}</p>}
          <div className="flex items-center justify-end gap-2">
            <span className="text-gray-600 text-xs mr-auto">Press Enter to add</span>
            <button onClick={reset} className="btn-secondary text-xs py-1">Done</button>
            <button onClick={save} disabled={saving || !form.description.trim()} className="btn-primary text-xs py-1">{saving ? '…' : 'Add'}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setEditingId(null); setAdding(true); }} className="btn-ghost text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-300">
          <Plus size={12} /> Add service
        </button>
      ))}
    </div>
  );
}

// ─── Section card ───────────────────────────────────────────────────────────────

function SectionCard({ wo, section, index, users, rates, readonly, onChanged, onRemove, canRemove }) {
  const [local, setLocal] = useState({
    work_date:       toDateInput(section.work_date),
    description:     section.description ?? '',
    hours:           section.hours != null ? String(section.hours) : '',
    billing_rate_id: section.billing_rate_id ?? '',
    travel_minutes:  section.travel_minutes != null ? String(section.travel_minutes) : '',
    is_remote:       section.is_remote ?? false,
    needs_followup:  section.needs_followup ?? false,
    followup_notes:  section.followup_notes ?? '',
    internal_notes:  section.internal_notes ?? '',
  });
  const [showInternal, setShowInternal] = useState(
    !!(section.travel_minutes || section.is_remote || section.needs_followup || section.followup_notes || section.internal_notes)
  );
  const timer = useTimer();
  const [freeTechInput, setFreeTechInput] = useState('');
  // Linked technicians are Portal user accounts; free techs are typed names
  // (e.g. camera crew carried over from an imported field job).
  const linkedTechIds = section.technicians?.filter(t => t.user_id).map(t => t.user_id) ?? [];
  const freeTechs = section.technicians?.filter(t => !t.user_id).map(t => t.full_name).filter(Boolean) ?? [];

  const patch = async (partial) => {
    const { data } = await workOrdersApi.sections.update(wo.id, section.id, partial);
    onChanged(data);
  };
  const setField = (k, v) => setLocal(s => ({ ...s, [k]: v }));
  const saveField = (k) => patch({ [k]: local[k] === '' ? null : local[k] });

  const toggleTech = (uid) => {
    const next = linkedTechIds.includes(uid) ? linkedTechIds.filter(i => i !== uid) : [...linkedTechIds, uid];
    patch({ technician_ids: next });
  };
  const addFreeTech = () => {
    const name = freeTechInput.trim();
    if (!name || freeTechs.some(t => t.toLowerCase() === name.toLowerCase())) { setFreeTechInput(''); return; }
    setFreeTechInput('');
    patch({ free_technicians: [...freeTechs, name] });
  };
  const removeFreeTech = (name) => patch({ free_technicians: freeTechs.filter(t => t !== name) });

  const stopTimerAndApply = () => {
    const hrs = timer.stop();
    const newHrs = Math.round(((parseFloat(local.hours) || 0) + hrs) * 100) / 100;
    setField('hours', String(newHrs));
    patch({ hours: newHrs });
    timer.reset();
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Work Section {index + 1}</h3>
        {!readonly && canRemove && (
          <button onClick={onRemove} className="btn-ghost p-1 text-gray-600 hover:text-red-400" title="Remove section"><Trash2 size={14} /></button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Date</label>
          <input className="input text-sm" type="date" value={local.work_date}
            onChange={e => setField('work_date', e.target.value)} onBlur={() => saveField('work_date')} disabled={readonly} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Hours <span className="text-gray-600 normal-case font-normal">(all techs combined)</span></label>
          <div className="flex gap-2">
            <input className="input text-sm" type="number" min="0" step="0.25" value={local.hours}
              onChange={e => setField('hours', e.target.value)} onBlur={() => saveField('hours')} disabled={readonly}
              onWheel={e => e.currentTarget.blur()} placeholder="0.00" />
            {!readonly && (timer.running
              ? <button onClick={stopTimerAndApply} className="btn-secondary text-xs px-2 shrink-0 flex items-center gap-1"><TimerOff size={13} />{timer.display()}</button>
              : <button onClick={timer.start} className="btn-secondary text-xs px-2 shrink-0" title="Start timer"><Timer size={14} /></button>)}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Billing Rate <span className="text-gray-600 normal-case">(overrides WO)</span>
          </label>
          {readonly ? (
            <p className="text-gray-300 text-sm pt-1.5">{section.effective_rate_label ?? '—'}{section.effective_rate != null ? ` — ${money(section.effective_rate)}/hr` : ''}</p>
          ) : (
            <select className="input text-sm" value={local.billing_rate_id}
              onChange={e => { setField('billing_rate_id', e.target.value); patch({ billing_rate_id: e.target.value || null }); }}>
              <option value="">Use WO default{wo.billing_rate_label ? ` (${wo.billing_rate_label})` : ''}</option>
              {rates.map(r => <option key={r.id} value={r.id}>{r.label} (${parseFloat(r.rate).toFixed(2)}/hr)</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Technicians */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-400 mb-2">Technician(s)</label>
        <div className="flex flex-wrap gap-2">
          {users.filter(u => u.role !== 'biller').map(u => {
            const selected = linkedTechIds.includes(u.id);
            return (
              <button key={u.id} type="button" disabled={readonly} onClick={() => !readonly && toggleTech(u.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  selected ? 'bg-brand text-white' : 'bg-surface-600 text-gray-400 hover:bg-surface-500 hover:text-gray-200 disabled:cursor-default'
                }`}>
                {u.full_name}
              </button>
            );
          })}
          {/* Free-typed technicians (e.g. camera crew from an imported field job) */}
          {freeTechs.map(name => (
            <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium bg-accent/20 text-accent">
              {name}
              {!readonly && (
                <button type="button" onClick={() => removeFreeTech(name)} className="hover:text-white" title="Remove technician">
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
        {!readonly && (
          <div className="flex gap-2 mt-2 max-w-xs">
            <input className="input text-sm py-1" placeholder="Add other technician…" value={freeTechInput}
              onChange={e => setFreeTechInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeTech(); } }} />
            <button type="button" onClick={addFreeTech} disabled={!freeTechInput.trim()}
              className="btn-secondary text-xs px-3 shrink-0">Add</button>
          </div>
        )}
      </div>

      {/* Work performed */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Work Performed <span className="text-gray-600 normal-case">(on customer PDF)</span></label>
        <textarea className="input resize-none text-sm" rows={3} value={local.description}
          onChange={e => setField('description', e.target.value)} onBlur={() => saveField('description')} disabled={readonly}
          placeholder="Describe the work performed…" />
      </div>

      {/* Parts per section */}
      <SectionItems woId={wo.id} sectionId={section.id} items={section.items} readonly={readonly} onChanged={onChanged} />

      {/* Services per section */}
      <SectionServices woId={wo.id} sectionId={section.id} services={section.services ?? []} readonly={readonly} onChanged={onChanged} />

      {/* Section totals */}
      {(section.labor_total > 0 || section.parts_total > 0 || section.services_onetime_total > 0) && (
        <div className="mt-3 pt-2 border-t border-surface-700 flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500">
          <div className="flex gap-6">
            {section.labor_total > 0 && <span>Labor: <span className="text-gray-300">{money(section.labor_total)}</span></span>}
            {section.parts_total > 0 && <span>Parts: <span className="text-gray-300">{money(section.parts_total)}</span></span>}
            {section.services_onetime_total > 0 && <span>Services: <span className="text-gray-300">{money(section.services_onetime_total)}</span></span>}
          </div>
        </div>
      )}

      {/* Internal (collapsible) */}
      <div className="mt-4 border-t border-surface-700 pt-3">
        <button onClick={() => setShowInternal(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300">
          {showInternal ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Internal <span className="text-gray-600 font-normal normal-case">(not on PDF)</span>
        </button>
        {showInternal && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Travel (min)</label>
                <input className="input text-sm" type="number" min="0" step="5" value={local.travel_minutes}
                  onChange={e => setField('travel_minutes', e.target.value)} onBlur={() => saveField('travel_minutes')} disabled={readonly} onWheel={e => e.currentTarget.blur()} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer pt-6">
                <input type="checkbox" checked={local.is_remote} disabled={readonly} className="accent-brand"
                  onChange={e => { setField('is_remote', e.target.checked); patch({ is_remote: e.target.checked }); }} />
                Remote
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer pt-6">
                <input type="checkbox" checked={local.needs_followup} disabled={readonly} className="accent-brand"
                  onChange={e => { setField('needs_followup', e.target.checked); patch({ needs_followup: e.target.checked }); }} />
                Follow-up
              </label>
            </div>
            {local.needs_followup && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Follow-up Notes</label>
                <input className="input text-sm" value={local.followup_notes}
                  onChange={e => setField('followup_notes', e.target.value)} onBlur={() => saveField('followup_notes')} disabled={readonly} />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Internal Notes</label>
              <textarea className="input resize-none text-sm" rows={2} value={local.internal_notes}
                onChange={e => setField('internal_notes', e.target.value)} onBlur={() => saveField('internal_notes')} disabled={readonly} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WO-level proposal row ────────────────────────────────────────────────────

function WoProposalRow({ woId, woProp, customerId, readonly, onChanged, onView }) {
  const [price, setPrice] = useState(woProp.price_excl_tax != null ? String(woProp.price_excl_tax) : '');

  const savePrice = async () => {
    const { data } = await workOrdersApi.woProposals.update(woId, woProp.id, {
      price_excl_tax: price !== '' ? price : null,
    });
    onChanged(data);
  };

  const remove = async () => {
    const { data } = await workOrdersApi.woProposals.remove(woId, woProp.id);
    onChanged(data);
  };

  return (
    <div className="card p-4 flex items-center gap-3">
      <FileText size={15} className="text-gray-500 shrink-0" />
      <span className="text-sm text-gray-300 flex-1 min-w-0 truncate">{woProp.proposal_name || 'Unnamed proposal'}</span>
      {!readonly ? (
        <div className="flex items-center gap-1 text-xs shrink-0">
          <span className="text-gray-600">$</span>
          <input
            type="number" min="0" step="0.01"
            className="input text-xs py-1 w-28"
            value={price}
            onChange={e => setPrice(e.target.value)}
            onBlur={savePrice}
            onWheel={e => e.currentTarget.blur()}
            placeholder="Price excl. tax"
          />
        </div>
      ) : woProp.price_excl_tax != null ? (
        <span className="text-sm text-gray-300 shrink-0">
          ${parseFloat(woProp.price_excl_tax).toFixed(2)}
          <span className="text-xs text-gray-600 ml-1">excl. tax</span>
        </span>
      ) : null}
      {woProp.proposal_file_id && (
        <button
          type="button"
          className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200 shrink-0"
          title="View proposal PDF"
          onClick={onView}
        >
          <Eye size={14} />
        </button>
      )}
      {!readonly && (
        <button
          type="button"
          className="btn-ghost p-1.5 text-gray-600 hover:text-red-400 shrink-0"
          onClick={remove}
          title="Remove proposal"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Add proposal picker ──────────────────────────────────────────────────────

// Always offered on an editable WO. It used to vanish whenever the customer had no
// (non-rejected) proposals on file, which read as the button having gone missing —
// now the picker can also upload a new proposal/estimate straight from here: it
// lands on the customer's Proposals tab (tagged with the WO's office) and is
// attached to this WO in one go.
function AddProposalPicker({ woId, customerId, locationId, proposals = [], onChanged }) {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => { setOpen(false); setError(''); };

  const attach = async (proposalFileId) => {
    const { data } = await workOrdersApi.woProposals.create(woId, { proposal_file_id: proposalFileId });
    onChanged(data);
    close();
  };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); }
    catch (err) { setError(err.response?.data?.error ?? 'Could not add the proposal.'); }
    finally { setBusy(false); }
  };

  const uploadNew = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'proposal');
    if (locationId) fd.append('location_id', locationId);
    const { data: uploaded } = await customersApi.files.upload(customerId, fd);
    qc.invalidateQueries({ queryKey: ['customers', customerId, 'files', 'proposal'] });
    await attach(uploaded.id);
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-sm flex items-center gap-1.5">
        <Plus size={14} /> Add Proposal / Estimate
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {proposals.length > 0 ? (
        <select
          className="input text-sm flex-1 min-w-48"
          autoFocus
          defaultValue=""
          disabled={busy}
          onChange={e => { const val = e.target.value; if (val) run(() => attach(val)); }}
        >
          <option value="" disabled>— Select a proposal on file —</option>
          {proposals.map(p => <option key={p.id} value={p.id}>{p.original_name}</option>)}
        </select>
      ) : (
        <span className="text-gray-500 text-sm">No proposals on file for this customer.</span>
      )}
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
        className="btn-secondary text-sm flex items-center gap-1.5">
        <Upload size={14} /> {busy ? 'Adding…' : 'Upload new'}
      </button>
      <input ref={fileRef} type="file" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadNew(f); }} />
      <button type="button" onClick={close} className="text-gray-500 hover:text-gray-300" title="Cancel">
        <X size={14} />
      </button>
      {error && <span className="text-red-400 text-xs w-full">{error}</span>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WorkOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromBilling = searchParams.get('from') === 'billing';
  const qc = useQueryClient();

  const { data: wo, isLoading, refetch } = useQuery({
    queryKey: ['work-orders', id],
    queryFn: () => workOrdersApi.get(id).then(r => r.data),
  });

  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [viewingProposal, setViewingProposal] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data.filter(u => u.is_active)));
  }, []);

  // Push a server response (full WO) straight into the cache — no flicker.
  const applyWO = (data) => qc.setQueryData(['work-orders', id], data);

  const setDefaultRate = async (rateId) => { const { data } = await workOrdersApi.update(id, { billing_rate_id: rateId || null }); applyWO(data); };
  const setWoDate = async (d) => { const { data } = await workOrdersApi.update(id, { work_date: d || null }); applyWO(data); };
  const setLocation = async (locId) => { const { data } = await workOrdersApi.update(id, { location_id: locId || null }); applyWO(data); };

  const addSection = async () => { const { data } = await workOrdersApi.sections.add(id); applyWO(data); };
  const removeSection = async (sectionId) => {
    if (!confirm('Remove this work section?')) return;
    try { const { data } = await workOrdersApi.sections.remove(id, sectionId); applyWO(data); }
    catch (err) { setError(err.response?.data?.error ?? 'Could not remove section.'); }
  };

  const submitWO = async () => {
    try { await workOrdersApi.submit(id); refetch(); qc.invalidateQueries(['work-orders']); }
    catch (err) { setError(err.response?.data?.error ?? 'Submit failed.'); }
  };
  const invoiceWO = async () => { await workOrdersApi.invoice(id); refetch(); qc.invalidateQueries(['work-orders']); };
  const payWO     = async () => { await workOrdersApi.pay(id);     refetch(); qc.invalidateQueries(['work-orders']); };

  // Un-void puts the WO back in the Billing Queue. If the void handed its parts back
  // to inventory, the server takes exactly those quantities out again — so warn first.
  const unvoidWO = async () => {
    const stockNote = wo.inventory_returned
      ? "\n\nIts parts were returned to inventory when it was voided; un-voiding will take that same stock back out."
      : '';
    if (!confirm(`Un-void ${woNum(wo.number)} and move it back to Pending Billing?${stockNote}`)) return;
    try {
      const { data } = await workOrdersApi.unvoid(id);
      applyWO(data);
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      if (data?.inventory_warning) {
        alert(`Work order un-voided, but shared inventory could not be updated:\n\n${data.inventory_warning}`);
      }
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not un-void this work order.');
    }
  };
  const togglePrinted = async (e) => {
    const next = e.target.checked;
    try { await workOrdersApi.setPrintedSubmitted(id, next); refetch(); qc.invalidateQueries(['work-orders']); }
    catch (err) { setError(err.response?.data?.error ?? 'Could not update printed & submitted.'); }
  };
  const deleteWO = async () => {
    if (!confirm(`Permanently delete ${woNum(wo.number)}? This removes the work order and all its sections, parts, and services. This cannot be undone.`)) return;
    try {
      await workOrdersApi.remove(id);
      // Drop it from the cached detail + every list variant so the Work Orders tab
      // shows it gone the moment we land back there (no stale cache).
      qc.removeQueries({ queryKey: ['work-orders', id] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      navigate('/work-orders');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete this work order.');
    }
  };

  const handlePrint = async () => {
    const woProposals = wo.wo_proposals ?? [];
    if (!woProposals.length) { printWorkOrder(wo); return; }
    setPrintLoading(true);
    try {
      const { images, failures } = await loadProposalImages(wo);
      // A proposal that can't be rendered used to be dropped with only a console
      // warning — the printout still listed it under "Proposals" but the document
      // itself was missing, and nobody found out until the customer did. Say so and
      // let the user decide.
      if (failures.length && !confirm(`${missingProposalsMessage(failures)}\n\nPrint anyway?`)) return;
      printWorkOrder(wo, images);
    } finally {
      setPrintLoading(false);
    }
  };

  if (isLoading || !wo) {
    return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>;
  }

  const isDraft = wo.status === 'draft';
  // Editable when draft or pending_billing — UNLESS opened from the Billing Queue
  // (which is intentionally read-only). Invoiced/paid are always locked.
  const editable = ['draft', 'pending_billing'].includes(wo.status) && !fromBilling;
  const readonly = !editable;
  const rates = wo.billing_rates ?? [];
  const sections = wo.sections ?? [];
  const locations = wo.locations ?? [];
  const locationName = wo.location_label || wo.location_business_name || wo.location_address || null;

  return (
    <div className="flex flex-col lg:h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 border-b border-surface-700 bg-surface-800/50">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 mb-2">
          <Link to="/work-orders" className="hover:text-gray-400">Work Orders</Link>
          <ChevronRight size={12} />
          <Link to={`/customers/${wo.customer_id}`} className="hover:text-gray-400">{wo.customer_name}</Link>
          <ChevronRight size={12} />
          <span className="text-gray-400">{woNum(wo.number)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-100">{woNum(wo.number)}</h1>
            <span className={`badge ${STATUS_BADGE[wo.status]}`}>{STATUS_LABEL[wo.status]}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {error && <span className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={12} />{error}</span>}
            <button onClick={handlePrint} disabled={printLoading} className="btn-secondary text-sm flex items-center gap-1.5" title="Print a customer copy (no internal notes)">
              <Printer size={14} /> {printLoading ? 'Preparing…' : 'Print'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 select-none cursor-pointer px-2 py-1 rounded-sm hover:bg-surface-700"
              title="Track that this work order's invoice has been printed and submitted">
              <input type="checkbox" checked={!!wo.printed_submitted} onChange={togglePrinted}
                className="h-4 w-4 accent-brand cursor-pointer" />
              Printed &amp; Submitted
            </label>
            {isDraft && (
              <>
                <button onClick={deleteWO} className="btn-ghost text-xs text-gray-600 hover:text-red-400 flex items-center gap-1"><Trash2 size={13} /></button>
                <button onClick={submitWO} className="btn-primary text-sm flex items-center gap-1.5"><Send size={14} /> Submit to Billing</button>
              </>
            )}
            {wo.status === 'pending_billing' && (
              <button onClick={() => setShowVoid(true)}
                title="Cancel this work order — removes it from the Billing Queue but keeps the record"
                className="px-3 py-1.5 rounded-sm text-sm font-medium bg-red-900/40 text-red-300 hover:bg-red-800/60 transition-colors flex items-center gap-1.5">
                <Ban size={14} /> Void
              </button>
            )}
            {wo.status === 'voided' && (
              <button onClick={unvoidWO} className="btn-secondary text-sm flex items-center gap-1.5">
                <Undo2 size={14} /> Un-void
              </button>
            )}
            {wo.status === 'pending_billing' && !fromBilling && <button onClick={invoiceWO} className="btn-primary text-sm">Mark Invoiced</button>}
            {wo.status === 'invoiced' && <button onClick={payWO} className="btn-primary text-sm">Mark Paid</button>}
          </div>
        </div>
        {editable && <p className="text-gray-600 text-xs mt-2">Changes save automatically.</p>}
        {fromBilling && wo.status === 'pending_billing' && <p className="text-gray-600 text-xs mt-2">Read-only from Billing Queue. Open from Work Orders or the customer to edit.</p>}
        {wo.status === 'voided' && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-900/20 px-3 py-2 flex items-start gap-2">
            <Ban size={14} className="text-red-400 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="text-red-300 font-medium">
                Voided{wo.voided_at ? ` on ${formatDate(wo.voided_at)}` : ''} — not billable, and out of the Billing Queue.
              </p>
              {wo.void_reason && <p className="text-gray-400 mt-0.5">Reason: {wo.void_reason}</p>}
              <p className="text-gray-500 mt-0.5">
                {wo.inventory_returned
                  ? 'Its parts were returned to shared inventory.'
                  : 'Inventory was left as-is — its parts stay consumed.'}
                {' '}The record is read-only; use Un-void to put it back in Pending Billing.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 lg:overflow-y-auto p-4 sm:p-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* WO-level info */}
          <div className="card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Customer</p>
              <Link to={`/customers/${wo.customer_id}`} className="text-accent hover:underline font-medium">{wo.customer_name}</Link>
            </div>
            {(locations.length > 0 || locationName) && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Branch / Location</label>
                {editable ? (
                  <select className="input text-sm" value={wo.location_id ?? ''} onChange={e => setLocation(e.target.value)}>
                    <option value="">Main office</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>{l.label || l.business_name || l.address || 'Branch'}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-gray-300 text-sm">{locationName ?? 'Main office'}</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Opened</label>
              <input className="input text-sm" type="date" defaultValue={toDateInput(wo.work_date)}
                onBlur={e => setWoDate(e.target.value)} disabled={readonly} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Default Billing Rate</label>
              {editable ? (
                <select className="input text-sm" value={wo.billing_rate_id ?? ''} onChange={e => setDefaultRate(e.target.value)}>
                  <option value="">— Select rate —</option>
                  {rates.map(r => <option key={r.id} value={r.id}>{r.label} (${parseFloat(r.rate).toFixed(2)}/hr)</option>)}
                </select>
              ) : (
                <p className="text-gray-300 text-sm">{wo.billing_rate_label ? `${wo.billing_rate_label} — $${parseFloat(wo.billing_rate_value || 0).toFixed(2)}/hr` : '—'}</p>
              )}
            </div>
          </div>

          {/* Sections */}
          {sections.map((s, i) => (
            <SectionCard
              key={s.id}
              wo={wo}
              section={s}
              index={i}
              users={users}
              rates={rates}
              readonly={readonly}
              canRemove={sections.length > 1}
              onChanged={applyWO}
              onRemove={() => removeSection(s.id)}
            />
          ))}

          {editable && (
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={addSection} className="btn-secondary text-sm flex items-center gap-1.5">
                <Plus size={14} /> Add Work Section
              </button>
              <AddProposalPicker woId={id} customerId={wo.customer_id} locationId={wo.location_id}
                proposals={wo.proposals ?? []} onChanged={applyWO} />
            </div>
          )}

          {/* WO-level proposals */}
          {(wo.wo_proposals ?? []).length > 0 && (
            <div className="space-y-2">
              {(wo.wo_proposals ?? []).map(p => (
                <WoProposalRow
                  key={p.id}
                  woId={id}
                  woProp={p}
                  customerId={wo.customer_id}
                  readonly={readonly}
                  onChanged={applyWO}
                  onView={() => setViewingProposal({
                    id: p.proposal_file_id,
                    original_name: p.proposal_name || 'Proposal',
                    mime_type: p.proposal_mime_type || 'application/pdf',
                  })}
                />
              ))}
            </div>
          )}

          {/* Grand total */}
          {(() => {
            const proposalsTotal = (wo.wo_proposals ?? []).reduce((sum, p) => sum + (p.price_excl_tax != null ? parseFloat(p.price_excl_tax) : 0), 0);
            const grandTotal = (wo.grand_total || 0) + proposalsTotal;
            return (grandTotal > 0 || (wo.recurring_services?.length ?? 0) > 0) && (
            <div className="card p-5 flex justify-end">
              <div className="space-y-1 text-sm min-w-[260px]">
                {wo.labor_total > 0 && <div className="flex justify-between gap-8"><span className="text-gray-500">Labor (all sections)</span><span className="text-gray-300">{money(wo.labor_total)}</span></div>}
                {wo.hardware_total > 0 && <div className="flex justify-between gap-8"><span className="text-gray-500">Parts (all sections)</span><span className="text-gray-300">{money(wo.hardware_total)}</span></div>}
                {wo.services_onetime_total > 0 && <div className="flex justify-between gap-8"><span className="text-gray-500">Services (one-time)</span><span className="text-gray-300">{money(wo.services_onetime_total)}</span></div>}
                {proposalsTotal > 0 && <div className="flex justify-between gap-8"><span className="text-gray-500">Proposals / Estimates</span><span className="text-gray-300">{money(proposalsTotal)}</span></div>}
                <div className="flex justify-between gap-8 pt-1 border-t border-surface-600 font-semibold">
                  <span className="text-gray-300">Total (billed now)</span><span className="text-accent">{money(grandTotal)}</span>
                </div>
                {wo.recurring_services?.length > 0 && (
                  <div className="pt-2 mt-1 border-t border-surface-700">
                    <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Recurring charges</p>
                    {wo.recurring_services.map((sv) => (
                      <div key={sv.id} className="flex justify-between gap-8 text-xs">
                        <span className="text-gray-500">{sv.quantity > 1 ? `×${sv.quantity} ` : ''}{sv.description}</span>
                        <span className="text-gray-400">{money(sv.unit_price)}{recurSuffix(sv)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })()}

        </div>
      </div>

      {viewingProposal && (
        <FileViewer
          customerId={wo.customer_id}
          file={viewingProposal}
          onClose={() => setViewingProposal(null)}
        />
      )}

      {showVoid && (
        <VoidWorkOrderModal
          wo={wo}
          open
          onClose={() => setShowVoid(false)}
          onVoided={(data) => { applyWO(data); qc.invalidateQueries({ queryKey: ['work-orders'] }); }}
        />
      )}
    </div>
  );
}
