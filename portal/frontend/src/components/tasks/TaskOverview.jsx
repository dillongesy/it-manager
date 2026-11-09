import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, Hourglass, UserX, CheckCircle2, ListChecks, FolderKanban, Flag } from 'lucide-react';
import { tasksApi } from '../../api/tasks.js';
import { STATUS_LABEL, STATUS_BADGE, WAITING_LABEL, PRIORITY_DOT, taskNumber, relativeDays, IDLE_DAYS } from '../../utils/tasks.js';
import { formatDate } from '../../utils/date.js';

// The Overview: who's on what, what's late, what's been sitting. Numbers come from
// GET /api/tasks/summary (backend lib/tasks.js summarize).

function Tile({ icon: Icon, label, value, tone = 'text-gray-100', onClick, hint }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="card p-3 text-left hover:bg-surface-700/40 disabled:hover:bg-transparent transition-colors">
      <p className="text-xs text-gray-500 flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>}
    </button>
  );
}

function MiniList({ title, icon: Icon, items, empty, onOpen, render }) {
  return (
    <div className="card p-3 min-w-0">
      <p className="text-sm font-medium text-gray-200 flex items-center gap-1.5 mb-2"><Icon size={14} className="text-gray-500" /> {title} <span className="text-gray-500 font-normal">({items.length})</span></p>
      {items.length === 0 ? <p className="text-xs text-gray-500 py-3">{empty}</p> : (
        <ul className="divide-y divide-surface-700">
          {items.map(t => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t)} className="w-full text-left py-2 hover:bg-surface-700/30 rounded-sm px-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority]}`} />
                  <span className="text-xs font-mono text-gray-500 shrink-0">{taskNumber(t.number)}</span>
                  <span className="text-sm text-gray-200 truncate">{t.title}</span>
                </span>
                <span className="block text-xs text-gray-500 mt-0.5 truncate">
                  {t.customer_name ?? 'Internal'} · {t.assigned_to_name ?? 'Unassigned'} · {render(t)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskOverview({ onOpen, onFilter }) {
  const { data: s, isLoading, error } = useQuery({
    queryKey: ['tasks', 'summary'],
    queryFn: () => tasksApi.summary().then(r => r.data),
    staleTime: 15_000,
  });
  if (isLoading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error || !s) return <p className="text-red-400 text-sm py-8 text-center">Could not load the overview.</p>;

  const t = s.totals;
  const maxActive = Math.max(1, ...s.workload.map(w => w.active));
  const waiting = Object.entries(s.waiting_on).filter(([, n]) => n > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile icon={ListChecks} label="Active" value={t.active} onClick={() => onFilter({ status: 'active', tech: '' })} hint={`${t.projects} project${t.projects !== 1 ? 's' : ''}`} />
        <Tile icon={AlertTriangle} label="Overdue" value={t.overdue} tone={t.overdue ? 'text-red-400' : 'text-gray-100'} />
        <Tile icon={Clock} label="Due in 3 days" value={t.due_soon} tone={t.due_soon ? 'text-amber-400' : 'text-gray-100'} />
        <Tile icon={Hourglass} label={`Idle ${IDLE_DAYS}+ days`} value={t.idle} tone={t.idle ? 'text-amber-400' : 'text-gray-100'} />
        <Tile icon={UserX} label="Unassigned" value={t.unassigned} onClick={() => onFilter({ status: 'active', tech: 'none' })} />
        <Tile icon={CheckCircle2} label="Done this week" value={t.done_this_week} tone="text-green-400" onClick={() => onFilter({ status: 'done', tech: '' })} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-3 lg:col-span-2 overflow-x-auto min-w-0">
          <p className="text-sm font-medium text-gray-200 mb-2">Workload by tech</p>
          <table className="w-full text-sm min-w-[34rem]">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-surface-600">
                <th className="text-left font-medium py-1.5">Tech</th>
                <th className="text-left font-medium py-1.5 px-2 w-1/4">Active</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">In progress</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">Waiting</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">Overdue</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">This week</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">Est. hours</th>
                <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">Done (wk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {s.workload.map(w => (
                <tr key={w.user_id ?? 'none'} className="hover:bg-surface-700/30 cursor-pointer" onClick={() => onFilter({ status: 'active', tech: w.user_id ? String(w.user_id) : 'none' })}>
                  <td className={`py-2 ${w.user_id ? 'text-gray-200' : 'text-gray-500 italic'}`}>{w.name}</td>
                  <td className="py-2 px-2">
                    <span className="flex items-center gap-2">
                      <span className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden"><span className="block h-full bg-brand/70" style={{ width: `${(w.active / maxActive) * 100}%` }} /></span>
                      <span className="text-gray-300 w-6 text-right">{w.active}</span>
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.in_progress || '—'}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.waiting || '—'}</td>
                  <td className={`py-2 px-2 text-right ${w.overdue ? 'text-red-400 font-medium' : 'text-gray-500'}`}>{w.overdue || '—'}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.scheduled_this_week || '—'}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.estimated_hours ? `${w.estimated_hours}h` : '—'}</td>
                  <td className="py-2 px-2 text-right text-green-400">{w.done_this_week || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="card p-3">
            <p className="text-sm font-medium text-gray-200 mb-2">By status</p>
            <div className="space-y-1.5">
              {Object.entries(s.by_status).filter(([k]) => k !== 'done').map(([k, n]) => (
                <button key={k} type="button" onClick={() => onFilter({ status: k, tech: '' })} className="w-full flex items-center justify-between text-sm hover:bg-surface-700/30 rounded-sm px-1 py-0.5">
                  <span className={`badge ${STATUS_BADGE[k]}`}>{STATUS_LABEL[k]}</span>
                  <span className="text-gray-300">{n}</span>
                </button>
              ))}
            </div>
          </div>
          {waiting.length > 0 && (
            <div className="card p-3">
              <p className="text-sm font-medium text-gray-200 mb-2">Waiting on</p>
              {waiting.map(([k, n]) => (
                <p key={k} className="flex justify-between text-sm py-0.5"><span className="text-gray-400 capitalize">{WAITING_LABEL[k]}</span><span className="text-gray-300">{n}</span></p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <MiniList title="Overdue" icon={AlertTriangle} items={s.overdue} empty="Nothing is past due." onOpen={onOpen}
          render={x => <span className="text-red-400">due {formatDate(x.due_date)}</span>} />
        <MiniList title="Urgent & high priority" icon={Flag} items={s.urgent} empty="No urgent or high-priority work." onOpen={onOpen}
          render={x => (x.due_date ? `due ${formatDate(x.due_date)}` : STATUS_LABEL[x.status])} />
        <MiniList title="Sitting the longest" icon={Hourglass} items={s.idle} empty={`Nothing has gone ${IDLE_DAYS} days without an update.`} onOpen={onOpen}
          render={x => <span className="text-amber-400">no update {relativeDays(-x.flags.idle_days)}</span>} />
      </div>
      {t.projects > 0 && (
        <button type="button" onClick={() => onFilter({ status: 'active', tech: '', kind: 'project' })} className="text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1">
          <FolderKanban size={12} /> See the {t.projects} active project{t.projects !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
