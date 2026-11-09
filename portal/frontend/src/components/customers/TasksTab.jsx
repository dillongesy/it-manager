import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, ListChecks } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { TaskList } from '../tasks/TaskList.jsx';
import { TaskForm } from '../tasks/TaskForm.jsx';
import { TaskDetailModal } from '../tasks/TaskDetail.jsx';
import { StatusChips, useRefreshTasks } from '../tasks/taskBits.jsx';

// A customer's Tasks tab: the Tasks page filtered to this customer.
export function TasksTab({ customerId, companyName }) {
  const refresh = useRefreshTasks();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const openId = sp.get('task');
  const setOpen = (id) => { const n = new URLSearchParams(sp); if (id) n.set('task', id); else n.delete('task'); setSp(n, { replace: true }); };

  const params = { customerId, status, sort: status === 'done' ? 'done' : 'priority', q: search.trim() || undefined };
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <StatusChips value={status} onChange={setStatus} />
        <div className="flex items-center gap-2 sm:ml-auto">
          <SearchInput value={search} onChange={setSearch} placeholder="Search this customer's tasks…" className="flex-1 sm:w-64" />
          <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2 text-sm whitespace-nowrap"><Plus size={14} /> New task</button>
        </div>
      </div>

      <TaskList params={params} onOpen={(t) => setOpen(t.id)} showCustomer={false}
        empty={
          <div className="card">
            <EmptyState icon={ListChecks} title={status === 'done' ? 'Nothing finished yet' : 'No open tasks'}
              description={`Projects and back-burner work for ${companyName ?? 'this customer'}. They also appear on the Tasks page.`}
              action={<button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2"><Plus size={14} /> New task</button>} />
          </div>
        } />

      <Modal open={creating} onClose={() => setCreating(false)} title={`New task — ${companyName ?? 'customer'}`} size="lg">
        {creating && (
          <TaskForm defaults={{ customer_id: customerId, customer_name: companyName }}
            onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); refresh(); setOpen(t.id); }} />
        )}
      </Modal>

      {openId && <TaskDetailModal taskId={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}
