import { NavLink, useNavigate } from 'react-router';
import { Package, ClipboardList, Camera, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Logo } from './Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const NAV = [
  { to: '/inventory',   label: 'Inventory',    icon: Package },
  { to: '/work-orders', label: 'Jobs',          icon: ClipboardList },
  { to: '/photos',      label: 'Photos',       icon: Camera },
  { to: '/profile',     label: 'Profile',      icon: User },
];

export function Layout({ children }) {
  const { fieldAppName } = useBranding();
  return (
    <div className="flex flex-col h-app bg-surface-900 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-2.5 px-4 py-3 bg-surface-800 border-b border-surface-600 shrink-0 safe-top">
        <Logo size={28} />
        <span className="text-gray-100 font-semibold text-sm truncate">{fieldAppName}</span>
        <ThemeToggle className="ml-auto -my-1" />
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        {children}
      </main>

      {/* Bottom nav — native-style tab bar that clears the home indicator / gesture bar */}
      <nav className="flex border-t border-surface-600 bg-surface-800 shrink-0 pb-nav safe-x">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 min-h-13 text-[11px] font-medium transition-colors ${
                isActive ? 'text-brand' : 'text-gray-500 hover:text-gray-300 active:text-gray-200'
              }`
            }
          >
            <Icon size={22} />
            <span className="leading-none">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
