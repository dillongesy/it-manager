import { useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, Building2, Monitor, KeyRound,
  Camera, ClipboardList, BookOpen, Paperclip, FileSignature, BadgeCheck, Trash2, ListTodo, Receipt
} from 'lucide-react';
import { customersApi } from '../api/customers.js';
import { OverviewTab }     from '../components/customers/OverviewTab.jsx';
import { DevicesTab }      from '../components/customers/DevicesTab.jsx';
import { CredentialsTab }  from '../components/customers/CredentialsTab.jsx';
import { CamerasTab }      from '../components/customers/CamerasTab.jsx';
import { GuidesTab }       from '../components/customers/GuidesTab.jsx';
import { ProposalsTab }    from '../components/customers/ProposalsTab.jsx';
import { FilesTab }        from '../components/customers/FilesTab.jsx';
import { WorkOrdersTab }   from '../components/customers/WorkOrdersTab.jsx';
import { LicensingTab }    from '../components/customers/LicensingTab.jsx';
import { BillingTab }      from '../components/customers/BillingTab.jsx';
import { TasksTab }        from '../components/customers/TasksTab.jsx';


const TABS = [
  { id: 'overview',     label: 'Overview',     icon: Building2    },
  { id: 'devices',      label: 'Devices',      icon: Monitor      },
  { id: 'credentials',  label: 'Credentials',  icon: KeyRound     },
  { id: 'cameras',      label: 'Cameras',      icon: Camera       },
  { id: 'work-orders',  label: 'Work Orders',  icon: ClipboardList },
  { id: 'tasks',        label: 'Tasks',        icon: ListTodo     },
  { id: 'guides',       label: 'Guides',       icon: BookOpen     },
  { id: 'proposals',    label: 'Proposals',    icon: FileSignature },
  { id: 'files',        label: 'Files',        icon: Paperclip    },
  { id: 'licensing',    label: 'Licensing',    icon: BadgeCheck   },
  { id: 'billing',      label: 'Billing',      icon: Receipt      },
];

export function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  // ?tab=todos is the old name of the Tasks tab (links from before the Tasks change).
  const tab = sp.get('tab') === 'todos' ? 'tasks' : (sp.get('tab') ?? 'overview');

  const { data: customer, isLoading, error, refetch } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customersApi.get(id).then(r => r.data),
  });

  const setTab = (t) => setSp({ tab: t }, { replace: true });

  // The tab strip scrolls sideways when it doesn't fit (phones, narrow windows) —
  // keep the active tab in view, e.g. after a deep link to ?tab=billing.
  const tabsRef = useRef(null);
  useEffect(() => {
    const center = () => {
      const nav = tabsRef.current;
      const btn = nav?.querySelector('[data-active="true"]');
      if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
      nav.scrollLeft = btn.offsetLeft - nav.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2;
    };
    center();
    // Tab widths change once the web font loads — re-center then.
    document.fonts?.ready.then(center).catch(() => {});
  }, [tab, customer?.id]);

  const onUpdate = () => {
    refetch();
    qc.invalidateQueries(['customers']);
  };

  const deleteCustomer = async () => {
    if (!confirm(`Archive customer "${customer.name}"? They will no longer appear in the list.`)) return;
    await customersApi.remove(id);
    navigate('/customers');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !customer) {
    return <div className="p-4 sm:p-6 text-red-400">Customer not found.</div>;
  }

  const locations = customer.locations ?? [];

  return (
    <div className="flex flex-col lg:h-full">
      {/* Header */}
      <div className="px-4 pt-4 sm:px-6 sm:pt-6 pb-0 border-b border-surface-700">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-3 min-w-0">
          <Link to="/customers" className="hover:text-gray-400 transition-colors shrink-0">Customers</Link>
          <ChevronRight size={12} className="shrink-0" />
          <span className="text-gray-400 truncate">{customer.name}</span>
        </div>

        {/* Customer name + meta */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-100 break-words">{customer.name}</h1>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm text-gray-500">
              {customer.city && <span>{[customer.city, customer.state].filter(Boolean).join(', ')}</span>}
              {customer.phone && <span>{customer.phone}</span>}
            </div>
          </div>
          <button onClick={deleteCustomer} className="btn-ghost text-xs flex items-center gap-1.5 text-gray-600 hover:text-red-400 shrink-0">
            <Trash2 size={12} /> Archive
          </button>
        </div>

        {/* Tabs */}
        <nav ref={tabsRef}
          className="flex gap-0 -mb-px -mx-4 px-2 sm:mx-0 sm:px-0 overflow-x-auto overscroll-x-contain max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
          {TABS.map(({ id: tid, label, icon: Icon }) => (
            <button
              key={tid}
              data-active={tab === tid}
              onClick={() => setTab(tid)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 sm:py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === tid
                  ? 'border-brand text-gray-100'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-surface-500'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 lg:overflow-y-auto p-4 sm:p-6">
        <div className="max-w-5xl mx-auto">
          {tab === 'overview'    && <OverviewTab    customer={customer} onUpdate={onUpdate} />}
          {tab === 'devices'     && <DevicesTab     customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'credentials' && <CredentialsTab customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'cameras'     && <CamerasTab     customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'work-orders' && <WorkOrdersTab customerId={id} />}
          {tab === 'tasks'       && <TasksTab       customerId={id} companyName={customer.name} />}
          {tab === 'guides'      && <GuidesTab      customerId={id} />}
          {tab === 'proposals'   && <ProposalsTab   customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'files'       && <FilesTab       customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'licensing'   && <LicensingTab   customerId={id} locations={locations} companyName={customer.name} />}
          {tab === 'billing'     && <BillingTab     customerId={id} locations={locations} companyName={customer.name} />}
        </div>
      </div>
    </div>
  );
}
