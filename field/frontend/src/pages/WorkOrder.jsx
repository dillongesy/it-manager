import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Check, RotateCcw, Camera, Plus, Clock, CalendarDays } from 'lucide-react';
import { fieldWOApi } from '../api/workOrders.js';
import DayCard from '../components/DayCard.jsx';
import Labeled from '../components/Labeled.jsx';
import { statusLabel } from './WorkOrders.jsx';
import {
  blankDay, dayAfter, toFormDay, totalHours, fmtHours, hoursByTechnician, formatDateRange,
} from '../utils/jobDays.js';

export default function WorkOrder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState({ customer_name: '', customer_address: '', notes: '' });
  const [days, setDays] = useState(() => [blankDay()]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [captureStatus, setCaptureStatus] = useState('open');
  const [number, setNumber] = useState(null);
  const [importedWoNumber, setImportedWoNumber] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const editable = isNew || captureStatus === 'open';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const apply = (wo) => {
    setForm({
      customer_name: wo.customer_name || '',
      customer_address: wo.customer_address || '',
      notes: wo.notes || '',
    });
    setCaptureStatus(wo.capture_status || 'open');
    setNumber(wo.number ?? null);
    setImportedWoNumber(wo.imported_wo_number ?? null);
    const loaded = (wo.days || []).map(toFormDay);
    const next = loaded.length ? loaded : [blankDay()];
    setDays(next);
    // Land on the day they're most likely here to work on — the last one. A
    // single-day job opens expanded; a multi-day job opens as a short overview.
    setExpandedKey(next.length === 1 ? next[0].key : null);
  };

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const res = await fieldWOApi.get(id);
      apply(res.data);
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (isNew) setExpandedKey(days[0].key); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setDay = (idx, next) => setDays(days.map((d, i) => (i === idx ? next : d)));

  const addDay = () => {
    const next = dayAfter(days[days.length - 1]);
    setDays([...days, next]);
    setExpandedKey(next.key);
  };

  const removeDay = (idx) => {
    if (days.length <= 1) return;
    if (!window.confirm(`Remove Day ${idx + 1}? Its hours, parts and services go with it.`)) return;
    setDays(days.filter((_, i) => i !== idx));
  };

  const payload = () => ({
    ...form,
    days: days.map((d) => ({
      work_date: d.work_date || null,
      description: d.description,
      notes: d.notes,
      technicians: d.technicians,
      items: d.items,
      services: d.services,
    })),
  });

  const save = async () => {
    setError('');
    if (!form.customer_name.trim()) { setError('Customer name is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        const res = await fieldWOApi.create(payload());
        navigate(`/work-orders/${res.data.id}`, { replace: true });
      } else {
        const res = await fieldWOApi.update(id, payload());
        apply(res.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const runTransition = async (fn) => {
    setError('');
    setSaving(true);
    try {
      const res = await fn(id);
      apply(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this job? This cannot be undone.')) return;
    await fieldWOApi.remove(id);
    navigate('/work-orders', { replace: true });
  };

  if (loading) return <p className="text-gray-500 text-center py-8">Loading…</p>;

  const total = totalHours(days);
  const perTech = hoursByTechnician(days);
  const range = formatDateRange(days[0]?.work_date, days[days.length - 1]?.work_date);

  return (
    <div className="p-4 space-y-4">
      <button onClick={() => navigate('/work-orders')} className="text-gray-500 text-sm">← Jobs</button>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{isNew ? 'New job' : `Job #${number ?? ''}`}</h1>
        {!isNew && <span className="text-sm text-gray-400">{statusLabel(captureStatus)}</span>}
      </div>

      {captureStatus === 'imported' && (
        <p className="text-sm text-green-300 bg-green-500/10 rounded-lg p-3">
          Imported to the office{importedWoNumber ? ` as WO-${String(importedWoNumber).padStart(5, '0')}` : ''}. This job is
          now billed in the Portal and is locked here.
        </p>
      )}

      {error && <p className="text-brand text-sm">{error}</p>}

      {editable ? (
        <>
          <Labeled label="Customer *">
            <input className="input" value={form.customer_name} onChange={set('customer_name')} autoFocus={isNew} required />
          </Labeled>
          <Labeled label="Job site address">
            <textarea className="input" rows={2} value={form.customer_address} onChange={set('customer_address')} />
          </Labeled>
        </>
      ) : (
        <div className="card p-4 space-y-2 text-sm">
          <Info label="Customer" value={form.customer_name} />
          <Info label="Job site" value={form.customer_address} />
        </div>
      )}

      <JobTotals total={total} perTech={perTech} dayCount={days.length} range={range} />

      <div className="space-y-2">
        {days.map((day, i) => (
          <DayCard
            key={day.key}
            day={day}
            index={i}
            dayCount={days.length}
            editable={editable}
            expanded={expandedKey === day.key}
            onToggle={() => setExpandedKey(expandedKey === day.key ? null : day.key)}
            onChange={(next) => setDay(i, next)}
            onRemove={() => removeDay(i)}
          />
        ))}
      </div>

      {editable && (
        <button onClick={addDay} className="btn-secondary w-full flex items-center justify-center gap-2">
          <Plus size={18} />Add another date
        </button>
      )}

      {editable ? (
        <>
          <Labeled label="Job notes" hint="applies to the whole job, not one day">
            <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
          </Labeled>

          <button onClick={save} disabled={saving} className="btn-primary w-full">
            {saving ? 'Saving…' : isNew ? 'Create job' : 'Save changes'}
          </button>
          {!isNew && captureStatus === 'open' && (
            <button onClick={() => runTransition(fieldWOApi.ready)} disabled={saving} className="btn-secondary w-full flex items-center justify-center gap-2">
              <Check size={18} />Mark ready to bill
            </button>
          )}
        </>
      ) : (
        form.notes && (
          <div className="card p-4">
            <p className="text-xs uppercase text-gray-500 mb-1">Job notes</p>
            <p className="text-sm whitespace-pre-wrap">{form.notes}</p>
          </div>
        )
      )}

      {!isNew && (
        <>
          {captureStatus === 'ready' && (
            <button onClick={() => runTransition(fieldWOApi.reopen)} disabled={saving} className="btn-secondary w-full flex items-center justify-center gap-2">
              <RotateCcw size={18} />Reopen to edit
            </button>
          )}
          <button
            onClick={() => navigate(`/photos?workOrderId=${id}&customerName=${encodeURIComponent(form.customer_name)}&customerAddress=${encodeURIComponent(form.customer_address || '')}`)}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <Camera size={18} />Photos
          </button>
          {captureStatus === 'open' && (
            <button onClick={handleDelete} className="w-full text-brand text-sm py-2">Delete job</button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The running total, always in view above the day cards — the one number the
 * office and the tech both care about, plus how it splits per person.
 */
function JobTotals({ total, perTech, dayCount, range }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-400 min-w-0">
          <CalendarDays size={16} className="shrink-0" />
          <span className="truncate">
            {dayCount} {dayCount === 1 ? 'day' : 'days'}{range ? ` · ${range}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Clock size={16} className="text-accent" />
          <span className="text-xl font-bold text-gray-100">{fmtHours(total)}</span>
          <span className="text-sm text-gray-400">hrs</span>
        </div>
      </div>
      {perTech.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-surface-600">
          {perTech.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-1.5 bg-surface-700 rounded-full px-3 py-1 text-sm mt-2">
              <span className="font-semibold text-accent">{t.label}</span>
              <span className="text-gray-400">{fmtHours(t.hours)}h</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
