import { ShoppingCart } from 'lucide-react';
import { OrderLog } from '../components/inventory/OrderLog.jsx';

// Purchase orders — used to live as a sub-tab of Inventory ("Order Log"); now its own
// sidebar page so it gets used. Inventory orders can be received straight into shared
// stock from here (see OrderLog → "Add to inventory").
export function Orders() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-surface-700 flex items-center justify-center shrink-0">
          <ShoppingCart size={18} className="text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Orders</h1>
          <p className="text-gray-500 text-xs">Purchase orders — for customers and for stock</p>
        </div>
      </div>
      <OrderLog />
    </div>
  );
}
