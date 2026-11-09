import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Search, Building2, ClipboardList, Monitor, KeyRound, Paperclip, X, ListChecks } from 'lucide-react';
import api from '../api/client.js';
import { formatDate } from '../utils/date.js';
import { WO_STATUS_LABEL as STATUS_LABEL } from '../utils/woStatus.js';
import { STATUS_LABEL as TASK_STATUS_LABEL, taskNumber } from '../utils/tasks.js';

function woNum(n) { return `WO-${String(n).padStart(5, '0')}`; }

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function ResultGroup({ icon: Icon, label, items, renderItem }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 sticky top-0 bg-surface-800">
        <Icon size={12} className="text-gray-600" />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      {items.map(item => renderItem(item))}
    </div>
  );
}

function ResultRow({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 hover:bg-surface-700 transition-colors flex items-start gap-3 group"
    >
      {children}
    </button>
  );
}

export function GlobalSearch() {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const debounced = useDebounce(query, 250);

  // Ctrl+K to open
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults(null);
    }
  }, [open]);

  // Search on debounced query
  useEffect(() => {
    if (!debounced.trim() || debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    api.get('/search', { params: { q: debounced } })
      .then(r => setResults(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debounced]);

  const go = useCallback((path) => {
    navigate(path);
    setOpen(false);
  }, [navigate]);

  const hasResults = results && (
    results.customers.length + results.work_orders.length + (results.tasks?.length ?? 0) +
    results.devices.length + results.credentials.length + results.files.length > 0
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/70 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="w-full max-w-2xl bg-surface-800 border border-surface-500 rounded-xl shadow-2xl overflow-hidden">

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-600">
          <Search size={16} className={loading ? 'text-accent animate-pulse' : 'text-gray-500'} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-gray-100 placeholder-gray-600 outline-hidden text-base"
            placeholder="Search customers, work orders, tasks, devices, credentials…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-500 hover:text-gray-300 p-0.5">
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:inline text-gray-600 text-xs border border-surface-500 rounded-sm px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() || query.trim().length < 2 ? (
            <p className="text-gray-600 text-sm text-center py-10">
              Type at least 2 characters to search…
            </p>
          ) : !results && !loading ? null : !hasResults && !loading ? (
            <p className="text-gray-600 text-sm text-center py-10">
              No results for "<span className="text-gray-400">{query}</span>"
            </p>
          ) : results && (
            <div className="divide-y divide-surface-700">

              <ResultGroup icon={Building2} label="Customers" items={results.customers}
                renderItem={c => (
                  <ResultRow key={c.id} onClick={() => go(`/customers/${c.id}`)}>
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{c.name}</p>
                      <p className="text-gray-500 text-xs">
                        {[c.city, c.state].filter(Boolean).join(', ')}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </p>
                    </div>
                  </ResultRow>
                )}
              />

              <ResultGroup icon={ClipboardList} label="Work Orders" items={results.work_orders}
                renderItem={wo => (
                  <ResultRow key={wo.id} onClick={() => go(`/work-orders/${wo.id}`)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-mono text-xs">{woNum(wo.number)}</span>
                        <span className="text-gray-200 text-sm">{wo.customer_name}</span>
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {formatDate(wo.work_date)} · {STATUS_LABEL[wo.status] ?? wo.status}
                      </p>
                    </div>
                  </ResultRow>
                )}
              />

              <ResultGroup icon={ListChecks} label="Tasks" items={results.tasks ?? []}
                renderItem={tk => (
                  <ResultRow key={tk.id} onClick={() => go(`/tasks?task=${tk.id}`)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-mono text-xs">{taskNumber(tk.number)}</span>
                        <span className={`text-sm truncate ${tk.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{tk.title}</span>
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">{tk.customer_name ?? 'Internal'} · {TASK_STATUS_LABEL[tk.status] ?? tk.status}</p>
                    </div>
                  </ResultRow>
                )}
              />

              <ResultGroup icon={Monitor} label="Devices" items={results.devices}
                renderItem={d => (
                  <ResultRow key={d.id} onClick={() => go(`/customers/${d.customer_id}?tab=devices`)}>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-200 text-sm font-medium">
                        {d.label || d.model || d.computer_name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {d.customer_name}
                        {d.assigned_to ? ` · ${d.assigned_to}` : ''}
                        {d.model && d.label ? ` · ${d.model}` : ''}
                      </p>
                    </div>
                    <span className="text-gray-600 text-xs capitalize shrink-0">{d.device_type}</span>
                  </ResultRow>
                )}
              />

              <ResultGroup icon={KeyRound} label="Credentials" items={results.credentials}
                renderItem={c => (
                  <ResultRow key={c.id} onClick={() => go(`/customers/${c.customer_id}?tab=credentials`)}>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-200 text-sm font-medium">{c.label}</p>
                      <p className="text-gray-500 text-xs">
                        {c.customer_name}
                        {c.username ? ` · ${c.username}` : ''}
                      </p>
                    </div>
                    <span className="text-gray-600 text-xs capitalize shrink-0">{c.category}</span>
                  </ResultRow>
                )}
              />

              <ResultGroup icon={Paperclip} label="Files" items={results.files}
                renderItem={f => (
                  <ResultRow key={f.id} onClick={() => go(`/customers/${f.customer_id}?tab=files`)}>
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{f.original_name}</p>
                      <p className="text-gray-500 text-xs">{f.customer_name}</p>
                    </div>
                  </ResultRow>
                )}
              />

            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-surface-700 flex items-center justify-between">
          <span className="text-gray-600 text-xs">Click a result to navigate</span>
          <div className="flex items-center gap-3 text-gray-600 text-xs">
            <span><kbd className="border border-surface-500 rounded-sm px-1">↵</kbd> open</span>
            <span><kbd className="border border-surface-500 rounded-sm px-1">Esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
