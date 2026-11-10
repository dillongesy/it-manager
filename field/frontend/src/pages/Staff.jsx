import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { usersApi } from '../api/users.js';
import { mfaApi } from '../api/mfa.js';
import Modal from '../components/Modal.jsx';

const ROLES = [
  { value: 'camera_tech', label: 'Camera Tech' },
  { value: 'biller', label: 'Biller' },
  { value: 'admin', label: 'Admin' },
];

export default function Staff() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // user object or 'new'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await usersApi.list();
      setUsers(res.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-4">
      <button onClick={() => navigate('/profile')} className="text-gray-500 text-sm">← Profile</button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Staff</h1>
        <button onClick={() => setEditing('new')} className="btn-primary text-sm px-4 py-2">+ New</button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <button key={u.id} onClick={() => setEditing(u)} className="card p-4 w-full text-left flex items-center justify-between">
              <div>
                <div className="font-semibold">
                  {u.full_name || u.username} {u.initials && <span className="text-accent">({u.initials})</span>}
                  {u.mfa_enabled && <ShieldCheck size={14} className="inline ml-1.5 text-green-400" aria-label="Two-factor authentication on" />}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{u.username} · {u.role}</div>
              </div>
              {!u.is_active && <span className="text-xs text-brand uppercase">Inactive</span>}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <StaffModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function StaffModal({ user, onClose, onSaved }) {
  const isNew = !user;
  const [form, setForm] = useState({
    username: user?.username || '',
    full_name: user?.full_name || '',
    initials: user?.initials || '',
    role: user?.role || 'camera_tech',
    password: '',
    is_active: user?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isNew) {
        await usersApi.create({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          initials: form.initials,
          role: form.role,
        });
      } else {
        const payload = { full_name: form.full_name, initials: form.initials, role: form.role, is_active: form.is_active };
        if (form.password) payload.password = form.password;
        await usersApi.update(user.id, payload);
      }
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'New staff member' : form.full_name || form.username} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-brand text-sm">{error}</p>}
        <Labeled label="Username *">
          <input className="input" value={form.username} onChange={set('username')} disabled={!isNew} autoCapitalize="none" required={isNew} />
        </Labeled>
        <Labeled label="Full name *"><input className="input" value={form.full_name} onChange={set('full_name')} required /></Labeled>
        <Labeled label="Initials"><input className="input uppercase" value={form.initials} onChange={set('initials')} autoCapitalize="characters" /></Labeled>
        <Labeled label="Role">
          <select className="input" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Labeled>
        <Labeled label={isNew ? 'Password * (min 8)' : 'New password (leave blank to keep)'}>
          <input className="input" type="password" value={form.password} onChange={set('password')} required={isNew} />
        </Labeled>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
        )}
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : isNew ? 'Create' : 'Save'}</button>
        {!isNew && user?.mfa_enabled && (
          <button type="button" className="btn-ghost w-full text-sm" disabled={saving} onClick={async () => {
            if (!confirm(`Reset two-factor authentication for ${form.full_name}? They sign in with their password only until they set it up again.`)) return;
            try { await mfaApi.resetUser(user.id); onSaved(); } catch (err) { setError(err.response?.data?.error || 'Could not reset two-factor authentication.'); }
          }}>
            Reset two-factor authentication
          </button>
        )}
      </form>
    </Modal>
  );
}

function Labeled({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
