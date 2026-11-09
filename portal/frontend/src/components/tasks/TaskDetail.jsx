import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pencil, Trash2, ClipboardList, Play, Pause, CheckCircle2, RotateCcw, Building2, User, Phone, MessageSquare,
  Send, History, CalendarDays, FolderKanban, CalendarPlus, CalendarX,
} from 'lucide-react';
import { tasksApi } from '../../api/tasks.js';
import { integrationsApi } from '../../api/integrations.js';
import { Modal } from '../ui/Modal.jsx';
import { RichTextView } from '../ui/RichText.jsx';
import { LinkToWorkOrder } from '../work/LinkToWorkOrder.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { htmlToText } from '../../utils/htmlToText.js';
import { formatDate } from '../../utils/date.js';
import { timeLabel, parseHm } from '../../utils/calendar.js';
import { STATUS_LABEL, PRIORITY_LABEL, WAITING_ON, WAITING_LABEL, taskNumber, todayKey } from '../../utils/tasks.js';
import { StatusBadge, PriorityBadge, TaskDates, useRefreshTasks } from './taskBits.jsx';
import { TaskForm } from './TaskForm.jsx';

// One task, opened from any list: quick status moves, the details, its history and
// comments, Add to Work Order, edit and delete. Rendered inside its own Modal.

const woNum = (n) => `WO-${String(n).padStart(5, '0')}`;
const when = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One history line, in words. */
function eventText(e) {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'created':   return e.body || 'created the task';
    case 'status':    return d.to === 'waiting' && d.waiting_on ? `set it to Waiting on ${WAITING_LABEL[d.waiting_on]}` : `moved it ${STATUS_LABEL[d.from] ? `from ${STATUS_LABEL[d.from]} ` : ''}to ${STATUS_LABEL[d.to] ?? d.to}`;
    case 'assigned':  return d.to ? `assigned it to ${d.to_name ?? 'someone'}` : `unassigned it${d.from_name ? ` from ${d.from_name}` : ''}`;
    case 'scheduled': return d.to ? `scheduled it for ${formatDate(d.to)}${d.to_time ? ` at ${timeLabel(parseHm(d.to_time))}` : ''}` : 'took it off the schedule';
    case 'due':       return d.to ? `set the due date to ${formatDate(d.to)}` : 'cleared the due date';
    case 'priority':  return `changed priority to ${PRIORITY_LABEL[d.to] ?? d.to}`;
    case 'edited':    return `edited the ${(d.fields ?? []).map(f => ({ customer_id: 'customer', estimated_hours: 'estimate' }[f] ?? f)).join(', ')}`;
    case 'work_order': return null;
    case 'outlook':   return d.action === 'added' ? 'put it on the Outlook calendar'
      : d.reason === 'unscheduled' ? 'took it off the schedule, so its Outlook event was removed' : 'took it off the Outlook calendar';
    default:          return e.kind;
  }
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 flex items-center gap-1">{Icon && <Icon size={11} />} {label}</p>
      <div className="text-sm text-gray-200 mt-0.5 break-words">{children}</div>
    </div>
  );
}

