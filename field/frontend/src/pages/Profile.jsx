import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { usersApi } from '../api/users.js';
import Modal from '../components/Modal.jsx';
import { TwoFactorAccount } from '../components/auth/TwoFactorAccount.jsx';

export default function Profile() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  const fullName = user?.fullName || user?.full_name;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Profile</h1>

      <div className="card p-4 space-y-3">
        <Row label="Name" value={fullName} />
        <Row label="Username" value={user?.username} />
        <Row label="Initials" value={user?.initials} />
        <Row label="Role" value={user?.role} />
      </div>

      <button onClick={toggle} className="card p-4 w-full text-left flex items-center justify-between">
        <span className="flex items-center gap-3">
          {theme === 'dark' ? <Moon size={18} className="text-gray-400" /> : <Sun size={18} className="text-gray-400" />}
          <span>Appearance</span>
        </span>
        <span className="text-gray-500 text-sm capitalize">{theme} mode</span>
      </button>

      <button onClick={() => setShowPw(true)} className="card p-4 w-full text-left flex items-center justify-between">
        <span>Change password</span>
        <span className="text-gray-600">›</span>
      </button>

      <button onClick={() => setShowMfa(true)} className="card p-4 w-full text-left flex items-center justify-between">
        <span>Two-factor authentication</span>
        <span className="text-gray-600">›</span>
      </button>

      {user?.role === 'admin' && (
        <>
          <button onClick={() => navigate('/staff')} className="card p-4 w-full text-left flex items-center justify-between">
            <span>Manage staff</span>
            <span className="text-gray-600">›</span>
          </button>
          <button onClick={() => navigate('/audit')} className="card p-4 w-full text-left flex items-center justify-between">
            <span>Audit log</span>
            <span className="text-gray-600">›</span>
          </button>
        </>
      )}

      <button onClick={handleLogout} className="btn-secondary w-full text-brand">Log out</button>

      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
      {showMfa && (
        <Modal title="Two-factor authentication" onClose={() => setShowMfa(false)}>
          <TwoFactorAccount onClose={() => setShowMfa(false)} />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      await usersApi.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="text-green-400 text-sm">Password changed.</p>
          <button onClick={onClose} className="btn-primary w-full">Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="text-brand text-sm">{error}</p>}
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoFocus required />
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" required />
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" required />
          <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Change password'}</button>
        </form>
      )}
    </Modal>
  );
}
