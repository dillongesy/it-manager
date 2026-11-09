import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../api/customers.js';

// Searchable customer dropdown (like the New Work Order picker). Calls
// onChange(customerId, customerName) when a customer is chosen, or ('', '') while typing.
export function CustomerPicker({ value, initialName = '', onChange }) {
  const [search, setSearch] = useState(initialName);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', 'picker', search],
    queryFn: () => customersApi.list({ search: search || undefined }).then(r => r.data),
    staleTime: 15_000,
  });

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (c) => { onChange(c.id, c.name); setSearch(c.name); setOpen(false); };

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input" placeholder="Search customers…" value={search} autoComplete="off"
        onChange={(e) => { setSearch(e.target.value); setOpen(true); if (value) onChange('', ''); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden max-h-56 overflow-y-auto shadow-xl">
          {customers.length === 0
            ? <p className="text-gray-500 text-sm p-3">No customers found.</p>
            : customers.map(c => (
              <button key={c.id} type="button" onClick={() => pick(c)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-600 transition-colors ${
                  value === c.id ? 'bg-brand/20 text-brand' : 'text-gray-300'
                }`}>
                {c.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