export function TaskDetailModal({ taskId, onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const refresh = useRefreshTasks();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waitPick, setWaitPick] = useState(false);

  const key = ['tasks', 'detail', taskId];
  const { data: task, isLoading, error: loadError } = useQuery({
    queryKey: key,
    queryFn: () => tasksApi.get(taskId).then(r => r.data),
    enabled: !!taskId,
  });

  // "Add to Outlook" only shows once the shared calendar is set up.
  const { data: integrations } = useQuery({ queryKey: ['integrations', 'status'], queryFn: () => integrationsApi.status().then(r => r.data), staleTime: 5 * 60_000 });

  const run = async (fn) => {
    setBusy(true); setError('');
    try {
      const res = await fn();
      // A task change whose Outlook event couldn't follow still saved — say so.
      if (res?.data?.outlook_warning) setError(res.data.outlook_warning);
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['outlook'] });
    }
    catch (e) { setError(e.response?.data?.error ?? 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  const move = (patch) => run(() => tasksApi.update(task.id, patch));
  const post = () => {
    if (!comment.trim()) return;
    run(async () => { await tasksApi.comment(task.id, comment.trim()); setComment(''); });
  };
  const remove = () => {
    if (!confirm(`Delete ${taskNumber(task.number)} "${task.title}"? Its history goes with it.`)) return;
    run(async () => { await tasksApi.remove(task.id); onClose(); });
  };

  const title = task ? `${taskNumber(task.number)}${task.kind === 'project' ? ' · Project' : ''}` : 'Task';

  if (editing && task) {
    return (
      <Modal open onClose={() => setEditing(false)} title={`Edit ${taskNumber(task.number)}`} size="lg">
        <TaskForm task={task} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      </Modal>
    );
  }

  const done = task?.status === 'done';
  const today = todayKey();

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      {isLoading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : loadError || !task ? (
        <p className="text-red-400 text-sm py-8 text-center">{loadError?.response?.status === 404 ? 'This task no longer exists.' : 'Could not load the task.'}</p>
      ) : (
        <div className="space-y-5">
          {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge task={task} />
              <PriorityBadge priority={task.priority} />
              {task.kind === 'project' && <span className="badge bg-blue-900/30 text-blue-300 inline-flex items-center gap-1"><FolderKanban size={10} /> Project</span>}
            </div>
            <h2 className={`text-lg font-semibold mt-2 break-words ${done ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{task.title}</h2>
            <TaskDates task={task} className="mt-1.5" />
          </div>

          {/* Quick moves */}
          <div className="flex flex-wrap gap-2">
            {!done && task.status !== 'in_progress' && (
              <button disabled={busy} onClick={() => move({ status: 'in_progress', ...(task.assigned_to ? {} : { assigned_to: user?.id }) })}
                className="btn-secondary text-sm flex items-center gap-1.5"><Play size={14} /> Start{!task.assigned_to && ' (assign to me)'}</button>
            )}
            {!done && task.status !== 'waiting' && (
              waitPick ? (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Waiting on:</span>
                  {WAITING_ON.map(w => (
                    <button key={w} disabled={busy} onClick={() => { setWaitPick(false); move({ status: 'waiting', waiting_on: w }); }}
                      className="btn-ghost px-2 py-1 text-xs bg-surface-700">{WAITING_LABEL[w]}</button>
                  ))}
                </span>
              ) : (
                <button disabled={busy} onClick={() => setWaitPick(true)} className="btn-secondary text-sm flex items-center gap-1.5"><Pause size={14} /> Waiting…</button>
              )
            )}
            {!done && !task.scheduled_date && (
              <button disabled={busy} onClick={() => move({ scheduled_date: today, ...(task.assigned_to ? {} : { assigned_to: user?.id }) })}
                className="btn-secondary text-sm flex items-center gap-1.5"><CalendarDays size={14} /> Do it today</button>
            )}
            {!done ? (
              <button disabled={busy} onClick={() => move({ status: 'done' })} className="btn-primary text-sm flex items-center gap-1.5"><CheckCircle2 size={14} /> Mark done</button>
            ) : (
              <button disabled={busy} onClick={() => move({ status: 'open' })} className="btn-secondary text-sm flex items-center gap-1.5"><RotateCcw size={14} /> Reopen</button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-surface-700/40 rounded-lg p-3">
            <Fact icon={Building2} label="Customer">
              {task.customer_id
                ? <Link to={`/customers/${task.customer_id}?tab=tasks`} className="text-accent hover:underline" onClick={onClose}>{task.customer_name}</Link>
                : <span className="text-gray-400">Internal</span>}
              {task.location_name && <span className="block text-xs text-gray-500">{task.location_name}</span>}
            </Fact>
            <Fact icon={User} label="Assigned to">{task.assigned_to_name ?? <span className="text-gray-500">Unassigned</span>}</Fact>
            <Fact label="Priority">{PRIORITY_LABEL[task.priority]}</Fact>
            {(task.requested_by || task.requested_phone) && (
              <Fact icon={Phone} label="Requested by">
                {[task.requested_by, task.requested_phone].filter(Boolean).join(' · ')}
                {task.requested_date && <span className="block text-xs text-gray-500">{formatDate(task.requested_date)}{task.requested_time ? ` ${task.requested_time}` : ''}</span>}
              </Fact>
            )}
            <Fact label="Created">{formatDate(task.created_at)}<span className="block text-xs text-gray-500">by {task.created_by_name ?? 'unknown'}</span></Fact>
            {done && <Fact label="Finished">{formatDate(task.done_at)}<span className="block text-xs text-gray-500">by {task.done_by_name ?? 'unknown'}</span></Fact>}
          </div>

          {task.notes && htmlToText(task.notes).trim() || task.notes?.includes('<img') ? (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Details</p>
              <div className="bg-surface-700/30 rounded-lg p-3"><RichTextView html={task.notes} /></div>
            </div>
          ) : null}

          {/* History + comments */}
          <div>
            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><History size={12} /> History</p>
            <ol className="space-y-2.5">
              {(task.events ?? []).map(e => (
                <li key={e.id} className="flex gap-2.5 text-sm">
                  <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${e.kind === 'comment' ? 'bg-accent' : 'bg-surface-500'}`} />
                  <div className="min-w-0 flex-1">
                    {e.kind === 'comment' ? (
                      <div className="bg-surface-700/50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <MessageSquare size={11} /> <span className="text-gray-300">{e.user_name ?? 'Someone'}</span> · {when(e.created_at)}
                          {(e.user_id === user?.id || user?.role === 'admin') && (
                            <button onClick={() => confirm('Delete this comment?') && run(() => tasksApi.removeComment(task.id, e.id))}
                              className="ml-auto text-gray-600 hover:text-red-400" title="Delete comment"><Trash2 size={11} /></button>
                          )}
                        </p>
                        <p className="text-gray-200 whitespace-pre-wrap break-words mt-0.5">{e.body}</p>
                      </div>
                    ) : (
                      <p className="text-gray-400">
                        <span className="text-gray-300">{e.user_name ?? 'Someone'}</span>{' '}
                        {e.kind === 'work_order'
                          ? <>added it to <Link to={`/work-orders/${e.data?.work_order_id}`} onClick={onClose} className="text-accent hover:underline">{woNum(e.data?.number)}</Link></>
                          : eventText(e)}
                        <span className="text-gray-600 text-xs"> · {when(e.created_at)}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex gap-2 items-end">
              <textarea className="input min-h-[2.75rem] flex-1" rows={2} value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Add an update — what was done, what's next, who you talked to…"
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); }} />
              <button onClick={post} disabled={busy || !comment.trim()} className="btn-primary p-2.5" title="Post (Ctrl+Enter)"><Send size={15} /></button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-700">
            <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-1.5 mt-3"><Pencil size={14} /> Edit</button>
            {task.customer_id && (
              <button onClick={() => setLinking(true)} className="btn-secondary text-sm flex items-center gap-1.5 mt-3"><ClipboardList size={14} /> Add to Work Order</button>
            )}
            {integrations?.outlook && (task.outlook_event_id ? (
              <button onClick={() => confirm('Take this task off the shared Outlook calendar?') && run(() => tasksApi.removeFromOutlook(task.id))} disabled={busy}
                className="btn-secondary text-sm flex items-center gap-1.5 mt-3" title="It's on the shared Outlook calendar and follows this task's date, title and tech">
                <CalendarX size={14} /> On Outlook · Remove
              </button>
            ) : (
              <button onClick={() => run(() => tasksApi.addToOutlook(task.id))} disabled={busy || !task.scheduled_date}
                className="btn-secondary text-sm flex items-center gap-1.5 mt-3"
                title={task.scheduled_date ? 'Put it on the shared Outlook calendar as an all-day event on its date' : 'Give it a date first'}>
                <CalendarPlus size={14} /> Add to Outlook
              </button>
            ))}
            <button onClick={remove} disabled={busy} className="btn-ghost text-sm flex items-center gap-1.5 mt-3 ml-auto text-gray-500 hover:text-red-400"><Trash2 size={14} /> Delete</button>
          </div>
        </div>
      )}

      {linking && task && (
        <LinkToWorkOrder
          customerId={task.customer_id}
          customerName={task.customer_name}
          description={task.title}
          internalNotes={[
            `${taskNumber(task.number)}${task.requested_by ? ` — requested by ${task.requested_by}${task.requested_phone ? ` (${task.requested_phone})` : ''}` : ''}`,
            htmlToText(task.notes ?? '').trim(),
          ].filter(Boolean).join('\n\n')}
          sourceLabel={`Task ${taskNumber(task.number)}`}
          onLinked={(woId) => tasksApi.linkWorkOrder(task.id, woId).then(refresh)}
          onClose={() => setLinking(false)}
        />
      )}
    </Modal>
  );
}
