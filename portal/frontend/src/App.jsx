import { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AuthProvider }   from './contexts/AuthContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Layout }         from './components/Layout.jsx';
import { Login }          from './pages/Login.jsx';
import { setupApi }       from './api/admin.js';
import { lazyPage }       from './lib/lazyPage.js';

// Every page but Login is its own chunk, fetched on first visit, so signing in
// doesn't download the whole app (rich-text editor, PDF rendering, Admin…).
const Dashboard       = lazyPage(() => import('./pages/Dashboard.jsx'),       'Dashboard');
const Customers       = lazyPage(() => import('./pages/Customers.jsx'),       'Customers');
const CustomerDetail  = lazyPage(() => import('./pages/CustomerDetail.jsx'),  'CustomerDetail');
const WorkOrders      = lazyPage(() => import('./pages/WorkOrders.jsx'),      'WorkOrders');
const WorkOrderDetail = lazyPage(() => import('./pages/WorkOrderDetail.jsx'), 'WorkOrderDetail');
const Inventory       = lazyPage(() => import('./pages/Inventory.jsx'),       'Inventory');
const Orders          = lazyPage(() => import('./pages/Orders.jsx'),          'Orders');
const BillingQueue    = lazyPage(() => import('./pages/BillingQueue.jsx'),    'BillingQueue');
const Tasks           = lazyPage(() => import('./pages/Tasks.jsx'),           'Tasks');
const FieldJobs       = lazyPage(() => import('./pages/FieldJobs.jsx'),       'FieldJobs');
const Services        = lazyPage(() => import('./pages/Services.jsx'),        'Services');
const Admin           = lazyPage(() => import('./pages/Admin.jsx'),           'Admin');
const Setup           = lazyPage(() => import('./pages/Setup.jsx'),           'Setup');
const AuditLog        = lazyPage(() => import('./pages/AuditLog.jsx'),        'AuditLog');
const Certificate     = lazyPage(() => import('./pages/Certificate.jsx'),     'Certificate');

const Blank = () => <div className="min-h-screen bg-surface-900" />;

const Starting = () => (
  <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
    <div className="text-center space-y-2" role="status">
      <Loader2 size={28} className="animate-spin text-gray-400 mx-auto" />
      <p className="text-gray-200">The server is starting</p>
      <p className="text-gray-500 text-sm">This page continues automatically when it is ready.</p>
    </div>
  </div>
);

// Shown in the content area (the nav stays put) while a page's chunk loads.
const PageLoading = () => (
  <div className="flex items-center justify-center py-24 text-surface-400" role="status" aria-label="Loading">
    <Loader2 size={22} className="animate-spin" />
  </div>
);

// A brand-new install (no users yet) sends every page to the setup wizard. While the
// API is still starting (first start runs database migrations), show that and retry.
function SetupGate({ children }) {
  const location = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: setupApi.status,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (query) => (query.state.status === 'error' ? 3000 : false),
  });
  if (isLoading) return <Blank />;
  if (isError && !data) return <Starting />;
  if (data?.needsSetup && location.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return children;
}

function AppRoutes() {
  return (
    <SetupGate>
    <Suspense fallback={<Blank />}>
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/"                  element={<Dashboard />} />
                <Route path="/customers"         element={<Customers />} />
                <Route path="/customers/:id"     element={<CustomerDetail />} />
                <Route path="/work-orders"       element={<WorkOrders />} />
                <Route path="/work-orders/:id"   element={<WorkOrderDetail />} />
                <Route path="/tasks"             element={<Tasks />} />
                <Route path="/backlog"           element={<Navigate to="/tasks" replace />} />
                <Route path="/field-jobs"        element={<FieldJobs />} />
                <Route path="/services"          element={<Services />} />
                <Route path="/inventory"         element={<Inventory />} />
                <Route path="/orders"            element={<Orders />} />
                <Route path="/billing"           element={<BillingQueue />} />
                <Route path="/audit"             element={<AuditLog />} />
                <Route path="/certificate"       element={<Certificate />} />
                <Route path="/admin"             element={
                  <ProtectedRoute roles={['admin']}>
                    <Admin />
                  </ProtectedRoute>
                } />
                <Route path="/settings"          element={<Navigate to="/admin" replace />} />
                <Route path="*"                  element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
    </Suspense>
    </SetupGate>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
