import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, ListChecks, CalendarDays, LayoutDashboard } from 'lucide-react';
import { Modal } from '../components/ui/Modal.jsx';
import { SearchInput } from '../components/ui/SearchInput.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { TaskList } from '../components/tasks/TaskList.jsx';
import { TaskCalendar } from '../components/tasks/TaskCalendar.jsx';
import { TaskOverview } from '../components/tasks/TaskOverview.jsx';
import { TaskForm } from '../components/tasks/TaskForm.jsx';
import { TaskDetailModal } from '../components/tasks/TaskDetail.jsx';
import { StatusChips, TechChips, useTechs, useRefreshTasks } from '../components/tasks/taskBits.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { techColors } from '../utils/tasks.js';

// Tasks — the internal task list: back-burner work and projects (big and small) that don't
// affect a customer's uptime. Replaced the Backlog page and the customer To-Dos.
//   Schedule — the calendar (the default): tasks and the shared Outlook calendar, by day / week /
//              month / agenda, coloured by tech. Opens on Everyone, with its own tech filter, so
//              the Queue's "my tasks" doesn't narrow it.
//   Queue    — the ranked to-do list, filtered by tech / status / type (?view=queue)
//   Overview — who's on what, what's overdue, what's been sitting (?view=overview)
// ?task=<id> opens a task over whichever view (global search and the dashboard link here).

const TECH_KEY = 'app-tasks-tech';
const read = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

const VIEWS = [
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'queue', label: 'Queue', icon: ListChecks },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
];
const SORTS = [
  ['queue', 'Queue order (drag to rank)'],
  ['priority', 'Priority, then due date'],
  ['due', 'Due date'],
  ['scheduled', 'Scheduled date'],
  ['created', 'Newest first'],
  ['updated', 'Recently updated'],
  ['customer', 'Customer'],
  ['done', 'Recently finished'],
];

export function Tasks() {
  const { user } = useAuth();
  const techs = useTechs();
  const refresh = useRefreshTasks();
  const [sp, setSp] = useSearchParams();
  const view = VIEWS.some(v => v.id === sp.get('view')) ? sp.get('view') : 'schedule';
  const openId = sp.get('task');

  const [tech, setTechState] = useState(() => read(TECH_KEY, null));
  const [scheduleTech, setScheduleTech] = useState('');   // the Schedule always opens on Everyone
  const colors = useMemo(() => techColors(techs), [techs]);
  const [status, setStatus] = useState('active');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('queue');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // First visit: start on the signed-in tech's own tasks.
  useEffect(() => { if (tech === null && user) { setTechState(String(user.id)); write(TECH_KEY, String(user.id)); } }, [tech, user]);
  const setTech = (v) => { setTechState(v); write(TECH_KEY, v); };

  const setParam = (changes) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setSp(next, { replace: true });
  };
  const open = (t) => setParam({ task: t.id });

  const techValue = tech ?? '';
  // A new task starts assigned to whoever the current view is filtered to.
  const shownTech = view === 'schedule' ? scheduleTech : techValue;
  const newTaskTech = shownTech && shownTech !== 'none' ? shownTech : '';
  const params = {
    status,
    assignedTo: techValue || undefined,
    kind: kind || undefined,
    sort,
    q: search.trim() || undefined,
  };

  return (
    <div className={`p-4 sm:p-6 mx-auto ${view === 'schedule' ? 'max-w-[110rem]' : 'max-w-7xl'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Tasks</h1>
          <p className="text-gray-500 text-sm mt-0.5">Back-burner work and projects — scheduled, ranked and tracked. Internal only.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={15} /> New task</button>
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setParam({ view: id === 'schedule' ? null : id })}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${view === id ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {view !== 'overview' && (
        <div className="mb-4">
          {view === 'schedule'
            ? <TechChips value={scheduleTech} onChange={setScheduleTech} techs={techs} colors={colors} />
            : <TechChips value={techValue} onChange={setTech} techs={techs} />}
        </div>
      )}

      {view === 'queue' && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
            <StatusChips value={status} onChange={setStatus} />
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <select className="input py-1.5 text-sm w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Type">
                <option value="">Tasks & projects</option>
                <option value="task">Tasks only</option>
                <option value="project">Projects only</option>
              </select>
              <select className="input py-1.5 text-sm w-auto" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <SearchInput value={search} onChange={setSearch} placeholder="Search tasks, customers, T-number…" className="w-full sm:w-64" />
            </div>
          </div>
          <TaskList params={params} draggable={sort === 'queue' && !search.trim()} onOpen={open}
            empty={
              <div className="card">
                <EmptyState icon={ListChecks} title={status === 'done' ? 'Nothing finished yet' : 'Nothing in this queue'}
                  description="Projects and back-burner work go here — assign them, schedule them, and work them in order."
                  action={<button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2"><Plus size={14} /> New task</button>} />
              </div>
            } />
        </>
      )}

      {view === 'schedule' && <TaskCalendar techFilter={scheduleTech} techs={techs} colors={colors} onOpen={open} />}

      {view === 'overview' && (
        <TaskOverview onOpen={open}
          onFilter={({ status: s, tech: t, kind: k = '' }) => { setStatus(s); setTech(t); setKind(k); setSort(s === 'done' ? 'done' : 'priority'); setParam({ view: 'queue' }); }} />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New task" size="lg">
        {creating && (
          <TaskForm defaults={{ assigned_to: newTaskTech }}
            onClose={() => setCreating(false)}
            onSaved={(t) => { setCreating(false); refresh(); setParam({ task: t.id }); }} />
        )}
      </Modal>

      {openId && <TaskDetailModal taskId={openId} onClose={() => setParam({ task: null })} />}
    </div>
  );
}
