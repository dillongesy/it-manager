import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone, Camera, Wrench, Clock, ArrowRight, RefreshCw, ClipboardList, CalendarDays } from 'lucide-react';
import { fieldJobsApi } from '../api/fieldJobs.js';
import { CustomerPicker } from '../components/ui/CustomerPicker.jsx';
import { MODAL_OVERLAY, MODAL_PANEL } from '../components/ui/Modal.jsx';
import { formatDate } from '../utils/date.js';
import { cadenceLabel } from '../utils/cadence.js';

// "Jul 20" for a one-day job, "Jul 20 – Jul 24" when the crew was on site across days.
function dateRange(first, last) {
  const a = formatDate(first, { month: 'short', day: 'numeric' });
  const b = formatDate(last, { month: 'short', day: 'numeric' });
  return !b || a === b ? a : `${a} – ${b}`;
}

// An <img> that loads an auth-protected photo through the JWT api client as a blob.
function AuthImage({ jobId, photoId, alt, className }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = null;
    let active = true;
    setUrl(null); setFailed(false);
    fieldJobsApi.photo(jobId, photoId)
      .then(({ data }) => { if (active) { revoked = URL.createObjectURL(data); setUrl(revoked); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (revoked) URL.revokeObjectURL(revoked); };
  }, [jobId, photoId]);

  if (failed) return <div className={`${className} bg-surface-700 flex items-center justify-center text-gray-600`}><Camera size={18} /></div>;
  if (!url) return <div className={`${className} bg-surface-700 animate-pulse`} />;
  return <img src={url} alt={alt} className={className} />;
}

export function FieldJobs() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [promoting, setPromoting] = useState(null); // the job being promoted

  const { data: bridge } = useQuery({
    queryKey: ['field-jobs', 'status'],
    queryFn: () => fieldJobsApi.status().then(r => r.data),
  });

  const { data: jobs = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['field-jobs', 'ready'],
    queryFn: () => fieldJobsApi.list({ status: 'ready' }).then(r => r.data),
    enabled: bridge?.configured !== false,
  });

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Smartphone size={22} className="text-accent" /> Field Jobs
        </h1>
        <button onClick={() => refetch()} className="btn-secondary flex items-center gap-1.5 text-sm" disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-5">
        On-site jobs marked <span className="text-accent">ready to bill</span>.
      </p>

      {bridge?.configured === false ? (
        <p className="text-gray-500 bg-surface-800 rounded-lg p-4">
          The Field App bridge isn't configured. Set <code>FIELD_API_URL</code> and <code>FIELD_API_TOKEN</code> in the
          Portal backend <code>.env</code>.
        </p>
      ) : error ? (
        <p className="text-red-400 bg-red-900/20 rounded-lg p-4">
          {error.response?.data?.error || 'Could not reach the Field App.'}
        </p>
      ) : isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-gray-500 bg-surface-800 rounded-lg p-6 text-center">No field jobs are ready to bill right now.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <JobCard key={job.id} job={job} onPromote={() => setPromoting(job)} />
          ))}
        </div>
      )}

      {promoting && (
        <PromoteModal
          job={promoting}
          onClose={() => setPromoting(null)}
          onDone={(woId) => {
            setPromoting(null);
            qc.invalidateQueries({ queryKey: ['field-jobs'] });
            navigate(`/work-orders/${woId}`);
          }}
        />
      )}
    </div>
  );
}

function JobCard({ job, onPromote }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-gray-100 font-semibold truncate">{job.customer_name || `Job #${job.number}`}</p>
          {job.customer_address && <p className="text-gray-500 text-sm truncate">{job.customer_address}</p>}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
            <span>#{job.number}</span>
            {job.work_date && <span>{dateRange(job.work_date, job.last_date)}</span>}
            {Number(job.day_count) > 1 && (
              <span className="flex items-center gap-1" title="Days on site">
                <CalendarDays size={11} /> {job.day_count} days
              </span>
            )}
            {Number(job.hours) > 0 && <span className="flex items-center gap-1"><Clock size={11} /> {Number(job.hours)}h</span>}
            {job.tech_initials && <span>{job.tech_initials}</span>}
            {Number(job.item_count) > 0 && <span className="flex items-center gap-1" title="Parts"><Wrench size={11} /> {job.item_count}</span>}
            {Number(job.service_count) > 0 && <span className="flex items-center gap-1" title="Services"><ClipboardList size={11} /> {job.service_count}</span>}
            {Number(job.photo_count) > 0 && <span className="flex items-center gap-1" title="Photos"><Camera size={11} /> {job.photo_count}</span>}
          </div>
        </div>
        <button onClick={onPromote} className="btn-primary flex items-center gap-1.5 text-sm shrink-0">
          Import to WO <ArrowRight size={14} />
        </button>
      </div>
      {job.description && <p className="text-gray-300 text-sm mt-3 whitespace-pre-wrap">{job.description}</p>}
    </div>
  );
}

