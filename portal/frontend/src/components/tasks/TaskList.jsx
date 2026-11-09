import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, FolderKanban, Building2, ListChecks } from 'lucide-react';
import { tasksApi } from '../../api/tasks.js';
import { DragList } from '../ui/DragList.jsx';
import { DoneCheck } from '../ui/DoneCheck.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { PRIORITY_DOT, taskNumber, taskFlags } from '../../utils/tasks.js';
import { StatusBadge, PriorityBadge, TaskDates } from './taskBits.jsx';

// The queue: a list of tasks, drag-to-rank when sorted by queue order (lower = sooner).
// Used by the Tasks page and a customer's Tasks tab. `params` go straight to GET /api/tasks.

export function TaskRow({ task, onOpen, onToggle, handle, showCustomer = true }) {
  const f = taskFlags(task);
  const done = task.status === 'done';
  const edge = f.overdue ? 'border-l-red-500' : task.priority === 'urgent' ? 'border-l-red-400/70' : task.priority === 'high' ? 'border-l-orange-400/60' : 'border-l-transparent';
  return (
    <div className={`card border-l-2 ${edge} px-3 py-2.5 flex items-start gap-2.5 hover:bg-surface-700/40 transition-colors`}>
      {handle && <div className="pt-1">{handle}</div>}
      <div className="pt-0.5" onClick={e => e.stopPropagation()}><DoneCheck done={done} onToggle={() => onToggle(task)} size={18} /></div>
      <button type="button" onClick={() => onOpen(task)} className="flex-1 min-w-0 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`h-2 w-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority]}`} title={`${task.priority} priority`} />
          <span className="text-xs font-mono text-gray-500">{taskNumber(task.number)}</span>
          <span className={`font-medium break-words ${done ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{task.title}</span>
          {task.kind === 'project' && <span className="badge bg-blue-900/30 text-blue-300 inline-flex items-center gap-1"><FolderKanban size={10} /> Project</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-gray-500">
          {showCustomer && (task.customer_id
            ? <span className="text-gray-300">{task.customer_name}{task.location_name ? <span className="text-gray-500"> · {task.location_name}</span> : null}</span>
            : <span className="inline-flex items-center gap-1 text-gray-400"><Building2 size={11} /> Internal</span>)}
          <StatusBadge task={task} />
          <PriorityBadge priority={task.priority} />
          {task.assigned_to_name
            ? <span className="badge bg-brand/15 text-brand">{task.assigned_to_name}</span>
            : <span className="badge bg-surface-700 text-gray-500">Unassigned</span>}
          {task.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} /> {task.comment_count}</span>}
          {f.idle && !done && <span className="text-amber-500/80" title="No updates in a while">idle {f.idle_days}d</span>}
        </div>
        <TaskDates task={task} className="mt-1" />
        {task.notes_preview && <p className="text-xs text-gray-500 mt-1 line-clamp-1">{task.notes_preview}</p>}
      </button>
    </div>
  );
}

export function TaskList({ params, draggable = false, onOpen, showCustomer = true, empty }) {
  const qc = useQueryClient();
  const key = ['tasks', 'list', params];
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => tasksApi.list(params).then(r => r.data),
    staleTime: 10_000,
  });

  // Ticking a task done (or un-done) shows at once; the list refetches after.
  const toggle = async (t) => {
    const status = t.status === 'done' ? 'open' : 'done';
    qc.setQueryData(key, (old = []) => old.map(x => (x.id === t.id ? { ...x, status } : x)));
    try { await tasksApi.update(t.id, { status }); }
    finally { qc.invalidateQueries({ queryKey: ['tasks'] }); }
  };
  const reorder = async (items) => {
    qc.setQueryData(key, items);
    try { await tasksApi.reorder(items.map(i => i.id)); }
    finally { qc.invalidateQueries({ queryKey: ['tasks'] }); }
  };

  if (isLoading) return <p className="text-gray-500 text-sm py-8 text-center">Loading tasks…</p>;
  if (!tasks.length) return empty ?? <div className="card"><EmptyState icon={ListChecks} title="Nothing here" description="No tasks match these filters." /></div>;

  if (draggable) {
    return (
      <DragList items={tasks} onReorder={reorder} itemClassName="mb-2"
        renderItem={(t, handle) => <TaskRow task={t} handle={handle} onOpen={onOpen} onToggle={toggle} showCustomer={showCustomer} />} />
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map(t => <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={toggle} showCustomer={showCustomer} />)}
    </div>
  );
}
