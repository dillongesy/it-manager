import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CalendarDays, Inbox, Repeat, RefreshCw, CheckCircle2, Plus, Lock } from 'lucide-react';
import { tasksApi } from '../../api/tasks.js';
import { outlookApi } from '../../api/outlook.js';
import {
  PRIORITY_DOT, taskFlags, taskNumber, dayKey, weekStart, addDays, todayKey, fromDayKey,
  monthStart, addMonths, monthWeeks, initials, tint, UNASSIGNED_COLOR,
} from '../../utils/tasks.js';
import { eventsByDay, eventStart, eventRange, eventDayKeys } from '../../utils/outlook.js';
import { minutesOf, parseHm, hm, timeLabel, lengthLabel, taskMinutes, atMinutes, daysBetweenKeys, shiftKey, DAY_MINUTES } from '../../utils/calendar.js';
import { DropZone, DRAG_TYPE, DRAG_EVENT, useAsk } from './calendar/shared.jsx';
import { TimeGrid } from './calendar/TimeGrid.jsx';
import { EventDialog, NewItemDialog } from './calendar/EventDialog.jsx';

// The schedule: tasks and the shared Outlook calendar together, coloured by tech, always seven
// days a week. Opens on Everyone · Month · this month every time (only the Outlook tickbox and
// whether "Not scheduled yet" is open are remembered).
//   Day / Week — an hour-by-hour grid (calendar/TimeGrid.jsx): drag to move, drag an edge to
//                change the length, drag across empty time to add something there.
//   Month      — a box per day; drag between days, double-click (or +) to add, click a date for that day.
//   Agenda     — the month as a list.
// On one tech's view (or Unassigned), dropping a task also assigns it to them, and "Not scheduled
// yet" lists the unassigned tasks too, so that's how work gets handed out.
// Outlook events (dashed) open in calendar/EventDialog.jsx — details, edit, delete — and any change
// to a repeating one asks "just this one or the whole series?" first. Events are never turned into
// tasks; a task put on Outlook ("Add to Outlook") shows once, as the task. Outlook is re-read every
// 20 seconds while the page is open.
// Phones (below md): Day keeps the grid (tap to open or add); Week and Agenda are lists; Month is a
// mini calendar with coloured dots over the picked day's list.
// Keys: T today · ←/→ back/forward · D W M A views · N new.

const OUTLOOK_KEY = 'app-tasks-outlook';
const PANEL_KEY = 'app-tasks-unscheduled';
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']];
const MONTH_CELL_LIMIT = 3;
const DOT_LIMIT = 4;
const OUTLOOK_POLL = 20_000;

