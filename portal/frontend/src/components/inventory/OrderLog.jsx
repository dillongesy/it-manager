import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Paperclip, X, Download, Eye, Upload, Search, Package2, ChevronDown, ClipboardList,
  PackageCheck, PackagePlus,
} from 'lucide-react';
import { orderLogApi } from '../../api/orderLog.js';
import { InventoryPicker } from './InventoryPicker.jsx';
import { customersApi } from '../../api/customers.js';
import { tasksApi } from '../../api/tasks.js';
import { taskNumber } from '../../utils/tasks.js';
import api from '../../api/client.js';
import { Modal } from '../ui/Modal.jsx';
import { SuggestInput } from '../ui/SuggestInput.jsx';
import { CustomerPicker } from '../ui/CustomerPicker.jsx';
import { FileViewer } from '../ui/FileViewer.jsx';
import { formatDate, toDateInput } from '../../utils/date.js';

// ─── Constants & helpers ──────────────────────────────────────────────────────

const STATUS_META = {
  placed:      { label: 'Placed',      cls: 'bg-blue-900/40 text-blue-300',   dot: 'bg-blue-400'   },
  pending:     { label: 'Pending',     cls: 'bg-amber-900/40 text-amber-400', dot: 'bg-amber-400'  },
  backordered: { label: 'Backordered', cls: 'bg-red-900/40 text-red-400',     dot: 'bg-red-400'    },
  complete:    { label: 'Complete',    cls: 'bg-green-900/30 text-green-400', dot: 'bg-green-400'  },
};
const STATUSES = Object.keys(STATUS_META);

const fmt = (v) => v != null ? `$${parseFloat(v).toFixed(2)}` : null;
const fmtDate = (d) => d ? formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
};

const orderTotal = (items) =>
  (items ?? []).reduce((s, i) => s + (parseFloat(i.total_cost) || 0), 0);

const fetchCustomerNames = async (q) => {
  const { data } = await customersApi.list({ search: q });
  return { data: data.map(c => c.name) };
};

// ─── Clickable status badge (order-level and per-item) ───────────────────────

