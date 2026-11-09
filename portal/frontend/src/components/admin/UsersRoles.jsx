import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, UserX, UserCheck, History } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

function fmtWhen(ts) {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// --- Activity history (admin) --------------------------------------------------

function ActivityView({ user }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get(`/users/${user.id}/activity`).then(r => setRows(r.data)).catch(() => setRows([]));
  }, [user.id]);

  if (rows === null) return <p className="text-gray-500 text-sm py-4">Loading…</p>;
  if (rows.length === 0) return <p className="text-gray-500 text-sm py-4">No recorded activity.</p>;

  return (
    <div className="max-h-96 overflow-y-auto -mx-1">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-surface-700">
          {rows.map(r => (
            <tr key={r.id}>
              <td className="px-1 py-2 text-gray-300 whitespace-nowrap align-top">
                <span className="font-mono text-xs">{r.action}</span>
              </td>
              <td className="px-2 py-2 text-gray-400 text-xs">
                {r.entity_type ? `${r.entity_type}: ` : ''}{r.entity_name || '—'}
              </td>
              <td className="px-1 py-2 text-gray-500 text-xs whitespace-nowrap align-top text-right">
                {fmtWhen(r.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ROLE_BADGE = {
  admin:      'bg-brand/20 text-brand',
  technician: 'bg-surface-500 text-gray-300',
  biller:     'bg-amber-900/40 text-amber-400',
};

// --- User form (create + edit) ------------------------------------------------

function UserForm({ user, onClose, onSaved }) {
  const isEdit = Boolean(user);
  const [form, setForm] = useState({
    full_name: user?.full_name ?? '',
    username:  user?.username  ?? '',
    email:     user?.email     ?? '',
    role:      user?.role      ?? 'technician',
    password:  '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const payload = { full_name: form.full_name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${user.id}`, payload);
      } else {
        await api.post('/users', form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save user.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Full Name *</label>
          <input className="input" value={form.full_name} onChange={set('full_name')} required
            placeholder="Jane Smith" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Username *</label>
          <input className="input" value={form.username} onChange={set('username')}
            required placeholder="jane.smith" disabled={isEdit} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Email *</label>
        <input className="input" type="email" value={form.email} onChange={set('email')}
          required placeholder="jane@example.com" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Role</label>
        <select className="input" value={form.role} onChange={set('role')}>
          <option value="technician">Technician</option>
          <option value="admin">Admin</option>
          <option value="biller">Biller</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">
          Password {isEdit && <span className="text-gray-600 font-normal">(leave blank to keep current)</span>}
          {!isEdit && ' *'}
        </label>
        <input className="input font-mono" type="password" value={form.password} onChange={set('password')}
          required={!isEdit} minLength={12} placeholder="Min 12 characters"
          autoComplete="new-password" />
        {!isEdit && <p className="text-gray-600 text-xs mt-1">Minimum 12 characters.</p>}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : isEdit ? 'Update User' : 'Create User'}
        </button>
      </div>
    </form>
  );
}

// What each role can do. Everyone signed in can use the day-to-day screens; only
// admins reach this Admin area (users, integrations, branding, security).
const ROLE_INFO = [
  { role: 'admin',      label: 'Admin',      text: 'Everything, plus this Admin area: users & roles, integrations, branding and the one-time recovery secrets.' },
  { role: 'technician', label: 'Technician', text: 'Customers, credentials, work orders, tasks, inventory and field jobs.' },
  { role: 'biller',     label: 'Biller',     text: 'The same screens as a technician, and works the Billing Queue.' },
];

// --- Users & roles section ----------------------------------------------------

export function UsersRoles() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null=closed 'new'=create user={…}=edit
  const [activityUser, setActivityUser] = useState(null);

  const { data: users = [], refetch } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const toggleActive = async (user) => {
    if (!confirm(`${user.is_active ? 'Deactivate' : 'Reactivate'} ${user.full_name}?`)) return;
    try {
      await api.patch(`/users/${user.id}`, { is_active: !user.is_active });
    } catch (err) {
      alert(err.response?.data?.error ?? 'Could not update the user.');
      return;
    }
    refetch();
    qc.invalidateQueries(['users']);
  };

  const active   = users.filter(u => u.is_active);
  const inactive = users.filter(u => !u.is_active);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-200">Users</h2>
            <p className="text-gray-500 text-sm mt-0.5">{active.length} active</p>
          </div>
          <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={14} /> Add User
          </button>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600">
                <th className="text-left text-gray-500 font-medium px-4 py-3">Name</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3 hidden sm:table-cell">Username</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3 hidden md:table-cell">Email</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3">Role</th>
                <th className="text-left text-gray-500 font-medium px-4 py-3 hidden lg:table-cell">Last Login</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {[...active, ...inactive].map(u => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center shrink-0">
                        <span className="text-brand text-xs font-semibold">
                          {u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-gray-200 font-medium">{u.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden sm:table-cell">
                    {u.username}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${ROLE_BADGE[u.role] ?? ROLE_BADGE.technician}`}>
                      {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell whitespace-nowrap">
                    {fmtWhen(u.last_login)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setActivityUser(u)}
                        className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200"
                        title="Activity history"
                      >
                        <History size={13} />
                      </button>
                      <button
                        onClick={() => setModal(u)}
                        className="btn-ghost p-1.5 text-gray-500 hover:text-gray-200"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      {u.id !== me?.id && <button
                        onClick={() => toggleActive(u)}
                        className={`btn-ghost p-1.5 ${
                          u.is_active
                            ? 'text-gray-500 hover:text-red-400'
                            : 'text-gray-600 hover:text-green-400'
                        }`}
                        title={u.is_active ? 'Deactivate' : 'Reactivate'}
                      >
                        {u.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-200 mb-3">Roles</h2>
        <div className="card divide-y divide-surface-700">
          {ROLE_INFO.map(r => (
            <div key={r.role} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3">
              <span className={`badge w-fit ${ROLE_BADGE[r.role]}`}>{r.label}</span>
              <span className="text-sm text-gray-400 flex-1">{r.text}</span>
              <span className="text-xs text-gray-500 whitespace-nowrap">{users.filter(u => u.is_active && u.role === r.role).length} active</span>
            </div>
          ))}
        </div>
      </section>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Create User' : 'Edit User'}
        size="sm"
      >
        {modal !== null && (
          <UserForm
            user={modal === 'new' ? null : modal}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>

      <Modal
        open={activityUser !== null}
        onClose={() => setActivityUser(null)}
        title={activityUser ? `Activity — ${activityUser.full_name}` : 'Activity'}
      >
        {activityUser && <ActivityView user={activityUser} />}
      </Modal>
    </div>
  );
}
