import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Shield } from 'lucide-react';
import api from '../api/client.js';
import { toPage } from '../hooks/useInfiniteList.js';

const ACTION_BADGE = {
  CREATE:           'bg-green-900/40 text-green-400',
  UPDATE:           'bg-blue-900/40 text-blue-400',
  DELETE:           'bg-red-900/40 text-red-400',
  LOGIN:            'bg-surface-500 text-gray-400',
  LOGOUT:           'bg-surface-500 text-gray-400',
  LOGIN_FAILED:     'bg-red-900/40 text-red-400',
  VIEW_CREDENTIALS: 'bg-amber-900/40 text-amber-400',
  READ:             'bg-amber-900/40 text-amber-400',
};

const ACTIONS = [
  '', 'CREATE', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'VIEW_CREDENTIALS',
];

const ENTITY_TYPES = [
  '', 'customer', 'work_order', 'device', 'credential', 'camera_system',
  'camera_shared_access', 'contact', 'billing_rate', 'guide', 'file', 'proposal',
  'location', 'inventory', 'user', 'task',
];

function ChangeDetail({ changes }) {
  const [open, setOpen] = useState(false);
  if (!changes) return null;
  let parsed;
  try { parsed = typeof changes === 'string' ? JSON.parse(changes) : changes; } catch { return null; }
  const keys = Object.keys(parsed);
  if (!keys.length) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-gray-600 hover:text-gray-400 text-xs mt-1 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {keys.length} field{keys.length !== 1 ? 's' : ''} changed
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-3 border-l border-surface-600">
          {keys.map(k => (
            <div key={k} className="text-xs">
              <span className="text-gray-500">{k}: </span>
              <span className="text-red-400 line-through mr-2">{String(parsed[k].old ?? '')}</span>
              <span className="text-green-400">{String(parsed[k].new ?? '')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuditLog() {
  const [action, setAction]         = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage]             = useState(0);
  const limit = 50;

  // The endpoint reports the full match count, so the pager can show real page
  // numbers and stop exactly on the last page instead of inferring from a short one.
  const { data, isFetching } = useQuery({
    queryKey: ['audit', action, entityType, page],
    queryFn: () => api.get('/audit', {
      params: {
        action:     action     || undefined,
        entityType: entityType || undefined,
        limit,
        offset: page * limit,
      },
    }).then(toPage),
    keepPreviousData: true,
  });
  const entries = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={20} className="text-brand" />
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Audit Log</h1>
          <p className="text-gray-500 text-sm mt-0.5">Every action taken in the Portal, timestamped and attributed.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <select
          className="input text-sm max-w-[200px]"
          value={action}
          onChange={e => { setAction(e.target.value); setPage(0); }}
        >
          <option value="">All actions</option>
          {ACTIONS.filter(Boolean).map(a => (
            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          className="input text-sm max-w-[200px]"
          value={entityType}
          onChange={e => { setEntityType(e.target.value); setPage(0); }}
        >
          <option value="">All types</option>
          {ENTITY_TYPES.filter(Boolean).map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-600">
              <th className="text-left text-gray-500 font-medium px-4 py-3">Time</th>
              <th className="text-left text-gray-500 font-medium px-4 py-3">User</th>
              <th className="text-left text-gray-500 font-medium px-4 py-3">Action</th>
              <th className="text-left text-gray-500 font-medium px-4 py-3 hidden md:table-cell">Entity</th>
              <th className="text-left text-gray-500 font-medium px-4 py-3 hidden lg:table-cell">Details</th>
              <th className="text-left text-gray-500 font-medium px-4 py-3 hidden xl:table-cell">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700">
            {entries.length === 0 && !isFetching ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-600 py-10">No log entries found.</td>
              </tr>
            ) : entries.map(entry => (
              <tr key={entry.id} className="hover:bg-surface-700/30 transition-colors">
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {new Date(entry.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-300 text-xs font-medium whitespace-nowrap">
                  {entry.user_name}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge text-xs ${ACTION_BADGE[entry.action] ?? 'bg-surface-500 text-gray-400'}`}>
                    {entry.action.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {entry.entity_type && (
                    <div>
                      <span className="text-gray-500 text-xs capitalize">
                        {entry.entity_type.replace(/_/g, ' ')}
                      </span>
                      {entry.entity_name && (
                        <p className="text-gray-300 text-xs mt-0.5">{entry.entity_name}</p>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <ChangeDetail changes={entry.changes} />
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs hidden xl:table-cell font-mono">
                  {entry.ip_address ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {(pageCount > 1 || page > 0) && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-600">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-secondary text-sm disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-gray-500 text-sm">
              Page {page + 1} of {pageCount.toLocaleString()}
              <span className="hidden sm:inline"> · {total.toLocaleString()} entries</span>
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page + 1 >= pageCount}
              className="btn-secondary text-sm disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
