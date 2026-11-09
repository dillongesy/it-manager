import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { auditApi } from '../api/audit.js';

const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE'];
const TYPES = ['', 'inventory', 'work_order', 'photo', 'user'];
const TYPE_LABEL = { inventory: 'Inventory', work_order: 'Work Order', photo: 'Photo', user: 'User' };
const ACTION_COLOR = {
  CREATE: 'text-green-400',
  UPDATE: 'text-blue-400',
  DELETE: 'text-brand',
};
const PAGE = 50;

export default function Audit() {
  const navigate = useNavigate();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: PAGE, offset };
      if (action) params.action = action;
      if (entityType) params.entityType = entityType;
      const { data } = await auditApi.list(params);
      setRows(data);
      setHasMore(data.length === PAGE);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [action, entityType, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [action, entityType]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/profile')} className="text-gray-500 text-xl leading-none">‹</button>
        <h1 className="text-2xl font-bold">Audit Log</h1>
      </div>

      <div className="flex gap-2">
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
        </select>
        <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t ? TYPE_LABEL[t] : 'All types'}</option>)}
        </select>
      </div>

      {error && <p className="text-brand text-sm">{error}</p>}

      {loading ? (
        <p className="text-gray-500 py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 py-6 text-center">No audit entries.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${ACTION_COLOR[r.action] ?? 'text-gray-400'}`}>{r.action}</span>
                <span className="text-gray-500 text-xs">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm mt-1 wrap-break-word">{r.entity_name || '—'}</p>
              <p className="text-gray-500 text-xs mt-0.5">
                {TYPE_LABEL[r.entity_type] ?? r.entity_type} · {r.user_name}
              </p>
              {r.changes?.fields?.length > 0 && (
                <p className="text-gray-600 text-xs mt-1">Changed: {r.changes.fields.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {(offset > 0 || hasMore) && (
        <div className="flex justify-between pt-2">
          <button onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0}
            className="btn-secondary disabled:opacity-40">Previous</button>
          <button onClick={() => setOffset((o) => o + PAGE)} disabled={!hasMore}
            className="btn-secondary disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