function StatusBadge({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const meta = STATUS_META[value] ?? STATUS_META.placed;
  return (
    <div className="relative inline-block shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`text-xs px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 ${meta.cls}`}>
        {meta.label}<ChevronDown size={9} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-surface-800 border border-surface-600 rounded-lg shadow-xl overflow-hidden min-w-[140px]">
          {STATUSES.map(s => (
            <button key={s} type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-700 transition-colors flex items-center gap-2 ${s === value ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_META[s].dot}`} />
              <span className={STATUS_META[s].cls.split(' ').find(c => c.startsWith('text-'))}>
                {STATUS_META[s].label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Multi-item row management ────────────────────────────────────────────────

// Desktop: one row per line. Phone: each line wraps into a small card (name, SKU, then
// qty / price / total side by side) — six columns in 350px made every field a sliver.
const ITEM_COLS = 'grid-cols-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_6.5rem_6.5rem_1.75rem]';

// Inventory receipt state carried on each line (migration 055). The server keeps it
// only if the client sends it back, so an edit must round-trip it untouched —
// dropping `added_at` would let the line be received into inventory a second time.
const INVENTORY_KEYS = ['inventory_item_id', 'inventory_sku', 'inventory_name', 'added_qty', 'added_at'];
const pickInventoryKeys = (it) =>
  Object.fromEntries(INVENTORY_KEYS.filter(k => it?.[k] != null && it[k] !== '').map(k => [k, it[k]]));

const blankItem = () => ({
  _id: Math.random(), item_name: '', sku: '', quantity: '1', unit_cost: '', total_cost: '', inv: {},
});

function itemsFromOrder(order) {
  if (!order?.items?.length) return [blankItem()];
  return order.items.map(it => ({
    _id: Math.random(),
    item_name: it.item_name ?? '',
    sku:       it.sku       ?? '',
    quantity:  it.quantity  != null ? String(it.quantity)  : '1',
    unit_cost: it.unit_cost != null ? String(it.unit_cost) : '',
    total_cost:it.total_cost!= null ? String(it.total_cost): '',
    status:    it.status    ?? '',
    inv:       pickInventoryKeys(it),
  }));
}

// ─── Order form (create / edit) ───────────────────────────────────────────────

const blankForm = () => ({
  status: 'placed', order_date: '', vendor: '', po_number: '', ordered_by: '',
  for_stock: false, customer_name: '', purpose: '',
  expected_date: '', received_date: '', notes: '',
  is_inventory_order: false,
});

function fromOrder(o) {
  return {
    status:        o.status        ?? 'placed',
    order_date:    toDateInput(o.order_date),
    vendor:        o.vendor        ?? '',
    po_number:     o.po_number     ?? '',
    ordered_by:    o.ordered_by    ?? '',
    for_stock:     !!o.for_stock,
    customer_name: o.customer_name ?? '',
    purpose:       o.purpose       ?? '',
    expected_date: toDateInput(o.expected_date),
    received_date: toDateInput(o.received_date),
    notes:         o.notes         ?? '',
    is_inventory_order: !!o.is_inventory_order,
  };
}

function OrderForm({ order, onClose, onSaved }) {
  const qc = useQueryClient();
  const [form, setForm]           = useState(order ? fromOrder(order) : blankForm());
  const [items, setItems]         = useState(itemsFromOrder(order));
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => api.get('/users').then(r => r.data.filter(u => u.is_active)),
    staleTime: 60_000,
  });
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [followup, setFollowup]   = useState(blankFollowup);   // optional follow-up (new orders)
  const fileInputRef = useRef(null);

  // Order-shaped object for the follow-up summary/preview, from the in-progress form.
  const followupOrder = {
    vendor: form.vendor, po_number: form.po_number, purpose: form.purpose,
    status: form.status, expected_date: form.expected_date,
    for_stock: form.for_stock, customer_name: form.customer_name,
    items: items.filter(it => it.item_name.trim())
      .map(it => ({ item_name: it.item_name, sku: it.sku, quantity: it.quantity })),
  };

  // Scalar field setter (event-based).
  const set = k => e => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({
      ...f, [k]: val,
      // Buying for stock is almost always restocking inventory — tick it along with
      // "For stock" (it can still be unticked on its own).
      ...(k === 'for_stock' && val ? { is_inventory_order: true } : {}),
    }));
  };
  // Plain-value setter for SuggestInput.
  const setField = k => val => setForm(f => ({ ...f, [k]: val }));

  // Item line management.
  const updateItem = (_id, field, val) => setItems(prev => prev.map(item => {
    if (item._id !== _id) return item;
    const next = { ...item, [field]: val };
    if ((field === 'quantity' || field === 'unit_cost') && next.unit_cost !== '') {
      const qty = parseFloat(next.quantity) || 0;
      const up  = parseFloat(next.unit_cost) || 0;
      if (qty && up) next.total_cost = String((qty * up).toFixed(2));
    }
    return next;
  }));
  const addItem    = () => setItems(prev => [...prev, blankItem()]);
  const removeItem = (_id) => setItems(prev => prev.filter(i => i._id !== _id));

  // File picking.
  const addFiles = (fileList) => {
    if (!fileList?.length) return;
    setPendingFiles(prev => [...prev, ...Array.from(fileList)]);
  };
  const removeFile = (idx) => setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); };

  const submit = async (e) => {
    e.preventDefault();
    // Validate the optional follow-up up-front so we don't save the order then fail.
    if (!order && followup.enabled) {
      const problem = validateFollowup(followup);
      if (problem) { setError(problem); return; }
    }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        ordered_by: form.ordered_by || null,
        customer_name: form.for_stock ? null : (form.customer_name || null),
        items: items
          .filter(it => it.item_name.trim())
          .map(it => ({
            item_name:  it.item_name.trim(),
            sku:        it.sku       || null,
            quantity:   parseFloat(it.quantity)   || 1,
            unit_cost:  it.unit_cost  !== '' ? parseFloat(it.unit_cost)  : null,
            total_cost: it.total_cost !== '' ? parseFloat(it.total_cost) : null,
            ...(it.status ? { status: it.status } : {}),
            ...it.inv,
          })),
      };

      let orderId;
      if (order) {
        await orderLogApi.update(order.id, payload);
        orderId = order.id;
      } else {
        const { data } = await orderLogApi.create(payload);
        orderId = data.id;
      }

      // Upload pending files against the (possibly new) order ID.
      for (const file of pendingFiles) {
        const fd = new FormData();
        fd.append('file', file);
        await orderLogApi.attachments.upload(orderId, fd);
      }

      // Optional follow-up (new orders only). Best-effort: the order is already saved,
      // so a follow-up failure warns but doesn't block.
      if (!order && followup.enabled) {
        try { await runFollowup(followup, payload, qc); }
        catch (fe) { alert('Order saved, but the follow-up could not be created: ' + (fe.response?.data?.error ?? fe.message)); }
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save order.');
    } finally { setSaving(false); }
  };

  const total = items.reduce((s, it) => s + (parseFloat(it.total_cost) || 0), 0);

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      {/* Status + Order Date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
          <select className="input" value={form.status} onChange={set('status')}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Order Date</label>
          <input className="input" type="date" value={form.order_date} onChange={set('order_date')} />
        </div>
      </div>

      {/* Vendor + PO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Vendor *</label>
          <SuggestInput value={form.vendor} onChange={setField('vendor')}
            fetch={q => orderLogApi.suggestions('vendor', q)}
            placeholder="e.g. Ingram Micro, CDW" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">PO Number</label>
          <input className="input" value={form.po_number} onChange={set('po_number')}
            placeholder="e.g. PO-2024-001" autoComplete="off" />
        </div>
      </div>

      {/* Ordered by */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Ordered by</label>
        <select className="input" value={form.ordered_by} onChange={set('ordered_by')}>
          <option value="">— Not specified —</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      </div>

      {/* ── Line items ── */}
      <div className="border-t border-surface-600 pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Items</p>

        {/* Column headers (desktop only — on a phone each field carries its own label) */}
        <div className={`hidden sm:grid ${ITEM_COLS} gap-2 mb-1 px-0.5`}>
          <span className="text-xs text-gray-600">Item</span>
          <span className="text-xs text-gray-600">SKU / Part #</span>
          <span className="text-xs text-gray-600">Qty</span>
          <span className="text-xs text-gray-600">Unit Price</span>
          <span className="text-xs text-gray-600">Total</span>
          <span />
        </div>

        <div className="space-y-2 sm:space-y-1.5">
          {items.map(item => (
            <div key={item._id}
              className="max-sm:border max-sm:border-surface-600 max-sm:rounded-lg max-sm:p-2.5 max-sm:bg-surface-700/30">
              <div className={`grid ${ITEM_COLS} gap-2 items-center`}>
                <div className="col-span-3 sm:col-span-1">
                  <SuggestInput value={item.item_name}
                    onChange={val => updateItem(item._id, 'item_name', val)}
                    fetch={q => orderLogApi.suggestions('item_name', q)}
                    placeholder="Item name" className="input text-sm" />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <SuggestInput value={item.sku}
                    onChange={val => updateItem(item._id, 'sku', val)}
                    fetch={q => orderLogApi.suggestions('sku', q)}
                    placeholder="SKU / Part #" className="input text-sm" />
                </div>
                <label className="block">
                  <span className="sm:hidden block text-xs text-gray-500 mb-0.5">Qty</span>
                  <input className="input text-sm" type="number" min="0.01" step="any" inputMode="decimal"
                    value={item.quantity} placeholder="1"
                    onChange={e => updateItem(item._id, 'quantity', e.target.value)}
                    onWheel={e => e.currentTarget.blur()} />
                </label>
                <label className="block">
                  <span className="sm:hidden block text-xs text-gray-500 mb-0.5">Unit price</span>
                  <input className="input text-sm" type="number" min="0" step="0.01" inputMode="decimal"
                    value={item.unit_cost} placeholder="0.00"
                    onChange={e => updateItem(item._id, 'unit_cost', e.target.value)}
                    onWheel={e => e.currentTarget.blur()} />
                </label>
                <label className="block">
                  <span className="sm:hidden block text-xs text-gray-500 mb-0.5">Total</span>
                  <input className="input text-sm" type="number" min="0" step="0.01" inputMode="decimal"
                    value={item.total_cost} placeholder="auto"
                    onChange={e => updateItem(item._id, 'total_cost', e.target.value)}
                    onWheel={e => e.currentTarget.blur()} />
                </label>
                <button type="button" onClick={() => removeItem(item._id)} title="Remove line"
                  className="btn-ghost p-1 text-gray-600 hover:text-red-400 col-span-3 sm:col-span-1 justify-self-end sm:justify-self-center flex items-center gap-1 text-xs">
                  <X size={14} /><span className="sm:hidden">Remove line</span>
                </button>
              </div>
              {item.inv.added_at && (
                <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                  <PackageCheck size={12} /> Received into inventory: {item.inv.added_qty} × {item.inv.inventory_name}
                  {item.inv.inventory_sku ? ` (${item.inv.inventory_sku})` : ''} — editing this line won't receive it again.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-2">
          <button type="button" onClick={addItem}
            className="btn-ghost text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-300">
            <Plus size={12} /> Add Item
          </button>
          {total > 0 && (
            <span className="text-xs text-gray-500">
              Order total: <span className="text-gray-200 font-medium">{fmt(total)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Destination */}
      <div className="border-t border-surface-600 pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Destination</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.for_stock} onChange={set('for_stock')} />
            <span className="text-sm text-gray-300">For stock</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.is_inventory_order} onChange={set('is_inventory_order')} />
            <span className="text-sm text-gray-300">Inventory order <span className="text-gray-600">(restocks shared inventory)</span></span>
          </label>
        </div>
        {!form.for_stock && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Customer Name</label>
            <SuggestInput value={form.customer_name} onChange={setField('customer_name')}
              fetch={fetchCustomerNames} placeholder="Which customer is this for?" />
          </div>
        )}
      </div>

      {/* Purpose + Dates */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">What it's for / Purpose</label>
        <SuggestInput value={form.purpose} onChange={setField('purpose')}
          fetch={q => orderLogApi.suggestions('purpose', q)}
          placeholder="e.g. Workstation replacement, camera upgrade, shelf stock" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Expected Delivery</label>
          <input className="input" type="date" value={form.expected_date} onChange={set('expected_date')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Received Date</label>
          <input className="input" type="date" value={form.received_date} onChange={set('received_date')} />
        </div>
      </div>

      {/* ── Attachments ── */}
      <div className="border-t border-surface-600 pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Attachments <span className="text-gray-600 font-normal normal-case">(POs, invoices, quotes)</span>
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-surface-600 hover:border-surface-500 rounded-lg p-4 text-center cursor-pointer transition-colors"
        >
          <Upload size={16} className="mx-auto mb-1 text-gray-600" />
          <p className="text-xs text-gray-600">
            Drop files here or <span className="text-accent">browse</span>
          </p>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {/* Pending file chips */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {pendingFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 bg-surface-700 rounded-sm px-2 py-1 text-xs text-gray-300">
                <Paperclip size={10} className="text-gray-500" />
                {f.name}
                <button type="button" onClick={() => removeFile(i)}
                  className="text-gray-600 hover:text-red-400 ml-0.5"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        {order && (
          <p className="text-xs text-gray-600 mt-1.5">
            Existing attachments are managed from the order card.
          </p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')}
          placeholder="Tracking number, special instructions, follow-up notes…" />
      </div>

      {/* Optional follow-up — new orders only (edit an existing order from its card). */}
      {!order && (
        <div className="border-t border-surface-600 pt-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={followup.enabled}
              onChange={e => setFollowup(f => ({
                ...f,
                enabled: e.target.checked,
                customerName: e.target.checked && !form.for_stock ? (form.customer_name || '') : f.customerName,
              }))} />
            <span className="text-sm text-gray-300">Create a follow-up task (or add to an existing one)</span>
          </label>
          {followup.enabled && (
            <div className="mt-3 rounded-lg bg-surface-800/40 border border-surface-600 p-3">
              <FollowupFields value={followup} onChange={setFollowup} order={followupOrder} />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.vendor.trim()} className="btn-primary">
          {saving ? 'Saving…' : order ? 'Update Order' : 'Add Order'}
        </button>
      </div>
    </form>
  );
}

// ─── Attachments section (always visible on card) ────────────────────────────

function AttachmentsSection({ orderId }) {
  const qc = useQueryClient();
  const { data: attachments = [], refetch } = useQuery({
    queryKey: ['order-log', orderId, 'attachments'],
    queryFn: async () => { const { data } = await orderLogApi.attachments.list(orderId); return data; },
  });
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing]     = useState(null);
  const fileRef = useRef(null);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        await orderLogApi.attachments.upload(orderId, fd);
      }
      refetch();
      qc.invalidateQueries(['order-log']);
    } finally { setUploading(false); }
  };

  const handleDownload = async (att) => {
    const { data: blob } = await orderLogApi.attachments.download(orderId, att.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.original_name; a.click();
    URL.revokeObjectURL(url);
  };

  const removeAtt = async (att) => {
    if (!confirm(`Remove "${att.original_name}"?`)) return;
    await orderLogApi.attachments.remove(orderId, att.id);
    refetch();
    qc.invalidateQueries(['order-log']);
  };

  const viewable = (mime) => mime?.startsWith('image/') || mime === 'application/pdf';

  return (
    <div className="mt-3 pt-3 border-t border-surface-600">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Paperclip size={11} /> Attachments
        </p>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="btn-ghost py-0.5 px-2 text-xs flex items-center gap-1 text-gray-500 hover:text-gray-300">
          <Upload size={11} /> {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-gray-600 italic">No attachments yet.</p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 group">
              {viewable(att.mime_type) ? (
                <button onClick={() => setViewing(att)} title="View"
                  className="btn-ghost p-1 shrink-0 text-accent hover:text-yellow-300">
                  <Eye size={13} />
                </button>
              ) : (
                <span className="w-[22px] shrink-0" />
              )}
              <span className="flex-1 text-xs text-gray-300 truncate cursor-pointer hover:text-gray-100"
                title={att.original_name}
                onClick={() => viewable(att.mime_type) && setViewing(att)}>
                {att.original_name}
              </span>
              <span className="text-xs text-gray-600 shrink-0">{fmtSize(att.size_bytes)}</span>
              <button onClick={() => handleDownload(att)} title="Download"
                className="btn-ghost p-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-200">
                <Download size={12} />
              </button>
              <button onClick={() => removeAtt(att)} title="Remove"
                className="btn-ghost p-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <FileViewer
          file={viewing}
          onClose={() => setViewing(null)}
          fetchFn={(f) => orderLogApi.attachments.view(orderId, f.id)}
          downloadFn={(f) => orderLogApi.attachments.download(orderId, f.id)}
        />
      )}
    </div>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

// ─── Follow-up (a task from an order) ─────────────────────────────────────────

const escapeHtml = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// A one-line title + rich-HTML details built from an order, used as a task's title and
// details (or appended to an existing task's details).
function orderSummary(order) {
  const items = order.items ?? [];
  const head = `Order: ${order.vendor}${order.po_number ? ` (PO ${order.po_number})` : ''}`;
  const lines = items.map(it => {
    const bits = [`${it.quantity ?? 1}× ${it.item_name}`];
    if (it.sku) bits.push(it.sku);
    return bits.join(' · ');
  });
  if (order.purpose) lines.push(`For: ${order.purpose}`);
  const meta = [`Status: ${STATUS_META[order.status]?.label ?? order.status}`];
  if (order.expected_date) meta.push(`Expected ${fmtDate(order.expected_date)}`);
  return { head, lines, metaLine: meta.join(' · ') };
}

function orderSummaryHtml(order) {
  const { head, lines, metaLine } = orderSummary(order);
  const parts = [`<p><strong>${escapeHtml(head)}</strong></p>`];
  if (lines.length) parts.push('<ul>' + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>');
  parts.push(`<p>${escapeHtml(metaLine)}</p>`);
  return parts.join('');
}

// ── Follow-up state + actions (shared by the modal and the New Order form) ──

const blankFollowup = () => ({
  enabled: false,          // used by the New Order form; the modal treats it as always on
  mode: 'new',             // 'new' | 'existing'
  customerId: '',          // blank = internal task
  customerName: '',
  targetId: '',            // chosen existing task
  title: '',               // new task title (defaults to the order summary head)
  assignedTo: '',
  extra: '',
});

function validateFollowup(s) {
  if (s.mode === 'existing' && !s.targetId) return 'Choose the task to add the order to.';
  return null;
}

// Create a new task, or append the order summary to an existing one's details.
// Returns { label, to } for a success message + "view it" link.
async function runFollowup(s, order, qc) {
  const block = orderSummaryHtml(order) + (s.extra.trim() ? `<p>${escapeHtml(s.extra.trim())}</p>` : '');
  let id = s.targetId;
  if (s.mode === 'existing') {
    const { data: task } = await tasksApi.get(s.targetId);
    await tasksApi.update(s.targetId, { notes: task.notes ? `${task.notes}<hr/>${block}` : block });
  } else {
    const { data } = await tasksApi.create({
      title: s.title.trim() || orderSummary(order).head,
      notes: block,
      customer_id: s.customerId || null,
      assigned_to: s.assignedTo || null,
    });
    id = data.id;
  }
  qc.invalidateQueries({ queryKey: ['tasks'] });
  return { label: s.mode === 'existing' ? 'Added to the task.' : 'Task created.', to: `/tasks?task=${id}` };
}

// Reusable follow-up form fragment. `value` is a blankFollowup()-shaped object.
function FollowupFields({ value: v, onChange, order }) {
  const patch = (u) => onChange({ ...v, ...u });
  const [techUsers, setTechUsers] = useState([]);
  useEffect(() => {
    api.get('/users')
      .then(r => setTechUsers(r.data.filter(u => u.is_active && u.role !== 'biller')))
      .catch(() => setTechUsers([]));
  }, []);

  // That customer's open tasks (or the internal ones), only when attaching.
  const existingQuery = useQuery({
    queryKey: ['tasks', 'followup-existing', v.customerId || 'internal'],
    enabled: v.mode === 'existing',
    queryFn: async () => {
      const { data } = await tasksApi.list({ customerId: v.customerId || 'internal', status: 'active', sort: 'priority' });
      return data.map(t => ({ id: t.id, label: `${taskNumber(t.number)} · ${t.title}` }));
    },
  });
  const existing = existingQuery.data ?? [];

  return (
    <div className="space-y-3">
      {/* Customer */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Customer <span className="text-gray-600 font-normal">(blank = internal task)</span></label>
        <CustomerPicker value={v.customerId} initialName={v.customerName}
          onChange={(id, name) => patch({ customerId: id, customerName: name || '', targetId: '' })} />
      </div>

      {/* New vs existing */}
      <div className="flex gap-2">
        {[['new', 'New task'], ['existing', 'Add to an existing task']].map(([val, label]) => (
          <button key={val} type="button" onClick={() => patch({ mode: val, targetId: '' })}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              v.mode === val ? 'border-accent/70 bg-accent/10 text-gray-100' : 'border-surface-600 text-gray-400 hover:text-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {v.mode === 'existing' ? (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Task *</label>
          {existingQuery.isLoading ? (
            <p className="text-xs text-gray-600">Loading…</p>
          ) : existing.length === 0 ? (
            <p className="text-xs text-gray-600">No open tasks {v.customerId ? 'for this customer' : 'without a customer'} — use “New task”.</p>
          ) : (
            <select className="input" value={v.targetId} onChange={e => patch({ targetId: e.target.value })}>
              <option value="">Select a task…</option>
              {existing.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
          <p className="text-xs text-gray-600 mt-1">The order details are added to the task's details.</p>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Title</label>
            <input className="input" value={v.title} onChange={e => patch({ title: e.target.value })}
              placeholder={orderSummary(order).head} autoComplete="off" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Assign to <span className="text-gray-600 font-normal">(optional)</span></label>
            <select className="input" value={v.assignedTo} onChange={e => patch({ assignedTo: e.target.value })}>
              <option value="">Unassigned</option>
              {techUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Extra notes <span className="text-gray-600 font-normal">(optional)</span></label>
        <textarea className="input resize-none" rows={2} value={v.extra} onChange={e => patch({ extra: e.target.value })}
          placeholder="Anything to add beyond the order details…" />
      </div>

      <div className="rounded-lg border border-surface-600 bg-surface-800/50 p-3">
        <p className="text-xs text-gray-600 mb-1">Order details attached automatically:</p>
        <div className="text-xs text-gray-300 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-0.5"
          dangerouslySetInnerHTML={{ __html: orderSummaryHtml(order) }} />
      </div>
    </div>
  );
}

// Standalone modal launched from an order card.
function OrderFollowupModal({ order, onClose }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState(() => ({
    ...blankFollowup(),
    customerName: order.for_stock ? '' : (order.customer_name || ''),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateFollowup(state);
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try {
      setDone(await runFollowup(state, order, qc));
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create the follow-up.');
    } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-green-400 text-sm bg-green-900/20 rounded-sm p-3">{done.label}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={() => navigate(done.to)} className="btn-primary">View it</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
      <FollowupFields value={state} onChange={setState} order={order} />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : state.mode === 'existing' ? 'Add to task' : 'Create task'}
        </button>
      </div>
    </form>
  );
}

// ─── Add to inventory (preview → run) ─────────────────────────────────────────

const LINE_STATE = {
  added:     { label: 'Already in inventory', cls: 'text-green-400' },
  receive:   { label: 'Will be added',        cls: 'text-green-400' },
  skipped:   { label: 'Left out',             cls: 'text-gray-500'  },
  unmatched: { label: 'Not an inventory item', cls: 'text-gray-500' },
  ambiguous: { label: 'Several items match — pick one', cls: 'text-amber-400' },
  bad_qty:   { label: 'No quantity to receive', cls: 'text-amber-400' },
};
const MATCHED_BY = { linked: 'linked', sku: 'SKU match', name: 'name match', manual: 'picked by hand' };

function AddToInventoryModal({ order, onClose, onDone }) {
  const [plan, setPlan]       = useState(null);
  const [error, setError]     = useState('');
  const [links, setLinks]     = useState({});   // lineIndex → { id, name, sku } | 'skip'
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState(null);

  useEffect(() => {
    orderLogApi.inventoryPlan(order.id)
      .then(r => setPlan(r.data.plan))
      .catch(e => setError(e.response?.data?.error ?? 'Could not load inventory.'));
  }, [order.id]);

  // What each line will do once the user's choices are applied (mirrors the server).
  const effective = (line) => {
    const choice = links[line.index];
    if (line.state === 'added') return { state: 'added', match: line.match };
    if (choice === 'skip') return { state: 'skipped', match: line.match };
    if (choice) return { state: 'receive', match: choice, by: 'manual' };
    return { state: line.state, match: line.match, by: line.by };
  };
  const toReceive = (plan ?? []).filter(l => effective(l).state === 'receive');

  const run = async () => {
    setRunning(true); setError('');
    const payload = Object.fromEntries(Object.entries(links).map(([i, v]) => [i, v === 'skip' ? 'skip' : v.id]));
    try {
      const { data } = await orderLogApi.addToInventory(order.id, payload);
      setResult(data);
      onDone();
    } catch (e) {
      setError(e.response?.data?.error ?? 'Could not add to inventory.');
    } finally { setRunning(false); }
  };

  if (result) {
    return (
      <div className="space-y-3">
        {result.received.length > 0 ? (
          <div className="rounded-lg bg-green-900/20 border border-green-800 p-3">
            <p className="text-green-400 text-sm font-medium mb-1">Added to inventory</p>
            <ul className="text-sm text-gray-300 space-y-0.5">
              {result.received.map(r => (
                <li key={r.index}>+{r.qty} × {r.inventory_name}
                  {r.on_hand != null && <span className="text-gray-500"> — now {r.on_hand} on hand</span>}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Nothing was added.</p>
        )}
        {result.failed.length > 0 && (
          <div className="rounded-lg bg-red-900/20 border border-red-800 p-3 text-sm text-red-400">
            <p className="font-medium mb-1">These lines failed — nothing was received for them:</p>
            <ul>{result.failed.map(f => <li key={f.index}>{f.item_name}: {f.error}</li>)}</ul>
          </div>
        )}
        {result.skipped.length > 0 && (
          <p className="text-xs text-gray-500">
            Not added (non-inventory): {result.skipped.map(s => s.item_name).join(', ')}
          </p>
        )}
        <p className="text-sm text-gray-400">
          {result.inventory_added
            ? '✓ This order is marked as added to inventory.'
            : 'Some lines still need a decision, so the order is not marked as added yet.'}
        </p>
        <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Done</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
      <p className="text-sm text-gray-400">
        Lines that match an item already in inventory (by SKU / barcode, or exact name) are received into stock.
        Everything else is treated as a non-inventory purchase and left alone — or link it to an item by hand.
      </p>

      {!plan && !error && <p className="text-gray-500 text-sm py-4 text-center">Matching against inventory…</p>}

      {plan && (
        <div className="space-y-2">
          {plan.map(line => {
            const eff = effective(line);
            const meta = LINE_STATE[eff.state];
            const canPick = ['unmatched', 'ambiguous'].includes(line.state) || typeof links[line.index] === 'object';
            return (
              <div key={line.index} className="rounded-lg border border-surface-600 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200 break-words">
                      <span className="text-gray-500">{line.quantity ?? '—'} ×</span> {line.item_name}
                    </p>
                    {line.sku && <p className="text-xs text-gray-600">{line.sku}</p>}
                  </div>
                  {['receive', 'skipped'].includes(line.state) && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0 cursor-pointer">
                      <input type="checkbox" className="h-4 w-4 accent-brand"
                        checked={eff.state === 'receive'}
                        onChange={e => setLinks(l => {
                          const n = { ...l };
                          if (e.target.checked) delete n[line.index]; else n[line.index] = 'skip';
                          return n;
                        })} />
                      Add
                    </label>
                  )}
                </div>
                <p className={`text-xs mt-1 ${meta.cls}`}>
                  {meta.label}
                  {eff.match && eff.state !== 'unmatched' && (
                    <> → <span className="text-gray-300">{eff.match.name}</span>
                      {eff.match.sku && <span className="text-gray-500"> {eff.match.sku}</span>}
                      {eff.match.quantity != null && <span className="text-gray-500"> · {eff.match.quantity} on hand</span>}
                      {eff.by && <span className="text-gray-600"> ({MATCHED_BY[eff.by]})</span>}
                    </>
                  )}
                  {line.state === 'added' && line.added_qty != null && <span className="text-gray-500"> (+{line.added_qty})</span>}
                </p>
                {canPick && (
                  <div className="mt-2">
                    {line.state === 'ambiguous' && !links[line.index] && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {line.candidates.map(c => (
                          <button key={c.id} type="button" onClick={() => setLinks(l => ({ ...l, [line.index]: c }))}
                            className="text-xs px-2 py-1 rounded-sm border border-surface-500 text-gray-300 hover:border-accent">
                            {c.name} <span className="text-gray-500">{c.sku} · {c.quantity} on hand</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <InventoryPicker
                      value={typeof links[line.index] === 'object' ? links[line.index] : null}
                      onChange={(item) => setLinks(l => {
                        const n = { ...l };
                        if (item) n[line.index] = item; else delete n[line.index];
                        return n;
                      })}
                      placeholder="Link to inventory item…" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={run} disabled={!plan || running || !toReceive.length} className="btn-primary">
          {running ? 'Adding…' : toReceive.length
            ? `Add ${toReceive.length} line${toReceive.length !== 1 ? 's' : ''} to inventory`
            : 'Nothing to add'}
        </button>
      </div>
    </div>
  );
}

function OrderCard({ order, onEdit, onDelete, onFollowup, onAddToInventory }) {
  const qc    = useQueryClient();
  const items = order.items ?? [];
  const total = orderTotal(items);

  const patchOrder = async (updates) => {
    await orderLogApi.update(order.id, updates);
    qc.invalidateQueries(['order-log']);
  };

  const patchItemStatus = async (idx, status) => {
    const updated = items.map((it, i) => i === idx ? { ...it, status } : it);
    await patchOrder({ items: updated });
  };

  // Show a summary line if items have mixed/explicit statuses.
  const itemStatuses = items.map(it => it.status).filter(Boolean);
  const mixedStatuses = itemStatuses.length > 0 && new Set(itemStatuses).size > 1;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Header: clickable order-level status + vendor */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge value={order.status} onChange={(s) => patchOrder({ status: s })} />
            <h4 className="text-gray-200 font-medium">{order.vendor}</h4>
            {order.po_number && <span className="text-gray-600 text-xs">PO: {order.po_number}</span>}
            {mixedStatuses && (
              <span className="text-xs text-gray-600 italic">mixed item statuses</span>
            )}
          </div>

          {/* Items list — each item has its own clickable status badge */}
          {items.length > 0 && (
            <div className="mt-1.5 space-y-1 mb-1">
              {items.map((it, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <StatusBadge
                    value={it.status || order.status}
                    onChange={(s) => patchItemStatus(i, s)}
                  />
                  <span className="text-gray-300">{it.item_name}</span>
                  {it.sku && <span className="text-gray-600">{it.sku}</span>}
                  <span className="text-gray-500">×{it.quantity}</span>
                  {it.total_cost && <span className="text-gray-500">{fmt(it.total_cost)}</span>}
                  {it.added_at && (
                    <span className="text-green-400 flex items-center gap-0.5"
                      title={`Received ${it.added_qty} into inventory${it.inventory_name ? ` as ${it.inventory_name}` : ''} on ${fmtDate(it.added_at)}`}>
                      <PackageCheck size={11} /> in inventory
                    </span>
                  )}
                </div>
              ))}
              {items.length > 1 && total > 0 && (
                <div className="text-xs text-gray-500 pt-0.5 pl-0.5">
                  Total: <span className="text-gray-200 font-medium">{fmt(total)}</span>
                </div>
              )}
            </div>
          )}

          {/* Destination + purpose */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-1">
            {order.for_stock
              ? <span className="bg-surface-600 text-gray-400 px-1.5 py-0.5 rounded-sm">For Stock</span>
              : order.customer_name && <span><span className="text-gray-600">Customer: </span>{order.customer_name}</span>
            }
            {order.purpose && <span><span className="text-gray-600">For: </span>{order.purpose}</span>}
          </div>

          {/* Dates */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-1">
            {order.order_date    && <span><span className="text-gray-600">Ordered: </span>{fmtDate(order.order_date)}</span>}
            {order.ordered_by_name && <span><span className="text-gray-600">By: </span>{order.ordered_by_name}</span>}
            {order.expected_date && <span><span className="text-gray-600">Expected: </span>{fmtDate(order.expected_date)}</span>}
            {order.received_date && <span><span className="text-gray-600">Received: </span>{fmtDate(order.received_date)}</span>}
          </div>

          {order.notes && <p className="text-xs text-gray-600 mt-1.5 italic">{order.notes}</p>}

          {/* Inventory accounting: is this a restock, and did the stock actually land? */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={!!order.is_inventory_order}
                onChange={e => patchOrder({ is_inventory_order: e.target.checked })} />
              Inventory order
            </label>
            {order.is_inventory_order && (
              <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${order.inventory_added ? 'text-green-400' : 'text-amber-400'}`}
                title={order.inventory_added
                  ? `Confirmed${order.inventory_added_by_name ? ` by ${order.inventory_added_by_name}` : ''}${order.inventory_added_at ? ` on ${fmtDate(order.inventory_added_at)}` : ''}`
                  : 'Tick once the stock has been received into inventory'}>
                <input type="checkbox" className="h-4 w-4 accent-green-600" checked={!!order.inventory_added}
                  onChange={e => patchOrder({ inventory_added: e.target.checked })} />
                {order.inventory_added
                  ? <>Added to inventory{order.inventory_added_at ? ` · ${fmtDate(order.inventory_added_at)}` : ''}</>
                  : <>Not yet added to inventory</>}
              </label>
            )}
            {order.is_inventory_order && !order.inventory_added && (
              <button type="button" onClick={onAddToInventory}
                className="btn-secondary py-1 px-3 text-xs flex items-center gap-1.5">
                <PackagePlus size={13} /> Add to inventory
              </button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onFollowup} title="Create a follow-up task from this order"
            className="btn-ghost p-1.5 text-gray-600 hover:text-accent">
            <ClipboardList size={13} />
          </button>
          <button onClick={onEdit} className="btn-ghost p-1.5 text-gray-600 hover:text-gray-300">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-gray-600 hover:text-red-400">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Attachments — always visible */}
      <AttachmentsSection orderId={order.id} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OrderLog() {
  const [modal, setModal]         = useState(null);
  const [followup, setFollowup]   = useState(null);   // order → follow-up modal
  const [statusFilter, setStatus] = useState('');
  const [needsInventory, setNeedsInventory] = useState(false);
  const [search, setSearch]       = useState('');
  const [adding, setAdding]       = useState(null);   // order → Add-to-inventory modal
  const qc = useQueryClient();

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['order-log', statusFilter, search, needsInventory],
    queryFn: async () => {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (needsInventory) params.needsInventory = 1;
      if (search) params.search = search;
      const { data } = await orderLogApi.list(params);
      return data;
    },
  });

  const removeOrder = async (order) => {
    if (!confirm(`Delete order from "${order.vendor}"?`)) return;
    await orderLogApi.remove(order.id);
    refetch();
    qc.invalidateQueries(['order-log']);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input pl-9" placeholder="Search vendor, item, PO, customer…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setStatus('')}
            className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${!statusFilter ? 'bg-surface-500 text-gray-100' : 'bg-surface-700 text-gray-500 hover:text-gray-300'}`}>
            All
          </button>
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(statusFilter === s ? '' : s)}
              className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${statusFilter === s ? STATUS_META[s].cls : 'bg-surface-700 text-gray-500 hover:text-gray-300'}`}>
              {STATUS_META[s].label}
            </button>
          ))}
          <button onClick={() => setNeedsInventory(v => !v)}
            title="Inventory orders whose stock hasn't been confirmed as added yet"
            className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center gap-1 ${needsInventory ? 'bg-amber-900/40 text-amber-400' : 'bg-surface-700 text-gray-500 hover:text-gray-300'}`}>
            <PackagePlus size={12} /> Needs inventory
          </button>
        </div>

        <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm ml-auto shrink-0">
          <Plus size={14} /> New Order
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-gray-500 py-8 text-center">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-700 flex items-center justify-center mb-3">
            <Package2 size={22} className="text-gray-600" />
          </div>
          <p className="text-gray-400 font-medium">
            No orders{statusFilter ? ` with status "${STATUS_META[statusFilter]?.label}"` : ''}{needsInventory ? ' waiting to be added to inventory' : ''}
          </p>
          <p className="text-gray-600 text-sm mt-1">Click "New Order" to log a purchase order.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <OrderCard key={order.id} order={order}
              onEdit={() => setModal(order)}
              onDelete={() => removeOrder(order)}
              onFollowup={() => setFollowup(order)}
              onAddToInventory={() => setAdding(order)} />
          ))}
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'New Order' : 'Edit Order'} size="lg">
        {modal !== null && (
          <OrderForm
            order={modal === 'new' ? null : modal}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); qc.invalidateQueries(['order-log']); }}
          />
        )}
      </Modal>

      <Modal open={adding !== null} onClose={() => setAdding(null)}
        title={adding ? `Add to inventory — ${adding.vendor}` : ''}>
        {adding !== null && (
          <AddToInventoryModal order={adding} onClose={() => setAdding(null)}
            onDone={() => qc.invalidateQueries({ queryKey: ['order-log'] })} />
        )}
      </Modal>

      <Modal open={followup !== null} onClose={() => setFollowup(null)} title="Create follow-up from order">
        {followup !== null && (
          <OrderFollowupModal order={followup} onClose={() => setFollowup(null)} />
        )}
      </Modal>
    </div>
  );
}
