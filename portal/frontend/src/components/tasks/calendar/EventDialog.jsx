import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Repeat, Lock, MapPin, User, Bell, Clock, Pencil, Trash2, AlignLeft, ListChecks } from 'lucide-react';
import { Modal } from '../../ui/Modal.jsx';
import { outlookApi } from '../../../api/outlook.js';
import { dayKey, fromDayKey, UNASSIGNED_COLOR } from '../../../utils/tasks.js';
import {
  hm, parseHm, minutesOf, lengthLabel, LENGTHS, REMINDERS, repeatPresets, presetOf, describeRepeat, whenLabel,
  DOW, DOW_SHORT, WEEK_ORDER,
} from '../../../utils/calendar.js';
import { TaskForm } from '../TaskForm.jsx';

// Outlook events on the schedule, the way Outlook does them:
//   EventDialog   — open one: its details first (when, repeat, where, who, reminder, notes), then
//                   Edit / Delete. A repeating event asks "just this one or the whole series?"
//                   (and for deleting, "this and following" too) before anything changes.
//   NewItemDialog — make something new at a time: an Outlook event, or a task.
//   EventForm     — the editor both use: title, tech, start/end date and time with quick lengths,
//                   all day, repeat (presets + custom), reminder, show as, location, notes.
// Everything saves straight to Outlook. Events are never turned into tasks; private ones only show.

const SHOW_AS = [['busy', 'Busy'], ['free', 'Free'], ['tentative', 'Tentative'], ['oof', 'Out of office'], ['workingElsewhere', 'Working elsewhere']];
const SHOW_AS_LABEL = Object.fromEntries(SHOW_AS);
const reminderLabel = (m) => (m == null || m === '' ? 'No reminder' : REMINDERS.find(([v]) => v === Number(m))?.[1] ?? `${m} minutes before`);
const toDate = (key, time) => { const d = fromDayKey(key); d.setMinutes(parseHm(time) ?? 0); return d; };
const sameSpec = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The form's values for an existing event (or, for the series, its first occurrence). */
function formFromEvent(ev, repeat = null) {
  const s = new Date(ev.start), e = new Date(ev.end);
  return {
    title: ev.title ?? '',
    assign_to: ev.user_ids?.[0] ? String(ev.user_ids[0]) : '',
    show_as: ev.show_as ?? 'busy',
    all_day: Boolean(ev.all_day),
    start_date: ev.all_day ? ev.start_date : dayKey(s),
    end_date: ev.all_day ? ev.end_date : dayKey(e),
    start_time: ev.all_day ? '09:00' : hm(minutesOf(s)),
    end_time: ev.all_day ? '10:00' : hm(minutesOf(e)),
    repeat,
    location: ev.location ?? '',
    notes: ev.notes ?? '',
    reminder: ev.reminder_minutes ?? '',
  };
}

export function formFromSlot(slot, defaultTech = '') {
  return {
    title: '', assign_to: defaultTech ?? '', show_as: 'busy', all_day: Boolean(slot.allDay),
    start_date: slot.dateKey, end_date: slot.dateKey,
    start_time: hm(slot.startMin ?? 9 * 60), end_time: hm(slot.endMin ?? 10 * 60),
    repeat: null, location: '', notes: '', reminder: 15,
  };
}

const Field = ({ label, icon: Icon, children, className = '' }) => (
  <div className={className}>
    <span className="text-xs text-gray-500 flex items-center gap-1 mb-1">{Icon && <Icon size={11} />} {label}</span>
    {children}
  </div>
);

