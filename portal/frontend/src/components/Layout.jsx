import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router';
import {
  LayoutDashboard, Users, ClipboardList,
  Package, LogOut, Settings, Briefcase, KeyRound, Eye, EyeOff, X, Search, Shield,
  Sun, Moon, ListChecks, Smartphone, Tags, ShoppingCart, Menu
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { StorageAlert } from './admin/Storage.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import api from '../api/client.js';
import { GlobalSearch } from './GlobalSearch.jsx';
import { Logo } from './ui/Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';

// --- Nav config ---------------------------------------------------------------
// Everyone (admin/technician/biller) sees the same things. The only role-gated
// item is Admin (users & roles, integrations, branding, security) - see navItems below.

const BASE_NAV = [
  { to: '/',            label: 'Dashboard',     icon: LayoutDashboard, exact: true },
  { to: '/customers',   label: 'Customers',     icon: Users },
  { to: '/work-orders', label: 'Work Orders',   icon: ClipboardList },
  { to: '/field-jobs',  label: 'Field Jobs',    icon: Smartphone },
  { to: '/tasks',       label: 'Tasks',         icon: ListChecks },
  { to: '/inventory',   label: 'Inventory',     icon: Package },
  { to: '/orders',      label: 'Orders',        icon: ShoppingCart },
  { to: '/services',    label: 'Services',      icon: Tags },
  { to: '/billing',     label: 'Billing Queue', icon: Briefcase },
  { to: '/audit',       label: 'Audit Log',     icon: Shield },
];

// --- Change password modal ----------------------------------------------------

function ChangePasswordModal({ onClose }) {
  const [form, setForm]     = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);
  const [showCur, setShowCur]   = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) { setError('New passwords do not match.'); return; }
    if (form.next.length < 12)      { setError('New password must be at least 12 characters.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/users/me/password', {
        current_password: form.current,
        new_password:     form.next,
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to change password.');
    } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-green-900/30 flex items-center justify-center mx-auto mb-3">
          <KeyRound size={20} className="text-green-400" />
        </div>
        <p className="text-gray-200 font-medium mb-1">Password updated</p>
        <p className="text-gray-500 text-sm mb-4">Your new password is active.</p>
        <button onClick={onClose} className="btn-primary">Done</button>
      </div>
    );
  }

  const ToggleEye = ({ show, onToggle }) => (
    <button type="button" onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
      {show ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Current Password</label>
        <div className="relative">
          <input className="input pr-10 font-mono" type={showCur ? 'text' : 'password'}
            value={form.current} onChange={set('current')} required autoComplete="current-password" />
          <ToggleEye show={showCur} onToggle={() => setShowCur(v => !v)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">New Password</label>
        <div className="relative">
          <input className="input pr-10 font-mono" type={showNew ? 'text' : 'password'}
            value={form.next} onChange={set('next')} required minLength={12}
            placeholder="Min 12 characters" autoComplete="new-password" />
          <ToggleEye show={showNew} onToggle={() => setShowNew(v => !v)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Confirm New Password</label>
        <input className="input font-mono" type="password" value={form.confirm}
          onChange={set('confirm')} required autoComplete="new-password" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.current || !form.next || !form.confirm}
          className="btn-primary">
          {saving ? 'Updating…' : 'Update Password'}
        </button>
      </div>
    </form>
  );
}

// --- Layout -------------------------------------------------------------------

export function Layout({ children }) {
  const branding = useBranding();
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [changePwModal, setChangePwModal] = useState(false);
  // Below the lg breakpoint the sidebar is an off-canvas drawer (phones over VPN,
  // tablets, narrow windows). At lg and up it's the same fixed column as always.
  const [navOpen, setNavOpen] = useState(false);

  // Close the drawer whenever the route changes (i.e. after tapping a nav link).
  useEffect(() => { setNavOpen(false); }, [location.pathname, location.search]);

  // Lock page scroll behind the open drawer.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [navOpen]);

  const openSearch = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = (() => {
    const items = [...BASE_NAV];
    // Admin is the one admin-only screen: users & roles, integrations, branding, security.
    if (user?.role === 'admin') {
      items.push({ to: '/admin', label: 'Admin', icon: Settings });
    }
    return items;
  })();

  const initials = user?.full_name
    ?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? '?';

  return (
    <div className="flex h-dvh bg-surface-900 overflow-hidden">
      {/* Drawer backdrop (below lg only) */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar - static column at lg+, slide-in drawer below */}
      <aside className={`w-64 lg:w-56 flex flex-col bg-surface-800 border-r border-surface-600 shrink-0
        fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0
        ${navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-surface-600">
          <Logo size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-gray-100 font-semibold text-sm leading-tight truncate">{branding.productName}</p>
            <p className="text-gray-500 text-xs truncate">{branding.companyName}</p>
          </div>
          <button onClick={() => setNavOpen(false)} aria-label="Close menu"
            className="lg:hidden text-gray-400 hover:text-gray-100 p-2 -mr-2 rounded-md">
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <button
          onClick={() => { setNavOpen(false); openSearch(); }}
          className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-surface-700 hover:bg-surface-600 text-gray-500 hover:text-gray-300 transition-colors text-sm w-[calc(100%-1.5rem)]"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-xs border border-surface-500 rounded-sm px-1 text-gray-600">⌃K</kbd>
        </button>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 lg:py-2 rounded-md text-sm font-medium transition-colors duration-100 ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'text-gray-400 hover:bg-surface-600 hover:text-gray-100'
                }`
              }
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t border-surface-600 p-3">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-semibold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-200 text-xs font-medium truncate">{user?.full_name}</p>
              <p className="text-gray-500 text-xs capitalize">{user?.role}</p>
            </div>
            <div className="flex gap-0.5">
              <button
                onClick={toggleTheme}
                title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                className="text-gray-500 hover:text-gray-300 transition-colors p-2 lg:p-1 rounded-sm"
              >
                {theme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
              </button>
              <button
                onClick={() => { setNavOpen(false); setChangePwModal(true); }}
                title="Change password"
                className="text-gray-500 hover:text-gray-300 transition-colors p-2 lg:p-1 rounded-sm"
              >
                <KeyRound size={13} />
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="text-gray-500 hover:text-brand transition-colors p-2 lg:p-1 rounded-sm"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column: compact top bar (below lg) + scrolling content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center gap-2 px-2 h-14 shrink-0 bg-surface-800 border-b border-surface-600"
          style={{ paddingTop: 'env(safe-area-inset-top)', boxSizing: 'content-box' }}>
          <button onClick={() => setNavOpen(true)} aria-label="Open menu"
            className="p-2.5 rounded-md text-gray-300 hover:bg-surface-600">
            <Menu size={22} />
          </button>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 min-w-0" aria-label="Dashboard">
            <Logo size={28} />
            <span className="text-gray-100 font-semibold text-sm truncate">{branding.productName}</span>
          </button>
          <button onClick={openSearch} aria-label="Search"
            className="ml-auto p-2.5 rounded-md text-gray-300 hover:bg-surface-600">
            <Search size={20} />
          </button>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <StorageAlert enabled={user?.role === 'admin'} />
          {children}
        </main>
      </div>

      {/* Global search overlay */}
      <GlobalSearch />

      {/* Change password modal */}
      {changePwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="card w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-accent" />
                <h3 className="text-gray-100 font-semibold text-base">Change Password</h3>
              </div>
              <button onClick={() => setChangePwModal(false)}
                className="text-gray-500 hover:text-gray-300 p-1 rounded-sm transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              <ChangePasswordModal onClose={() => setChangePwModal(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