const read = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const dateOf = (t) => String(t.scheduled_date ?? '').slice(0, 10);
const hoursOf = (tasks) => Math.round(tasks.filter(t => t.status !== 'done').reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0) * 100) / 100;
const byDate = (tasks) => { const m = new Map(); for (const t of tasks) { const k = dateOf(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return m; };
const weekOf = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const typing = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const dayLabel = (key) => fromDayKey(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

function Chip({ task, onOpen, color, large = false, compact = false, wrap = false, who = null }) {
  const f = taskFlags(task);
  const done = task.status === 'done';
  return (
    <button type="button" draggable
      onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpen(task)}
      title={`${taskNumber(task.number)} — ${task.title}${task.customer_name ? ` (${task.customer_name})` : ''}${task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}`}
      style={color ? { backgroundColor: tint(color, done ? 0.06 : 0.16), borderLeft: `3px solid ${color}` } : undefined}
      className={`w-full text-left rounded-md ${compact ? 'px-1.5 py-1' : large ? 'px-2.5 py-2' : 'px-2 py-1.5'} text-xs cursor-grab active:cursor-grabbing transition-opacity hover:opacity-80
        ${done ? 'text-gray-500' : 'text-gray-200'} ${color ? '' : done ? 'bg-surface-700/40' : 'bg-surface-700'}
        ${f.missed || f.overdue ? 'ring-1 ring-red-500/60' : ''}`}>
      <span className={`flex gap-1.5 min-w-0 ${wrap ? 'items-start' : 'items-center'}`}>
        {done
          ? <CheckCircle2 size={12} className={`shrink-0 text-green-500 ${wrap ? 'mt-[0.1rem]' : ''}`} aria-label="Done" />
          : <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority]} ${wrap ? (large ? 'mt-[0.45rem]' : 'mt-[0.35rem]') : ''}`} />}
        <span className={`${wrap ? 'line-clamp-2 break-words' : 'truncate'} ${done ? 'line-through' : ''} ${large ? 'text-sm' : ''}`}>
          {task.scheduled_time && <span className="text-gray-400">{timeLabel(parseHm(task.scheduled_time))} </span>}{task.title}
        </span>
        {who && <span className="ml-auto shrink-0 text-[10px] text-gray-500 font-medium leading-4">{who}</span>}
      </span>
      {!compact && (
        <span className="block truncate text-[11px] text-gray-500 mt-0.5">
          {task.customer_name ?? 'Internal'}{task.estimated_hours ? ` · ${Number(task.estimated_hours)}h` : ''}
        </span>
      )}
    </button>
  );
}

/** An Outlook event (dashed). Click to open it, drag to move it; private ones only show. */
function EventChip({ ev, color, onOpenEvent, compact = false, large = false, who = null }) {
  const c = color ?? UNASSIGNED_COLOR;
  const draggable = !ev.private && Boolean(onOpenEvent);
  return (
    <button type="button" draggable={draggable}
      onDragStart={e => { e.dataTransfer.setData(DRAG_EVENT, ev.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpenEvent?.(ev)}
      title={`${ev.title}\n${eventRange(ev)}${ev.location ? `\n${ev.location}` : ''}${ev.recurring ? '\nRepeats' : ''}\nShared Outlook calendar`}
      style={{ borderColor: tint(c, 0.8) }}
      className={`block w-full text-left rounded-md border border-dashed ${compact ? 'px-1.5 py-1' : large ? 'px-2.5 py-2' : 'px-2 py-1.5'} text-xs text-gray-300
        ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} hover:bg-surface-700/50`}>
      {!compact && (
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <CalendarDays size={11} className="shrink-0" style={{ color: c }} />
          {eventRange(ev)}
          {ev.recurring && <Repeat size={10} className="shrink-0" aria-label="Repeats" />}
          {ev.private && <Lock size={10} className="shrink-0" aria-label="Private" />}
          {who && <span className="ml-auto shrink-0 text-[10px] font-medium">{who}</span>}
        </span>
      )}
      <span className="flex items-start gap-1.5 min-w-0">
        {compact && <CalendarDays size={11} className="shrink-0 mt-[0.15rem]" style={{ color: c }} />}
        <span className={`line-clamp-2 break-words ${large ? 'text-sm' : ''} ${compact ? '' : 'mt-0.5'}`}>
          {compact && !ev.all_day && <span className="text-gray-500">{eventStart(ev)} </span>}{ev.title}
        </span>
        {compact && ev.recurring && <Repeat size={10} className="shrink-0 mt-[0.2rem] text-gray-500" aria-label="Repeats" />}
        {compact && who && <span className="ml-auto shrink-0 text-[10px] text-gray-500 font-medium leading-4">{who}</span>}
      </span>
      {!compact && ev.location && <span className="block truncate text-[11px] text-gray-500 mt-0.5">{ev.location}</span>}
    </button>
  );
}

const dayTone = (key, today) => (key === today ? 'bg-accent/[0.03]' : key < today ? 'bg-surface-900/20' : '');

/**
 * What goes in a day, in time order: all-day items first, then by start time. `render(entry,
 * props)` draws either kind; `dots(key)` gives the phone calendar's colour dots.
 */
function dayEntries({ tasks, events, colorOf, eventColor, who, eventWho, onOpen, onOpenEvent }) {
  const tasksOn = byDate(tasks);
  const startOf = (e) => (e.ev ? (e.ev.all_day ? -1 : minutesOf(new Date(e.ev.start))) : (e.t.scheduled_time ? parseHm(e.t.scheduled_time) : -1));
  const entries = (key) => [...(events.get(key) ?? []).map(ev => ({ ev })), ...(tasksOn.get(key) ?? []).map(t => ({ t }))]
    .sort((a, b) => startOf(a) - startOf(b));
  return {
    entries,
    hours: (key) => hoursOf(tasksOn.get(key) ?? []),
    dots: (key) => entries(key).map(e => (e.ev ? { color: eventColor(e.ev) ?? UNASSIGNED_COLOR, ring: true } : { color: colorOf(e.t), done: e.t.status === 'done' })),
    render: (e, props) => (e.ev
      ? <EventChip key={`e${e.ev.id}`} ev={e.ev} color={eventColor(e.ev)} who={eventWho(e.ev)} onOpenEvent={onOpenEvent} {...props} />
      : <Chip key={e.t.id} task={e.t} onOpen={onOpen} color={colorOf(e.t)} who={who(e.t)} {...props} />),
    open: (e) => (e.ev ? onOpenEvent(e.ev) : onOpen(e.t)),
    colorOf: (e) => (e.ev ? eventColor(e.ev) ?? UNASSIGNED_COLOR : colorOf(e.t)),
  };
}

function MonthGrid({ weeks, month, drop, onPickDay, onCreate, today, ...kit }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const { hours: hoursOn, entries, render } = dayEntries(kit);
  const inMonth = (d) => d.getMonth() === month.getMonth();

  return (
    <div className="card overflow-x-auto">
      <div className="grid min-w-[40rem]" style={{ gridTemplateColumns: 'repeat(7, minmax(5.5rem, 1fr))' }}>
        {DAY_NAMES.map((n, i) => (
          <div key={n} className={`px-2 py-2 border-b border-surface-600 text-xs text-gray-400 uppercase tracking-wide ${i ? 'border-l' : ''}`}>{n}</div>
        ))}
        {weeks.map(week => week.map((d, i) => {
          const key = dayKey(d);
          const items = entries(key);
          const open = expanded.has(key);
          const hours = hoursOn(key);
          return (
            <DropZone key={key} {...drop(key)}
              onDoubleClick={(e) => { if (!e.target.closest('button')) onCreate(key); }}
              className={`group min-w-0 border-b border-surface-700 p-1.5 space-y-1 min-h-[6.5rem] ${i ? 'border-l' : ''} ${inMonth(d) ? dayTone(key, today) : 'bg-surface-900/40'}`}>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => onPickDay(d)} title="Open this day"
                  className={`text-xs rounded px-1 -ml-0.5 hover:bg-surface-600 ${key === today ? 'bg-accent text-black font-bold hover:bg-accent' : inMonth(d) ? 'text-gray-300' : 'text-gray-600'}`}>
                  {d.getDate() === 1 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.getDate()}
                </button>
                {hours > 0 && <span className="text-[10px] text-gray-500">{hours}h</span>}
                <button type="button" onClick={() => onCreate(key)} title="Add something on this day" aria-label={`Add on ${dayLabel(key)}`}
                  className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-500 hover:text-gray-200 rounded p-0.5"><Plus size={13} /></button>
              </div>
              {/* No initials in a month box — it's too narrow; the colour and the tooltip say whose */}
              {(open ? items : items.slice(0, MONTH_CELL_LIMIT)).map(e => render(e, { compact: true, wrap: true, who: null }))}
              {items.length > MONTH_CELL_LIMIT && (
                <button type="button" onClick={() => toggle(key)} className="text-[11px] text-gray-400 hover:text-gray-200 px-1">
                  {open ? 'Show less' : `+${items.length - MONTH_CELL_LIMIT} more`}
                </button>
              )}
            </DropZone>
          );
        }))}
      </div>
    </div>
  );
}

/** When an entry is, for a list: "All day", "9:00 AM – 10:00 AM", "9:00 AM · 1 h 30 min". */
function entryTime(e) {
  if (e.ev) return e.ev.all_day ? 'All day' : eventRange(e.ev);
  return e.t.scheduled_time ? `${timeLabel(parseHm(e.t.scheduled_time))} · ${lengthLabel(taskMinutes(e.t))}` : 'All day';
}

/** A day-by-day list (Agenda, and the phone views). */
function AgendaList({ days, today, kit, showEmpty = false, empty = 'Nothing scheduled.', onPickDay }) {
  const shown = days.filter(d => showEmpty || kit.entries(dayKey(d)).length);
  if (!shown.length) return <p className="card text-sm text-gray-500 py-10 text-center">{empty}</p>;
  return (
    <div className="card divide-y divide-surface-700">
      {shown.map(d => {
        const key = dayKey(d);
        const items = kit.entries(key);
        return (
          <section key={key} id={`day-${key}`} className="flex gap-3 sm:gap-5 px-3 sm:px-4 py-3 scroll-mt-4">
            <button type="button" onClick={() => onPickDay?.(d)} title="Open this day" className="w-12 shrink-0 self-start text-left">
              <span className={`block text-2xl font-semibold leading-none ${key === today ? 'text-accent' : key < today ? 'text-gray-500' : 'text-gray-200'}`}>{d.getDate()}</span>
              <span className="block text-[11px] text-gray-500 uppercase mt-1">{d.toLocaleDateString([], { weekday: 'short' })}{key === today ? ' · Today' : ''}</span>
            </button>
            <div className="flex-1 min-w-0 space-y-0.5">
              {items.length ? items.map(e => (
                <button key={e.ev ? `e${e.ev.id}` : e.t.id} type="button" onClick={() => kit.open(e)}
                  className="w-full flex items-stretch gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-700/50">
                  <span className="w-24 sm:w-36 shrink-0 text-xs text-gray-400 pt-0.5">{entryTime(e)}</span>
                  <span className={`w-1 rounded-full shrink-0 ${e.ev ? 'opacity-70' : ''}`} style={{ backgroundColor: kit.colorOf(e) }} />
                  <span className="min-w-0 flex-1">
                    <span className={`flex items-center gap-1.5 text-sm ${e.t?.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                      {e.t?.status === 'done' && <CheckCircle2 size={13} className="text-green-500 shrink-0" />}
                      {e.ev && <CalendarDays size={12} className="text-gray-500 shrink-0" />}
                      <span className="truncate">{e.ev ? e.ev.title : e.t.title}</span>
                      {e.ev?.recurring && <Repeat size={11} className="text-gray-500 shrink-0" />}
                    </span>
                    <span className="block text-xs text-gray-500 truncate">
                      {e.ev ? [e.ev.location, 'Outlook'].filter(Boolean).join(' · ') : [taskNumber(e.t.number), e.t.customer_name ?? 'Internal', e.t.assigned_to_name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )) : <p className="text-xs text-gray-600 py-1.5 px-2">Nothing scheduled</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A phone calendar day's coloured dots: filled = a task, ring = an Outlook event. */
function Dots({ dots }) {
  if (!dots.length) return <span className="h-1.5" />;
  return (
    <span className="flex items-center justify-center gap-0.5 h-1.5">
      {dots.slice(0, DOT_LIMIT).map((d, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full"
          style={d.ring ? { boxShadow: `inset 0 0 0 1.5px ${d.color}` } : { backgroundColor: d.color, opacity: d.done ? 0.4 : 1 }} />
      ))}
      {dots.length > DOT_LIMIT && <span className="text-[9px] leading-none text-gray-500">+</span>}
    </span>
  );
}

/** Phone month: a mini calendar with dots; tap a day to list it underneath. */
function PhoneMonth({ weeks, month, selected, onSelect, today, kit }) {
  const inMonth = (d) => d.getMonth() === month.getMonth();
  return (
    <div className="space-y-4">
      <div className="card p-2">
        <div className="grid grid-cols-7 text-center text-[11px] text-gray-500 mb-1">
          {DAY_NAMES.map(n => <span key={n}>{n.slice(0, 2)}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {weeks.flat().map(d => {
            const key = dayKey(d);
            const isSel = key === selected;
            return (
              <button key={key} type="button" onClick={() => onSelect(key)} aria-pressed={isSel}
                aria-label={`${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}: ${kit.entries(key).length} scheduled`}
                className={`flex flex-col items-center gap-1 py-1.5 rounded-lg ${isSel ? 'bg-surface-600' : 'active:bg-surface-700'}`}>
                <span className={`text-sm w-7 h-7 leading-7 rounded-full ${key === today ? 'bg-accent text-black font-bold' : inMonth(d) ? 'text-gray-200' : 'text-gray-600'}`}>
                  {d.getDate()}
                </span>
                <Dots dots={kit.dots(key)} />
              </button>
            );
          })}
        </div>
      </div>
      <AgendaList days={[fromDayKey(selected)]} today={today} kit={kit} showEmpty />
    </div>
  );
}

/** Phone week: the seven days as a strip (tap to jump), over the whole week's list. */
function PhoneWeek({ days, today, kit }) {
  const jump = (key) => document.getElementById(`day-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="space-y-4">
      <div className="card p-1.5 grid grid-cols-7">
        {days.map((d, i) => {
          const key = dayKey(d);
          return (
            <button key={key} type="button" onClick={() => jump(key)} className="flex flex-col items-center gap-1 py-1.5 rounded-lg active:bg-surface-700">
              <span className="text-[11px] text-gray-500">{DAY_NAMES[i].slice(0, 2)}</span>
              <span className={`text-sm w-7 h-7 leading-7 rounded-full text-center ${key === today ? 'bg-accent text-black font-bold' : 'text-gray-200'}`}>{d.getDate()}</span>
              <Dots dots={kit.dots(key)} />
            </button>
          );
        })}
      </div>
      <AgendaList days={days} today={today} kit={kit} showEmpty />
    </div>
  );
}

/** "Not scheduled yet": a side panel on wide screens (collapses to a thin bar), a card underneath otherwise. */
function Unscheduled({ open, onToggle, tasks, render, onDropTask }) {
  return (
    <DropZone onDropTask={onDropTask} data-unschedule
      className={`shrink-0 card self-start w-full rounded-lg ${open ? 'xl:w-60 p-3' : 'p-3 xl:w-11 xl:px-1 xl:py-2'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        title={open ? 'Hide' : 'Show the tasks with no date yet'}
        className={`w-full flex items-center gap-1.5 text-sm font-medium text-gray-200 ${open ? '' : 'xl:flex-col xl:gap-2 xl:min-h-[12rem]'}`}>
        <Inbox size={14} className="text-gray-500 shrink-0" />
        <span className={open ? '' : 'xl:[writing-mode:vertical-rl] xl:rotate-180 whitespace-nowrap'}>Not scheduled yet</span>
        <span className="text-xs text-gray-400 bg-surface-700 rounded-full px-1.5 min-w-[1.25rem] text-center">{tasks.length}</span>
        <span className="ml-auto text-gray-500 xl:ml-0 xl:mt-auto">
          <span className="xl:hidden">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
          <span className="hidden xl:inline">{open ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</span>
        </span>
      </button>
      {open && (tasks.length === 0 ? (
        <p className="text-xs text-gray-500 py-4 text-center flex flex-col items-center gap-1"><CalendarDays size={16} /> Everything active is on the calendar.</p>
      ) : (
        <div className="space-y-1.5 mt-2 max-h-[50vh] xl:max-h-[65vh] overflow-y-auto pr-0.5">
          {tasks.map(t => render({ t }, { large: true, wrap: true }))}
        </div>
      ))}
    </DropZone>
  );
}

export function TaskCalendar({ techFilter, techs, colors, onOpen }) {
  const qc = useQueryClient();
  const today = todayKey();
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(() => fromDayKey(today));   // the day every view is built around
  const [showOutlook, setShowOutlook] = useState(() => read(OUTLOOK_KEY, '1') === '1');
  const [panelOpen, setPanelOpen] = useState(() => read(PANEL_KEY, '0') === '1');
  const [openEventId, setOpenEventId] = useState(null);
  const [newSlot, setNewSlot] = useState(null);
  const [ask, askDialog] = useAsk();
  const datePicker = useRef(null);
  const toggleOutlook = () => setShowOutlook(v => { write(OUTLOOK_KEY, v ? '0' : '1'); return !v; });
  const togglePanel = () => setPanelOpen(v => { write(PANEL_KEY, v ? '0' : '1'); return !v; });

  const anchorKey = dayKey(anchor);
  const monday = weekStart(anchor);
  const month = monthStart(anchor);
  const weeks = monthWeeks(month);
  const visibleDays = view === 'day' ? [anchor] : view === 'week' ? weekOf(monday) : weeks.flat();
  const from = dayKey(visibleDays[0]);
  const to = dayKey(visibleDays.at(-1));
  const assignedTo = techFilter || undefined;
  const everyone = !techFilter;
  // On one tech's view (or Unassigned) a drop also assigns the task to them.
  const assignTo = everyone ? undefined : techFilter === 'none' ? null : techFilter;
  const defaultTech = typeof assignTo === 'string' ? assignTo : '';
  const inMonth = (key) => fromDayKey(key).getMonth() === month.getMonth() && fromDayKey(key).getFullYear() === month.getFullYear();

  const rangeQ = useQuery({
    queryKey: ['tasks', 'calendar', from, to, assignedTo],
    queryFn: () => tasksApi.list({ status: 'all', scheduledFrom: from, scheduledTo: to, assignedTo, sort: 'scheduled', limit: 1000 }).then(r => r.data),
  });
  // Every unscheduled task; one tech's view lists theirs plus the unassigned ones.
  const backlogQ = useQuery({
    queryKey: ['tasks', 'unscheduled', 'all'],
    queryFn: () => tasksApi.list({ status: 'active', unscheduled: '1', sort: 'priority' }).then(r => r.data),
  });
  // Outlook is re-read every 20 seconds while the page is open (and on coming back to the tab).
  const outlookKey = ['outlook', from, to];
  const outlookRange = { start: fromDayKey(from).toISOString(), end: addDays(fromDayKey(to), 1).toISOString() };
  const outlookQ = useQuery({
    queryKey: outlookKey,
    queryFn: () => outlookApi.events(outlookRange).then(r => r.data),
    staleTime: 10_000, refetchInterval: OUTLOOK_POLL, refetchOnWindowFocus: true, retry: false,
  });
  const refreshOutlook = async () => qc.setQueryData(outlookKey, (await outlookApi.events({ ...outlookRange, refresh: 1 })).data);
  const tasks = rangeQ.data ?? [];
  const unscheduled = (backlogQ.data ?? []).filter(t => everyone || !t.assigned_to || String(t.assigned_to) === techFilter);

  const outlook = outlookQ.data;
  const outlookConfigured = Boolean(outlook?.configured);
  const outlookOn = outlookConfigured && showOutlook;
  const ownEvents = !outlookOn ? [] : outlook.events.filter(ev => !ev.task_id);
  const visibleEvents = everyone ? ownEvents
    : techFilter === 'none' ? [] : ownEvents.filter(ev => ev.user_ids?.some(id => String(id) === techFilter));
  const events = eventsByDay(visibleEvents);

  const colorOf = (t) => (t.assigned_to ? colors.get(String(t.assigned_to)) ?? UNASSIGNED_COLOR : UNASSIGNED_COLOR);
  const eventColor = (ev) => (ev.user_ids?.length ? colors.get(String(ev.user_ids[0])) ?? null : null);
  const nameOf = (id) => techs.find(u => String(u.id) === String(id))?.full_name;
  const who = (t) => (everyone && t.assigned_to_name ? initials(t.assigned_to_name) : null);
  const eventWho = (ev) => (everyone && ev.user_ids?.length ? ev.user_ids.map(id => initials(nameOf(id))).filter(Boolean).join(' ') : null);
  const personName = techFilter === 'none' ? 'Unassigned' : nameOf(techFilter);
  const planned = hoursOf(view === 'month' || view === 'agenda' ? tasks.filter(t => inMonth(dateOf(t))) : tasks);
  const openEvent = (ev) => setOpenEventId(ev.id);
  const kit = { tasks, events, colorOf, eventColor, who, eventWho, onOpen, onOpenEvent: openEvent, today };
  const entriesKit = dayEntries(kit);

  // ── Changing things ──
  const moveTask = async (id, patch) => {
    const withTech = assignTo === undefined ? patch : { ...patch, assigned_to: assignTo };
    try {
      const { data } = await tasksApi.update(id, withTech);
      if (data.outlook_warning) alert(data.outlook_warning);
    } catch (e) { alert(e.response?.data?.error ?? 'Could not move that task.'); }
    finally { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['outlook'] }); }
  };
  const findEvent = (id) => outlook?.events.find(e => e.id === id);

  /** Send an event change to Outlook, showing it in its new place straight away. */
  const sendEvent = async (ev, body, shown) => {
    if (shown) qc.setQueryData(outlookKey, d => d && { ...d, events: d.events.map(e => (e.id === ev.id ? { ...e, ...shown } : e)) });
    try { await outlookApi.update(ev.id, body); }
    catch (e) { alert(e.response?.data?.error ?? 'Outlook didn\'t accept the change.'); }
    finally { qc.invalidateQueries({ queryKey: ['outlook'] }); }
  };

  /** Move an event to a day (all-day) or a day + time. A repeating one asks this-one-or-series first. */
  const moveEvent = async (ev, target) => {
    const firstKey = eventDayKeys(ev)[0];
    const shift = daysBetweenKeys(firstKey, target.dateKey);
    const occ = target.allDay
      ? { all_day: true, start_date: target.dateKey, end_date: shiftKey(target.dateKey, ev.all_day ? daysBetweenKeys(ev.start_date, ev.end_date) : 0) }
      : { all_day: false, start: atMinutes(target.dateKey, target.startMin).toISOString(), end: atMinutes(target.dateKey, target.endMin).toISOString() };
    const tech = typeof assignTo === 'string' && String(ev.user_ids?.[0] ?? '') !== assignTo ? { assign_to: assignTo } : {};
    let body = { scope: 'occurrence', etag: ev.etag, ...occ, ...tech };
    if (ev.recurring) {
      const switching = Boolean(target.allDay) !== Boolean(ev.all_day);
      const what = shift && !target.allDay && !ev.all_day && target.startMin !== minutesOf(new Date(ev.start)) ? `${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'}, at ${timeLabel(target.startMin)}`
        : shift ? `${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'}` : `to ${timeLabel(target.startMin)}`;
      const scope = await ask({
        title: 'Move a repeating event', confirmLabel: 'Move',
        options: [
          { value: 'occurrence', label: 'Just this event', hint: `${dayLabel(firstKey)} → ${dayLabel(target.dateKey)}` },
          { value: 'series', label: 'The whole series', disabled: switching, hint: switching ? 'A whole series can\'t switch between all-day and timed here — do that in Outlook.' : `Every event moves ${what}` },
        ],
      });
      if (!scope) return;
      if (scope === 'series') {
        body = { scope: 'series', ...(shift ? { shift_days: shift } : {}), ...(!ev.all_day ? { start_time: hm(target.startMin), end_time: hm(Math.min(target.endMin, DAY_MINUTES - 1)) } : {}), ...tech };
        return sendEvent(ev, body, null);
      }
    }
    return sendEvent(ev, body, { ...occ, ...(tech.assign_to ? { user_ids: [tech.assign_to] } : {}) });
  };

  const resizeEvent = async (ev, { dateKey: key, startMin, endMin }) => {
    const occ = { all_day: false, start: ev.start, end: atMinutes(key, endMin).toISOString() };
    if (ev.recurring) {
      const scope = await ask({
        title: 'Change a repeating event', confirmLabel: 'Change',
        options: [
          { value: 'occurrence', label: 'Just this event', hint: `${dayLabel(key)} · ends ${timeLabel(endMin % DAY_MINUTES)}` },
          { value: 'series', label: 'The whole series', hint: `Every event runs ${timeLabel(startMin)} – ${timeLabel(endMin % DAY_MINUTES)}` },
        ],
      });
      if (!scope) return;
      if (scope === 'series') return sendEvent(ev, { scope: 'series', start_time: hm(startMin), end_time: hm(Math.min(endMin, DAY_MINUTES - 1)) }, null);
    }
    return sendEvent(ev, { scope: 'occurrence', etag: ev.etag, ...occ }, occ);
  };

  // What the grid / month / panels do with a drop or a drag.
  const drop = (key) => ({
    onDropTask: (id) => moveTask(id, { scheduled_date: key }),
    onDropEvent: outlookOn ? (id) => {
      const ev = findEvent(id); if (!ev) return;
      if (ev.all_day) return moveEvent(ev, { dateKey: key, allDay: true });
      const s = new Date(ev.start), len = Math.round((new Date(ev.end) - s) / 60_000);
      return moveEvent(ev, { dateKey: key, startMin: minutesOf(s), endMin: Math.min(minutesOf(s) + len, DAY_MINUTES) });
    } : undefined,
  });
  const allDayDrop = (key) => ({
    onDropTask: (id) => moveTask(id, { scheduled_date: key, scheduled_time: null }),
    onDropEvent: outlookOn ? (id) => { const ev = findEvent(id); if (ev) moveEvent(ev, { dateKey: key, allDay: true }); } : undefined,
  });
  const grid = {
    onOpen: (entry) => (entry.kind === 'task' ? onOpen(entry.task) : openEvent(entry.ev)),
    onCreate: (slot) => setNewSlot(slot),
    onMove: (entry, target) => {
      if (entry.kind === 'event') return moveEvent(entry.ev, target);
      return moveTask(entry.task.id, target.allDay
        ? { scheduled_date: target.dateKey, scheduled_time: null }
        : { scheduled_date: target.dateKey, scheduled_time: hm(target.startMin), duration_minutes: target.endMin - target.startMin });
    },
    onResize: (entry, r) => (entry.kind === 'event' ? resizeEvent(entry.ev, r) : moveTask(entry.task.id, { duration_minutes: r.endMin - r.startMin })),
    onUnschedule: (entry) => { if (entry.kind === 'task') moveTask(entry.task.id, { scheduled_date: null }); },
    onDropExternal: ({ kind, id, dateKey: key, startMin }) => {
      if (kind === 'task') return moveTask(id, { scheduled_date: key, scheduled_time: hm(startMin) });
      const ev = findEvent(id); if (!ev) return undefined;
      const len = ev.all_day ? 60 : Math.round((new Date(ev.end) - new Date(ev.start)) / 60_000);
      return moveEvent(ev, { dateKey: key, startMin, endMin: Math.min(startMin + len, DAY_MINUTES) });
    },
  };

  // The day/week grid's timed items (an event over several days shows a piece on each).
  const gridItems = [];
  if (view === 'day' || view === 'week') {
    const keys = new Set(visibleDays.map(dayKey));
    for (const t of tasks) {
      if (!t.scheduled_time || !keys.has(dateOf(t))) continue;
      const start = parseHm(t.scheduled_time);
      gridItems.push({
        key: `t${t.id}`, kind: 'task', entry: { kind: 'task', task: t }, dayKey: dateOf(t), start, end: Math.min(start + taskMinutes(t), DAY_MINUTES),
        title: t.title, sub: [taskNumber(t.number), t.customer_name ?? 'Internal'].join(' · '), who: who(t), color: colorOf(t),
        done: t.status === 'done', movable: true, resizable: true,
      });
    }
    for (const ev of visibleEvents) {
      if (ev.all_day) continue;
      const spans = eventDayKeys(ev);
      const s = new Date(ev.start), e = new Date(ev.end);
      for (const k of spans) {
        if (!keys.has(k)) continue;
        const single = spans.length === 1;
        gridItems.push({
          key: `e${ev.id}:${k}`, kind: 'event', entry: { kind: 'event', ev }, dayKey: k,
          start: k === spans[0] ? minutesOf(s) : 0, end: k === spans.at(-1) ? (minutesOf(e) || DAY_MINUTES) : DAY_MINUTES,
          title: ev.title, sub: ev.location, who: eventWho(ev), color: eventColor(ev) ?? UNASSIGNED_COLOR, dashed: true,
          recurring: ev.recurring, locked: ev.private, movable: single && !ev.private, resizable: single && !ev.private,
        });
      }
    }
  }
  const allDayFor = (key) => entriesKit.entries(key)
    .filter(e => (e.ev ? e.ev.all_day : !e.t.scheduled_time))
    .map(e => entriesKit.render(e, { compact: true, wrap: true }));

  // ── Moving around ──
  const step = (n) => setAnchor(a => (view === 'day' ? addDays(a, n) : view === 'week' ? addDays(a, 7 * n) : addMonths(a, n)));
  const goToday = () => setAnchor(fromDayKey(todayKey()));
  const pickDay = (d) => { setAnchor(d); setView('day'); };
  const nextSlot = () => {
    const now = new Date();
    const start = anchorKey === today ? Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30, DAY_MINUTES - 60) : 9 * 60;
    return { dateKey: anchorKey, startMin: start, endMin: start + 60 };
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement) || document.querySelector('[role=dialog]')) return;
      const k = e.key.toLowerCase();
      if (k === 't') goToday();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'a') setView('agenda');
      else if (k === 'n') setNewSlot(nextSlot());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const label = view === 'day'
    ? anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'week'
      ? `${monday.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(monday, 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
      : month.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';

  return (
    <div className="flex flex-col xl:flex-row gap-4">
      <div className="flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={goToday} className="btn-secondary px-3 py-1.5 md:py-1 text-sm" title="Today (T)">Today</button>
          <div className="inline-flex items-center">
            <button onClick={() => step(-1)} className="btn-ghost p-2 md:p-1.5" title={`Previous ${unit} (←)`} aria-label={`Previous ${unit}`}><ChevronLeft size={16} /></button>
            <button onClick={() => step(1)} className="btn-ghost p-2 md:p-1.5" title={`Next ${unit} (→)`} aria-label={`Next ${unit}`}><ChevronRight size={16} /></button>
          </div>
          <span className="relative">
            <button type="button" onClick={() => { try { datePicker.current?.showPicker(); } catch { datePicker.current?.focus(); } }}
              className="text-base md:text-lg font-semibold text-gray-100 hover:text-white inline-flex items-center gap-1" title="Jump to a date">
              {label} <ChevronDown size={14} className="text-gray-500" />
            </button>
            <input ref={datePicker} type="date" tabIndex={-1} aria-hidden="true" className="absolute left-0 top-full w-0 h-0 opacity-0"
              value={anchorKey} onChange={e => e.target.value && setAnchor(fromDayKey(e.target.value))} />
          </span>
          {!everyone && planned > 0 && <span className="text-xs text-gray-500 hidden sm:inline">{personName} · {planned}h planned</span>}

          <div className="w-full md:w-auto md:ml-auto flex items-center gap-2">
            <div className="inline-flex rounded-md bg-surface-700 p-0.5 flex-1 md:flex-none" role="group" aria-label="Calendar view">
              {VIEWS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} title={`${l} (${l[0]})`}
                  className={`flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded text-sm font-medium transition-colors ${view === v ? 'bg-surface-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => setNewSlot(nextSlot())} className="btn-primary px-3 py-1.5 md:py-1 text-sm inline-flex items-center gap-1.5" title="New (N)">
              <Plus size={15} /> <span className="hidden sm:inline">New</span>
            </button>
          </div>
        </div>

        {outlookConfigured && (
          <div className="flex items-center gap-2 mb-2 text-xs text-gray-400">
            <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Show the shared Outlook calendar">
              <input type="checkbox" className="accent-brand" checked={showOutlook} onChange={toggleOutlook} />
              <span className="inline-block w-3 h-2.5 rounded-sm border border-dashed border-gray-400" /> Outlook calendar
            </label>
            {showOutlook && (
              <button type="button" onClick={refreshOutlook} className="btn-ghost p-1 text-gray-500 inline-flex items-center gap-1" title="Check Outlook now (it's also checked every 20 seconds)" aria-label="Check Outlook now">
                <RefreshCw size={12} className={outlookQ.isFetching ? 'animate-spin' : ''} />
              </button>
            )}
            {outlookOn && outlook.error && <span className="text-amber-400 truncate">{outlook.error}</span>}
          </div>
        )}

        {/* Day / week grid — on a phone the day view keeps it; the week becomes a list */}
        {(view === 'day' || view === 'week') && (
          <div className={view === 'week' ? 'hidden md:block' : ''}>
            <TimeGrid days={visibleDays} today={today} items={gridItems} allDay={allDayFor} allDayDrop={allDayDrop} onPickDay={pickDay} {...grid} />
          </div>
        )}
        {view === 'week' && <div className="md:hidden"><PhoneWeek days={visibleDays} today={today} kit={entriesKit} /></div>}

        {view === 'month' && (
          <>
            <div className="hidden md:block">
              <MonthGrid {...kit} weeks={weeks} month={month} drop={drop} onPickDay={pickDay} onCreate={(key) => setNewSlot({ dateKey: key, allDay: true, startMin: 9 * 60, endMin: 10 * 60 })} />
            </div>
            <div className="md:hidden">
              <PhoneMonth weeks={weeks} month={month} selected={inMonth(anchorKey) ? anchorKey : dayKey(month)} today={today} kit={entriesKit}
                onSelect={(key) => { setAnchor(fromDayKey(key)); requestAnimationFrame(() => document.getElementById(`day-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }} />
            </div>
          </>
        )}
        {view === 'agenda' && (
          <AgendaList days={weeks.flat().filter(d => inMonth(dayKey(d)))} today={today} kit={entriesKit} onPickDay={pickDay} empty="Nothing scheduled this month." />
        )}

        {rangeQ.isLoading && <p className="text-gray-500 text-xs mt-2">Loading…</p>}
        <p className="text-xs text-gray-500 mt-2 hidden md:block">
          {view === 'day' || view === 'week'
            ? 'Drag to move · drag the bottom edge to change the length · drag across empty time to add · drop on "All day" to take the time off.'
            : 'Drag between days to move · double-click a day (or +) to add · click a date to open that day.'}
          {' '}{everyone ? 'To hand work to someone, pick them above and drag from "Not scheduled yet".' : techFilter === 'none' ? '' : `Dropping a task here makes it ${personName}'s.`}
          {outlookOn && ' Dashed = shared Outlook calendar.'}
          {' '}Keys: T · ← → · D W M A · N.
        </p>
      </div>

      <Unscheduled open={panelOpen} onToggle={togglePanel} tasks={unscheduled}
        render={entriesKit.render} onDropTask={id => moveTask(id, { scheduled_date: null })} />

      {openEventId && <EventDialog eventId={openEventId} techs={techs} colors={colors} ask={ask} onClose={() => setOpenEventId(null)} />}
      {newSlot && (
        <NewItemDialog slot={newSlot} techs={techs} defaultTech={defaultTech} outlookOn={outlookOn} onClose={() => setNewSlot(null)}
          onTaskSaved={() => { setNewSlot(null); qc.invalidateQueries({ queryKey: ['tasks'] }); }} />
      )}
      {askDialog}
    </div>
  );
}