/** Repeat: Outlook's quick choices, or a custom pattern (every N days/weeks/months/years, which days, when it ends). */
function RepeatPicker({ value, onChange, dateKey }) {
  const presets = repeatPresets(dateKey);
  const [custom, setCustom] = useState(() => presetOf(value, dateKey) === 'custom');
  const choice = custom ? 'custom' : presetOf(value, dateKey);
  const dow = DOW[fromDayKey(dateKey).getDay()];
  const spec = value ?? { freq: 'weekly', interval: 1, days: [dow], end: 'never' };
  const set = (patch) => onChange({ ...spec, ...patch });
  const nth = ['first', 'second', 'third', 'fourth', 'last'][Math.min(4, Math.ceil(fromDayKey(dateKey).getDate() / 7) - 1)];

  return (
    <div className="space-y-2">
      <select className="input" value={choice} onChange={e => {
        const id = e.target.value;
        if (id === 'custom') { setCustom(true); onChange(value?.freq && value.freq !== 'other' ? value : spec); return; }
        setCustom(false); onChange(presets.find(p => p.id === id).spec);
      }}>
        {presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {value?.freq === 'other' && !custom && <p className="text-xs text-gray-500">This series repeats in a way set in Outlook. Pick a new pattern here to replace it.</p>}
      {custom && (
        <div className="rounded-lg bg-surface-700/40 p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-300 flex-wrap">
            Every
            <input type="number" min="1" max="99" className="input w-20 py-1.5" value={spec.interval ?? 1}
              onChange={e => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
            <select className="input w-auto py-1.5" value={spec.freq === 'other' ? 'weekly' : spec.freq} onChange={e => set({ freq: e.target.value, days: e.target.value === 'weekly' ? (spec.days?.length ? spec.days : [dow]) : undefined, monthly: e.target.value === 'monthly' ? spec.monthly ?? 'day' : undefined })}>
              <option value="daily">{(spec.interval ?? 1) > 1 ? 'days' : 'day'}</option>
              <option value="weekly">{(spec.interval ?? 1) > 1 ? 'weeks' : 'week'}</option>
              <option value="monthly">{(spec.interval ?? 1) > 1 ? 'months' : 'month'}</option>
              <option value="yearly">{(spec.interval ?? 1) > 1 ? 'years' : 'year'}</option>
            </select>
          </div>
          {spec.freq === 'weekly' && (
            <div className="flex gap-1 flex-wrap" role="group" aria-label="On these days">
              {WEEK_ORDER.map(d => {
                const on = (spec.days ?? []).includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on}
                    onClick={() => { const days = on ? spec.days.filter(x => x !== d) : [...(spec.days ?? []), d]; if (days.length) set({ days }); }}
                    className={`w-10 py-1.5 rounded-md text-xs font-medium ${on ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:text-gray-200'}`}>
                    {DOW_SHORT[d]}
                  </button>
                );
              })}
            </div>
          )}
          {spec.freq === 'monthly' && (
            <div className="flex flex-col gap-1.5 text-sm text-gray-300">
              <label className="inline-flex items-center gap-2"><input type="radio" className="accent-brand" checked={spec.monthly !== 'weekday'} onChange={() => set({ monthly: 'day' })} /> On day {fromDayKey(dateKey).getDate()}</label>
              <label className="inline-flex items-center gap-2"><input type="radio" className="accent-brand" checked={spec.monthly === 'weekday'} onChange={() => set({ monthly: 'weekday' })} /> On the {nth} {DOW_SHORT[dow]}</label>
            </div>
          )}
          <div className="space-y-1.5 text-sm text-gray-300">
            <span className="text-xs text-gray-500">Ends</span>
            <label className="flex items-center gap-2"><input type="radio" className="accent-brand" checked={(spec.end ?? 'never') === 'never'} onChange={() => set({ end: 'never' })} /> Never</label>
            <label className="flex items-center gap-2 flex-wrap"><input type="radio" className="accent-brand" checked={spec.end === 'date'} onChange={() => set({ end: 'date', until: spec.until ?? dateKey })} /> On
              <input type="date" className="input w-auto py-1" value={spec.until ?? ''} min={dateKey} onChange={e => set({ end: 'date', until: e.target.value })} /></label>
            <label className="flex items-center gap-2 flex-wrap"><input type="radio" className="accent-brand" checked={spec.end === 'count'} onChange={() => set({ end: 'count', count: spec.count ?? 10 })} /> After
              <input type="number" min="1" max="999" className="input w-20 py-1" value={spec.count ?? ''} onChange={e => set({ end: 'count', count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} /> times</label>
          </div>
          <p className="text-xs text-gray-400">{describeRepeat(spec, dateKey)}</p>
        </div>
      )}
    </div>
  );
}

/** The event editor. mode: 'create' | 'occurrence' (one event, or one of a series) | 'series'. */
export function EventForm({ initial, mode, techs, saving, error, submitLabel = 'Save', onSubmit, onCancel }) {
  const [f, setF] = useState(initial);
  const [localError, setLocalError] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const series = mode === 'series';
  const start = toDate(f.start_date, f.start_time);
  const end = toDate(f.end_date, f.end_time);
  const length = Math.round((end - start) / 60_000);

  // Moving the start keeps the length, like Outlook.
  const moveStart = (date, time) => {
    const next = toDate(date, time);
    const newEnd = new Date(next.getTime() + Math.max(length, 15) * 60_000);
    setF(x => ({ ...x, start_date: date, start_time: time, end_date: x.all_day ? (x.end_date < date ? date : x.end_date) : dayKey(newEnd), end_time: hm(minutesOf(newEnd)) }));
  };
  const setLength = (m) => { const e = new Date(start.getTime() + m * 60_000); setF(x => ({ ...x, end_date: dayKey(e), end_time: hm(minutesOf(e)) })); };

  const submit = (e) => {
    e.preventDefault();
    if (!f.title.trim()) return setLocalError('Give the event a title.');
    if (!f.all_day && length <= 0) return setLocalError('The end has to be after the start.');
    if (f.all_day && f.end_date < f.start_date) return setLocalError('The last day has to be on or after the first.');
    setLocalError('');
    onSubmit(f);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <input className="input text-base font-medium" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Add a title" autoFocus={mode === 'create'} maxLength={255} aria-label="Title" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="For (tech)" icon={User}>
          <select className="input" value={f.assign_to} onChange={e => set('assign_to', e.target.value)}>
            <option value="">Nobody in particular</option>
            {techs.map(u => <option key={u.id} value={String(u.id)}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Show as">
          <select className="input" value={f.show_as} onChange={e => set('show_as', e.target.value)}>
            {SHOW_AS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>

      {/* When */}
      <div className="rounded-lg border border-surface-600 p-3 space-y-3">
        {series ? (
          f.all_day
            ? <p className="text-sm text-gray-400 flex items-center gap-1.5"><Clock size={13} /> All day</p>
            : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts at" icon={Clock}><input type="time" step="900" className="input" value={f.start_time} onChange={e => moveStart(f.start_date, e.target.value)} /></Field>
                <Field label="Ends at"><input type="time" step="900" className="input" value={f.end_time} onChange={e => set('end_time', e.target.value)} /></Field>
              </div>
            )
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 flex items-center gap-1"><Clock size={11} /> When</span>
              <label className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" className="accent-brand" checked={f.all_day} onChange={e => set('all_day', e.target.checked)} /> All day
              </label>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
              <input type="date" className="input" value={f.start_date} onChange={e => e.target.value && moveStart(e.target.value, f.start_time)} aria-label="Start date" />
              {!f.all_day && <input type="time" step="900" className="input w-32" value={f.start_time} onChange={e => e.target.value && moveStart(f.start_date, e.target.value)} aria-label="Start time" />}
              <input type="date" className="input" value={f.end_date} min={f.start_date} onChange={e => e.target.value && set('end_date', e.target.value)} aria-label="End date" />
              {!f.all_day && <input type="time" step="900" className="input w-32" value={f.end_time} onChange={e => e.target.value && set('end_time', e.target.value)} aria-label="End time" />}
            </div>
            {!f.all_day && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-gray-500 mr-1">Length{length > 0 ? `: ${lengthLabel(length)}` : ''}</span>
                {LENGTHS.map(m => (
                  <button key={m} type="button" onClick={() => setLength(m)}
                    className={`px-2 py-1 rounded-md text-xs ${length === m ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:text-gray-200'}`}>
                    {lengthLabel(m).replace(' 0 min', '')}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {(mode === 'create' || series) && (
          <Field label="Repeat" icon={Repeat}>
            <RepeatPicker value={f.repeat} onChange={v => set('repeat', v)} dateKey={f.start_date} />
          </Field>
        )}
        {series && <p className="text-xs text-gray-500">Changes every event in the series. Events in it you changed on their own keep their own time.</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Reminder" icon={Bell}>
          <select className="input" value={f.reminder} onChange={e => set('reminder', e.target.value === '' ? '' : Number(e.target.value))}>
            {REMINDERS.map(([v, l]) => <option key={String(v)} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Location" icon={MapPin}><input className="input" value={f.location} onChange={e => set('location', e.target.value)} placeholder="Add a location" /></Field>
      </div>
      <Field label="Notes" icon={AlignLeft}>
        <textarea className="input min-h-[5.5rem]" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Add a description" />
      </Field>
      <p className="text-[11px] text-gray-500 -mt-2">The tech is saved as an Outlook category with their name, so Outlook shows it too. Notes are saved as plain text.</p>

      {(localError || error) && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{localError || error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

const timesOf = (f) => (f.all_day
  ? { all_day: true, start_date: f.start_date, end_date: f.end_date }
  : { all_day: false, start: toDate(f.start_date, f.start_time).toISOString(), end: toDate(f.end_date, f.end_time).toISOString() });
const reminderOf = (f) => (f.reminder === '' ? null : Number(f.reminder));

/** Only what changed, in the shape the API takes. */
function changes(f, init, mode) {
  const out = {};
  for (const k of ['title', 'location', 'notes', 'show_as']) if (f[k] !== init[k]) out[k] = f[k];
  if (f.assign_to !== init.assign_to) out.assign_to = f.assign_to || null;
  if (f.reminder !== init.reminder) out.reminder_minutes = reminderOf(f);
  if (mode === 'series') {
    if (!f.all_day && (f.start_time !== init.start_time || f.end_time !== init.end_time)) Object.assign(out, { start_time: f.start_time, end_time: f.end_time });
    if (!sameSpec(f.repeat, init.repeat)) out.repeat = f.repeat;
  } else if (['all_day', 'start_date', 'end_date', 'start_time', 'end_time'].some(k => f[k] !== init[k])) {
    Object.assign(out, timesOf(f));
  }
  return out;
}

const Row = ({ icon: Icon, children }) => (
  <div className="flex items-start gap-3 text-sm text-gray-300"><Icon size={15} className="text-gray-500 mt-0.5 shrink-0" /><div className="min-w-0 break-words">{children}</div></div>
);

/** An existing Outlook event: details, then edit / delete. */
export function EventDialog({ eventId, techs, colors, ask, onClose }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('view');   // view | occurrence | series
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['outlook', 'event', eventId], queryFn: () => outlookApi.get(eventId).then(r => r.data), retry: false });
  const data = q.data;
  const ev = data?.event;
  const series = data?.series;
  const techName = (id) => techs.find(u => String(u.id) === String(id))?.full_name;
  const color = ev?.user_ids?.[0] ? colors?.get(String(ev.user_ids[0])) ?? UNASSIGNED_COLOR : UNASSIGNED_COLOR;
  const occurrenceDay = ev ? new Date(ev.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const done = async () => { await qc.invalidateQueries({ queryKey: ['outlook'] }); onClose(); };
  const fail = (e) => { setError(e.response?.data?.error ?? 'Outlook didn\'t accept the change.'); if (e.response?.status === 409) q.refetch(); };

  const edit = async () => {
    if (!series) return setMode('occurrence');
    const scope = await ask({
      title: 'Edit a repeating event', confirmLabel: 'Edit',
      options: [
        { value: 'occurrence', label: 'Just this event', hint: occurrenceDay },
        { value: 'series', label: 'The whole series', hint: series.recurrence_text ?? 'Every event in the series' },
      ],
    });
    if (scope) { setError(''); setMode(scope); }
  };

  const remove = async () => {
    const scope = await ask(series ? {
      title: 'Delete a repeating event', confirmLabel: 'Delete', danger: true,
      options: [
        { value: 'occurrence', label: 'Just this event', hint: occurrenceDay },
        { value: 'following', label: 'This and all following events', hint: `From ${occurrenceDay} on — earlier ones stay` },
        { value: 'series', label: 'Every event in the series', hint: series.recurrence_text ?? '' },
      ],
    } : {
      title: 'Delete this event?', confirmLabel: 'Delete', danger: true, message: 'It will be removed from the shared Outlook calendar for everyone.',
      options: [{ value: 'occurrence', label: ev.title, hint: occurrenceDay }],
    });
    if (!scope) return;
    setSaving(true); setError('');
    try { await outlookApi.remove(eventId, { scope, etag: ev.etag }); await done(); }
    catch (e) { fail(e); } finally { setSaving(false); }
  };

  const save = async (f) => {
    const init = mode === 'series' ? formFromEvent(series, series.repeat) : formFromEvent(ev);
    const body = changes(f, init, mode);
    if (!Object.keys(body).length) return setMode('view');
    setSaving(true); setError('');
    try { await outlookApi.update(eventId, { ...body, scope: mode, etag: mode === 'series' ? undefined : ev.etag }); await done(); }
    catch (e) { fail(e); } finally { setSaving(false); }
  };

  const title = mode === 'series' ? 'Edit the series' : mode === 'occurrence' ? (series ? `Edit ${occurrenceDay}` : 'Edit event') : 'Outlook event';
  return (
    <Modal open onClose={onClose} title={title} size="md">
      {q.isLoading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading from Outlook…</p>
      ) : q.error ? (
        <p className="text-red-400 text-sm py-8 text-center">{q.error.response?.data?.error ?? 'Could not load the event from Outlook.'}</p>
      ) : mode !== 'view' ? (
        <EventForm key={mode} mode={mode} techs={techs} saving={saving} error={error}
          initial={mode === 'series' ? formFromEvent(series, series.repeat) : formFromEvent(ev)}
          submitLabel="Save to Outlook" onSubmit={save} onCancel={() => { setError(''); setMode('view'); }} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-100 break-words">{ev.title}</h2>
              <p className="text-sm text-gray-400">{whenLabel({ allDay: ev.all_day, start: new Date(ev.start), end: new Date(ev.end), startKey: ev.start_date, endKey: ev.end_date })}</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {series && <Row icon={Repeat}>{series.recurrence_text ?? 'Repeats'}</Row>}
            {ev.location && <Row icon={MapPin}>{ev.location}</Row>}
            <Row icon={User}>{ev.user_ids?.length ? ev.user_ids.map(techName).filter(Boolean).join(', ') : <span className="text-gray-500">Nobody in particular</span>}</Row>
            {!ev.private && <Row icon={Bell}>{reminderLabel(ev.reminder_minutes)}</Row>}
            <Row icon={CalendarDays}>{SHOW_AS_LABEL[ev.show_as] ?? 'Busy'} · shared Outlook calendar</Row>
            {ev.notes && <Row icon={AlignLeft}><span className="whitespace-pre-wrap">{ev.notes}</span></Row>}
          </div>
          {ev.private && <p className="text-sm text-gray-400 flex items-center gap-2 bg-surface-700/40 rounded-lg p-3"><Lock size={14} /> A private appointment — only its time shows here. Change it in Outlook.</p>}
          {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-surface-700">
            {!ev.private && <button onClick={remove} disabled={saving} className="btn-ghost text-sm flex items-center gap-1.5 mt-3 mr-auto text-gray-400 hover:text-red-400"><Trash2 size={14} /> Delete</button>}
            <button onClick={onClose} className="btn-secondary text-sm mt-3">Close</button>
            {!ev.private && <button onClick={edit} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5 mt-3"><Pencil size={14} /> Edit</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Something new at a time (or day): an Outlook event, or a task. */
export function NewItemDialog({ slot, techs, defaultTech, outlookOn, onClose, onTaskSaved }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState(outlookOn ? 'event' : 'task');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const createEvent = async (f) => {
    setSaving(true); setError('');
    try {
      await outlookApi.create({
        title: f.title, assign_to: f.assign_to || null, show_as: f.show_as, location: f.location, notes: f.notes,
        reminder_minutes: reminderOf(f), repeat: f.repeat, ...timesOf(f),
      });
      await qc.invalidateQueries({ queryKey: ['outlook'] });
      onClose();
    } catch (e) { setError(e.response?.data?.error ?? 'Outlook didn\'t accept the event.'); }
    finally { setSaving(false); }
  };

  const length = slot.allDay ? null : (slot.endMin ?? slot.startMin + 60) - slot.startMin;
  return (
    <Modal open onClose={onClose} title="New" size="lg">
      {outlookOn && (
        <div className="inline-flex rounded-lg bg-surface-700 p-0.5 mb-4" role="group" aria-label="What to add">
          {[['event', 'Outlook event', CalendarDays], ['task', 'Task', ListChecks]].map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${kind === k ? 'bg-brand text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              <Icon size={14} /> {l}
            </button>
          ))}
        </div>
      )}
      {kind === 'event' ? (
        <EventForm mode="create" techs={techs} saving={saving} error={error} initial={formFromSlot(slot, defaultTech)}
          submitLabel="Add to Outlook" onSubmit={createEvent} onCancel={onClose} />
      ) : (
        <TaskForm onClose={onClose} onSaved={onTaskSaved}
          defaults={{
            assigned_to: defaultTech ?? '', scheduled_date: slot.dateKey,
            ...(slot.allDay ? {} : { scheduled_time: hm(slot.startMin), duration_minutes: length }),
          }} />
      )}
    </Modal>
  );
}
