import { Routes, Route, Navigate } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Layout } from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Inventory from './pages/Inventory.jsx';
import InventoryItem from './pages/InventoryItem.jsx';
import InventoryNew from './pages/InventoryNew.jsx';
import WorkOrders from './pages/WorkOrders.jsx';
import WorkOrder from './pages/WorkOrder.jsx';
import Photos from './pages/Photos.jsx';
import Profile from './pages/Profile.jsx';
import Staff from './pages/Staff.jsx';
import Audit from './pages/Audit.jsx';

const page = (el, roles) => (
  <ProtectedRoute roles={roles}>
    <Layout>{el}</Layout>
  </ProtectedRoute>
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<Navigate to="/inventory" replace />} />
      <Route path="/inventory" element={page(<Inventory />)} />
      <Route path="/inventory/new" element={page(<InventoryNew />)} />
      <Route path="/inventory/:id" element={page(<InventoryItem />)} />
      <Route path="/work-orders" element={page(<WorkOrders />)} />
      <Route path="/work-orders/new" element={page(<WorkOrder />)} />
      <Route path="/work-orders/:id" element={page(<WorkOrder />)} />
      <Route path="/photos" element={page(<Photos />)} />
      <Route path="/profile" element={page(<Profile />)} />
      <Route path="/staff" element={page(<Staff />, ['admin'])} />
      <Route path="/audit" element={page(<Audit />, ['admin'])} />

      <Route path="*" element={<Navigate to="/inventory" replace />} />
    </Routes>
  );
}
