import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Flag, Clock, Hourglass } from 'lucide-react';
import api from '../../api/client.js';
import { formatDate } from '../../utils/date.js';
import {
  STATUS_LABEL, STATUS_BADGE, PRIORITY_LABEL, PRIORITY_BADGE, WAITING_LABEL, taskFlags, relativeDays, UNASSIGNED_COLOR,
} from '../../utils/tasks.js';
import { timeLabel, parseHm, lengthLabel, taskMinutes } from '../../utils/calendar.js';

// Small pieces shared by the task list, calendar, overview, detail and dashboard.

/** Active technicians (everyone but billers) — the people tasks get assigned to. */
export function useTechs() {
  const { data = [] } = useQuery({
    queryKey: ['users', 'techs'],
    queryFn: () => api.get('/users').then(r => r.data.filter(u => u.is_active && u.role !== 'biller')),
    staleTime: 5 * 60_000,
  });
  return data;
}

/** Refresh every task view (lists, calendar, overview, dashboard, customer tab) after a change. */
export function useRefreshTasks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['tasks'] });
}

export function StatusBadge({ task, className = '' }) {
  const label = task.status === 'waiting' && task.waiting_on ? `Waiting on ${WAITING_LABEL[task.waiting_on]}` : STATUS_LABEL[task.status];
  return <span className={`badge ${STATUS_BADGE[task.status] ?? ''} ${className}`}>{label ?? task.status}</span>;
}

export function PriorityBadge({ priority, hideNormal = true }) {
  if (hideNormal && (!priority || priority === 'normal')) return null;
  return <span className={`badge ${PRIORITY_BADGE[priority]} inline-flex items-center gap-1`}><Flag size={10} /> {PRIORITY_LABEL[priority]}</span>;
}

/** The scheduled / due / estimate line, coloured by the task's flags. */
export function TaskDates({ task, className = '' }) {
  const f = taskFlags(task);
  const parts = [];
  if (task.scheduled_date) {
    parts.push(
      <span key="s" className={`inline-flex items-center gap-1 ${f.missed ? 'text-red-400' : ''}`} title={f.missed ? 'The scheduled day has passed' : 'Scheduled'}>
        <CalendarDays size={12} /> {formatDate(task.scheduled_date)}{task.scheduled_time && ` · ${timeLabel(parseHm(task.scheduled_time))} (${lengthLabel(taskMinutes(task))})`}{f.missed && ' (missed)'}
      </span>);
  }
  if (task.due_date) {
    const tone = f.overdue ? 'text-red-400 font-medium' : f.due_soon ? 'text-amber-400' : '';
    parts.push(
      <span key="d" className={`inline-flex items-center gap-1 ${tone}`} title="Due date">
        <Clock size={12} /> Due {formatDate(task.due_date)}{task.status !== 'done' && ` · ${f.overdue ? `${-f.due_in} day${f.due_in === -1 ? '' : 's'} overdue` : relativeDays(f.due_in)}`}
      </span>);
  }
  if (task.estimated_hours != null && task.estimated_hours !== '') {
    parts.push(<span key="h" className="inline-flex items-center gap-1" title="Estimated hours"><Hourglass size={12} /> {Number(task.estimated_hours)}h</span>);
  }
  if (!parts.length) return null;
  return <span className={`flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-gray-500 ${className}`}>{parts}</span>;
}

/** Status filter chips: Active (everything not done) / each status / All. */
export function StatusChips({ value, onChange }) {
  const opts = [['active', 'Active'], ['open', 'Open'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done'], ['all', 'All']];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {opts.map(([id, label]) => (
        <button key={id} type="button" onClick={() => onChange(id)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${value === id ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Tech filter chips: All / Unassigned / each tech. Value '' = all, 'none' = unassigned, else a user id. */
/** Tech filter chips. With `colors` (id → colour, see techColors) each shows its dot, doubling as the calendar's legend. */
export function TechChips({ value, onChange, techs, includeUnassigned = true, colors = null }) {
  const chip = (id, label, color) => (
    <button key={id || 'all'} type="button" onClick={() => onChange(id)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${value === id ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'}`}>
      {color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      {label}
    </button>
  );
  return (
    // Phones: one row that scrolls sideways instead of three rows of chips
    <div className="flex items-center gap-1 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto overscroll-x-contain sm:flex-wrap max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
      <span className="text-xs text-gray-600 mr-1 shrink-0">Tech:</span>
      {chip('', 'Everyone')}
      {techs.map(u => chip(String(u.id), u.full_name, colors?.get(String(u.id))))}
      {includeUnassigned && chip('none', 'Unassigned', colors ? UNASSIGNED_COLOR : null)}
    </div>
  );
}
