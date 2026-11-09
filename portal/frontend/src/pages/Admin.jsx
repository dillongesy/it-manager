import { useSearchParams } from 'react-router';
import { Users, Plug, Palette, ShieldCheck, Server, DollarSign } from 'lucide-react';
import { UsersRoles } from '../components/admin/UsersRoles.jsx';
import { Integrations } from '../components/admin/Integrations.jsx';
import { Branding } from '../components/admin/Branding.jsx';
import { BillingRates } from '../components/admin/BillingRates.jsx';
import { Security, System } from '../components/admin/SecuritySystem.jsx';

// Admin: users and roles, integrations, default billing rates, branding, recovery
// secrets, and system status. Admins only.
const TABS = [
  { id: 'users',        label: 'Users & roles', icon: Users,       Component: UsersRoles },
  { id: 'integrations', label: 'Integrations',  icon: Plug,        Component: Integrations },
  { id: 'billing',      label: 'Billing',       icon: DollarSign,  Component: BillingRates },
  { id: 'branding',     label: 'Branding',      icon: Palette,     Component: Branding },
  { id: 'security',     label: 'Security',      icon: ShieldCheck, Component: Security },
  { id: 'system',       label: 'System',        icon: Server,      Component: System },
];

export function Admin() {
  const [params, setParams] = useSearchParams();
  const active = TABS.find(t => t.id === params.get('tab')) ?? TABS[0];
  const { Component } = active;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-4">Admin</h1>
      <div className="flex gap-1 overflow-x-auto border-b border-surface-600 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setParams({ tab: id }, { replace: true })}
            className={`flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors
              ${active.id === id ? 'border-brand text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <Component />
    </div>
  );
}
