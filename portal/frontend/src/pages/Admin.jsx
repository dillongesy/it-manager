import { useSearchParams } from 'react-router';
import { Users, Plug, Palette, ShieldCheck, Server, DollarSign, BadgeCheck, DatabaseBackup } from 'lucide-react';
import { UsersRoles } from '../components/admin/UsersRoles.jsx';
import { Integrations } from '../components/admin/Integrations.jsx';
import { Branding } from '../components/admin/Branding.jsx';
import { BillingRates } from '../components/admin/BillingRates.jsx';
import { Security, System } from '../components/admin/SecuritySystem.jsx';
import { CertificateGuide } from '../components/help/CertificateGuide.jsx';
import { Backups } from '../components/admin/Backups.jsx';

// Admin: users and roles, integrations, default billing rates, branding, recovery
// secrets, system status, backups, and the certificate guide. Admins only (the
// certificate guide is also at /certificate for everyone).
const TABS = [
  { id: 'users',        label: 'Users & roles', icon: Users,       Component: UsersRoles },
  { id: 'integrations', label: 'Integrations',  icon: Plug,        Component: Integrations },
  { id: 'billing',      label: 'Billing',       icon: DollarSign,  Component: BillingRates },
  { id: 'branding',     label: 'Branding',      icon: Palette,     Component: Branding },
  { id: 'security',     label: 'Security',      icon: ShieldCheck, Component: Security },
  { id: 'system',       label: 'System',        icon: Server,      Component: System },
  { id: 'backups',      label: 'Backups',       icon: DatabaseBackup, Component: Backups },
  { id: 'certificate',  label: 'Certificate',   icon: BadgeCheck,  Component: CertificateGuide },
];

export function Admin() {
  const [params, setParams] = useSearchParams();
  const active = TABS.find(t => t.id === params.get('tab')) ?? TABS[0];
  const { Component } = active;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-4">Admin</h1>
      <div className="flex flex-wrap gap-x-1 border-b border-surface-600 mb-6">
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
