import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ScanLine, AlertTriangle } from 'lucide-react';
import { inventoryApi } from '../api/inventory.js';
import BarcodeScanner from '../components/BarcodeScanner.jsx';

const num = (v) => (v == null ? null : Number(v));

export default function Inventory() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (category) params.category = category;
      if (lowStock) params.lowStock = 'true';
      const res = await inventoryApi.list(params);
      setItems(res.data || []);
    } finally {
      setLoading(false);
    }
  }, [search, category, lowStock]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    inventoryApi.categories().then((res) => setCategories(res.data || [])).catch(() => {});
  }, []);

  const handleScan = async (code) => {
    setScanning(false);
    setScanMsg('');
    try {
      const res = await inventoryApi.barcode(code);
      navigate(`/inventory/${res.data.id}`);
    } catch {
      setScanMsg(`No item found for "${code}".`);
    }
  };

  const isLow = (it) => {
    const t = num(it.low_stock_threshold);
    return t != null && num(it.quantity) <= t;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <button onClick={() => navigate('/inventory/new')} className="btn-primary text-sm px-4 py-2">+ New</button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, SKU…"
          className="input flex-1"
        />
        <button onClick={() => setScanning(true)} className="btn-secondary shrink-0 px-4 flex items-center justify-center" aria-label="Scan barcode"><ScanLine size={20} /></button>
      </div>

      {scanMsg && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">{scanMsg}</div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <Chip active={!category && !lowStock} onClick={() => { setCategory(''); setLowStock(false); }}>All</Chip>
        <Chip active={lowStock} onClick={() => { setLowStock(true); setCategory(''); }}><AlertTriangle size={13} className="inline -mt-0.5 mr-1" />Low stock</Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => { setCategory(c); setLowStock(false); }}>{c}</Chip>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No items found.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => navigate(`/inventory/${it.id}`)}
              className="card p-4 w-full text-left flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-semibold truncate">{it.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{it.sku}{it.category ? ` · ${it.category}` : ''}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-lg font-bold ${isLow(it) ? 'text-brand' : ''}`}>{num(it.quantity)}</div>
                {isLow(it) && <div className="text-[10px] text-brand uppercase">Low</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {scanning && <BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm shrink-0 transition-colors ${
        active ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400'
      }`}
    >
      {children}
    </button>
  );
}
