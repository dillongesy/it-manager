import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Building2, X } from 'lucide-react';
import { tasksApi } from '../../api/tasks.js';
import { customersApi } from '../../api/customers.js';
import { CustomerPicker } from '../ui/CustomerPicker.jsx';
import { OfficeSelect } from '../ui/office.jsx';
import { RichTextEditor } from '../ui/RichText.jsx';
import { formatPhone } from '../../utils/phone.js';
import { toDateInput } from '../../utils/date.js';
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, STATUS_LABEL, WAITING_ON, WAITING_LABEL } from '../../utils/tasks.js';
import { LENGTHS, lengthLabel } from '../../utils/calendar.js';
import { useTechs } from './taskBits.jsx';

// Create / edit a task. The customer is optional - blank = internal work. Giving an
// open task a scheduled date makes it Scheduled on save (backend lib/tasks.js). A scheduled task
// can also have a time and a length, so it sits on the calendar like an appointment.

const fromTask = (t = {}) => ({
  title: t.title ?? '',
  kind: t.kind ?? 'task',
  priority: t.priority ?? 'normal',
  status: t.status ?? 'open',
  waiting_on: t.waiting_on ?? '',
  customer_id: t.customer_id ?? '',
  customer_name: t.customer_name ?? '',
  location_id: t.location_id ?? '',
  assigned_to: t.assigned_to ?? '',
  scheduled_date: toDateInput(t.scheduled_date),
  scheduled_time: t.scheduled_time ? String(t.scheduled_time).slice(0, 5) : '',
  duration_minutes: t.duration_minutes ?? '',
  due_date: toDateInput(t.due_date),
  estimated_hours: t.estimated_hours ?? '',
  requested_by: t.requested_by ?? '',
  requested_phone: t.requested_phone ?? '',
  requested_date: toDateInput(t.requested_date),
  requested_time: t.requested_time ?? '',
  notes: t.notes ?? '',
});

const Label = ({ children }) => <label className="block text-sm font-medium text-gray-400 mb-1.5">{children}</label>;