/**
 * One field day as it will land in the work order - its date, the per-technician
 * hours (which the Portal keeps as a section total plus a note), and its parts and
 * services. Every section imports on the work order's default rate; the biller
 * adjusts it per section afterwards.
 */
function DayPreview({ day, index }) {
  const hours = (day.technicians ?? []).reduce((sum, t) => sum + (Number(t.hours) || 0), 0);
  const price = (v) => (v == null || v === '' ? null : `$${Number(v).toFixed(2)}`);

  return (
    <div className="bg-surface-700 rounded-md px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-gray-200 font-medium">
          Section {index + 1}
          <span className="text-gray-500 font-normal"> · {formatDate(day.work_date) || 'no date'}</span>
        </p>
        <span className="text-xs text-gray-400 shrink-0">
          {hours > 0 ? `${hours}h` : (day.hours ? `${Number(day.hours)}h` : '—')}
        </span>
      </div>

      {day.technicians?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {day.technicians.map((t, i) => (
            <span key={i} className="px-2 py-0.5 rounded-sm text-xs bg-accent/20 text-accent">
              {t.initials || t.full_name}{Number(t.hours) > 0 ? ` · ${Number(t.hours)}h` : ''}
            </span>
          ))}
        </div>
      )}

      {day.description && <p className="text-xs text-gray-400 mt-1.5 whitespace-pre-wrap">{day.description}</p>}

      {day.items?.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {day.items.map((it, i) => {
            const unit = it.unit_price != null ? Number(it.unit_price)
                       : (it.inventory_cost != null ? Number(it.inventory_cost) : null);
            return (
              <div key={i} className="flex justify-between text-xs text-gray-400 gap-2">
                <span className="truncate"><Wrench size={10} className="inline mr-1" />{it.item_name || it.description}{it.sku ? ` (${it.sku})` : ''}</span>
                <span className="shrink-0">×{Number(it.quantity)}{price(unit) ? ` · ${price(unit)}` : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {day.services?.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {day.services.map((sv, i) => (
            <div key={i} className="flex justify-between text-xs text-gray-400 gap-2">
              <span className="truncate">
                <ClipboardList size={10} className="inline mr-1" />{sv.description}
                {sv.billing_type === 'recurring' && <span className="text-accent ml-1">({cadenceLabel(sv.recurrence, sv.recurrence_count)})</span>}
              </span>
              <span className="shrink-0">×{Number(sv.quantity)}{price(sv.unit_price) ? ` · ${price(sv.unit_price)}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromoteModal({ job, onClose, onDone }) {
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pull the full capture so we can preview photos/parts before importing.
  const { data: full } = useQuery({
    queryKey: ['field-jobs', job.id, 'full'],
    queryFn: () => fieldJobsApi.get(job.id).then(r => r.data),
  });

  // Pre-006 captures arrive without a `days` array - fold them into one day so the
  // preview only handles one shape (the backend importer does the same).
  const days = full?.days?.length
    ? full.days
    : full
      ? [{ work_date: full.work_date, description: full.description, technicians: full.technicians,
           items: full.items, services: full.services, hours: full.hours }]
      : [];

  const confirm = async () => {
    if (!customerId) return;
    setBusy(true); setError('');
    try {
      const { data } = await fieldJobsApi.promote(job.id, { customer_id: customerId });
      if (data.warnings?.length) window.alert(data.warnings.join('\n'));
      onDone(data.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not import this job.');
      setBusy(false);
    }
  };

  return (
    <div className={`${MODAL_OVERLAY} bg-black/60 backdrop-blur-xs`} onClick={onClose}>
      <div className={`${MODAL_PANEL} max-w-lg overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-surface-600">
          <h3 className="text-gray-100 font-semibold text-base">Import Field Job #{job.number}</h3>
          <p className="text-gray-500 text-xs mt-0.5">Field customer: {job.customer_name || '—'}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Match to a Portal customer <span className="text-brand">*</span>
            </label>
            <CustomerPicker value={customerId} initialName={job.customer_name || ''}
              onChange={(id) => setCustomerId(id)} />
            <p className="text-xs text-gray-500 mt-1">The work order, billing rate, and imported photos attach to this customer.</p>
          </div>

          {days.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                {days.length === 1 ? 'This job becomes 1 work section' : `This job becomes ${days.length} work sections, one per day`}
              </p>
              <div className="space-y-2">
                {days.map((day, i) => <DayPreview key={day.id || i} day={day} index={i} />)}
              </div>
            </div>
          )}

          {full?.photos?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">Photos ({full.photos.length}) → customer files</p>
              <div className="grid grid-cols-4 gap-2">
                {full.photos.map(p => (
                  <AuthImage key={p.id} jobId={job.id} photoId={p.id} alt={p.original_name}
                    className="w-full aspect-square object-cover rounded-lg" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-600">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={confirm} disabled={!customerId || busy} className="btn-primary flex items-center gap-1.5">
            {busy ? 'Importing…' : <>Create work order <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