export function TaskForm({ task, defaults = {}, onSaved, onClose }) {
  const editing = !!task?.id;
  const techs = useTechs();
  const [form, setForm] = useState(() => fromTask(editing ? task : defaults));
  const [showRequest, setShowRequest] = useState(() => !!(task?.requested_by || task?.requested_phone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // The chosen customer's branch offices, for the office picker.
  const { data: customer } = useQuery({
    queryKey: ['customers', form.customer_id],
    queryFn: () => customersApi.get(form.customer_id).then(r => r.data),
    enabled: !!form.customer_id,
    staleTime: 60_000,
  });
  const locations = customer?.locations ?? [];

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Give the task a title.'); return; }
    setSaving(true); setError('');
    try {
      const { customer_name, ...rest } = form;
      const payload = {
        ...rest,
        waiting_on: form.status === 'waiting' ? (form.waiting_on || null) : null,
        customer_id: form.customer_id || null,
        location_id: form.customer_id ? (form.location_id || null) : null,
        assigned_to: form.assigned_to || null,
        estimated_hours: form.estimated_hours === '' ? null : form.estimated_hours,
        scheduled_time: form.scheduled_date && form.scheduled_time ? form.scheduled_time : null,
        duration_minutes: form.scheduled_date && form.scheduled_time && form.duration_minutes !== '' ? Number(form.duration_minutes) : null,
      };
      // A new task's status is worked out from its date unless it was changed by hand.
      if (!editing && payload.status === 'open') delete payload.status;
      const { data } = editing ? await tasksApi.update(task.id, payload) : await tasksApi.create(payload);
      if (data.outlook_warning) alert(data.outlook_warning);   // saved, but its Outlook event didn't follow
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the task.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div>
        <Label>Title *</Label>
        <input className="input" value={form.title} onChange={set('title')} autoFocus maxLength={255}
          placeholder="e.g. Replace Contoso core switch, Migrate Lakeside to the new server" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <div className="inline-flex rounded-lg bg-surface-700 p-0.5 w-full">
            {[['task', 'Task'], ['project', 'Project']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setForm(f => ({ ...f, kind: v }))}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${form.kind === v ? 'bg-brand text-white' : 'text-gray-400 hover:text-gray-200'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <Label>Priority</Label>
          <select className="input" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
      </div>

      <div>
        <Label>Customer</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CustomerPicker key={pickerKey} value={form.customer_id} initialName={form.customer_name}
              onChange={(id, name) => setForm(f => ({ ...f, customer_id: id, customer_name: name, location_id: id === f.customer_id ? f.location_id : '' }))} />
          </div>
          {form.customer_id && (
            <button type="button" onClick={() => { setForm(f => ({ ...f, customer_id: '', customer_name: '', location_id: '' })); setPickerKey(k => k + 1); }}
              className="btn-ghost px-2 py-2 text-xs flex items-center gap-1 shrink-0" title="Make this internal work"><X size={13} /> Internal</button>
          )}
        </div>
        {!form.customer_id && (
          <p className="text-xs text-gray-500 inline-flex items-center gap-1 mt-1.5"><Building2 size={12} /> Left blank, this is internal work.</p>
        )}
      </div>
      {form.customer_id && locations.length > 0 && (
        <OfficeSelect locations={locations} companyName={customer?.name} value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Assigned to</Label>
          <select className="input" value={form.assigned_to} onChange={set('assigned_to')}>
            <option value="">— Unassigned —</option>
            {techs.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <Label>Status</Label>
          <select className="input" value={form.status} onChange={set('status')}>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      {form.status === 'waiting' && (
        <div>
          <Label>Waiting on</Label>
          <select className="input" value={form.waiting_on} onChange={set('waiting_on')}>
            <option value="">—</option>
            {WAITING_ON.map(w => <option key={w} value={w}>{WAITING_LABEL[w][0].toUpperCase() + WAITING_LABEL[w].slice(1)}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Scheduled for</Label>
          <input className="input" type="date" value={form.scheduled_date} onChange={set('scheduled_date')} />
        </div>
        <div>
          <Label>Due by</Label>
          <input className="input" type="date" value={form.due_date} onChange={set('due_date')} />
        </div>
        <div>
          <Label>Estimated hours</Label>
          <input className="input" type="number" min="0" step="0.25" inputMode="decimal" value={form.estimated_hours} onChange={set('estimated_hours')} placeholder="—" />
        </div>
      </div>
      {form.scheduled_date && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 -mt-1">
          <div>
            <Label>Start time</Label>
            <input className="input" type="time" step="900" value={form.scheduled_time} onChange={set('scheduled_time')} />
          </div>
          {form.scheduled_time ? (
            <div>
              <Label>Length</Label>
              <select className="input" value={form.duration_minutes} onChange={set('duration_minutes')}>
                <option value="">{form.estimated_hours ? `Same as the estimate (${lengthLabel(Math.max(15, Math.round(Number(form.estimated_hours) * 4) * 15))})` : '1 h (default)'}</option>
                {[...new Set([...LENGTHS, ...(form.duration_minutes ? [Number(form.duration_minutes)] : [])])].sort((a, b) => a - b)
                  .map(m => <option key={m} value={m}>{lengthLabel(m)}</option>)}
              </select>
            </div>
          ) : (
            <p className="text-xs text-gray-500 sm:col-span-2 self-end pb-2.5">No time = it shows as an all-day item on that date.</p>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => setShowRequest(v => !v)} className="text-sm text-gray-400 hover:text-gray-200 inline-flex items-center gap-1">
          {showRequest ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Who asked for it (optional)
        </button>
        {showRequest && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div><Label>Requested by</Label><input className="input" value={form.requested_by} onChange={set('requested_by')} placeholder="Contact name" /></div>
            <div><Label>Phone</Label><input className="input" type="tel" value={form.requested_phone} onChange={e => setForm(f => ({ ...f, requested_phone: formatPhone(e.target.value) }))} placeholder="(555) 000-0000" /></div>
            <div><Label>Date</Label><input className="input" type="date" value={form.requested_date} onChange={set('requested_date')} /></div>
            <div><Label>Time</Label><input className="input" type="time" value={form.requested_time} onChange={set('requested_time')} /></div>
          </div>
        )}
      </div>

      <div>
        <Label>Details</Label>
        <RichTextEditor content={form.notes} onChange={(html) => setForm(f => ({ ...f, notes: html }))}
          placeholder="Steps, scope, part numbers, screenshots…" minHeight={150} />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create task'}</button>
      </div>
    </form>
  );
}
