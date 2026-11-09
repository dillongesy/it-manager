import { useState } from 'react';
import { coerceIntervalCount, isAnnualCadence, MAX_INTERVAL_COUNT } from '../utils/cadence.js';

/**
 * Work-order services — labor / one-time fees / recurring charges. Each service:
 *   { description, quantity, unit_price, billing_type, recurrence, recurrence_count }
 * Maps 1:1 to the Portal's work_order_services on import.
 *
 * value:    array of services
 * onChange: (next array) => void
 */
const RECURRENCES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Semi-annual' },
  { value: 'annual', label: 'Annual' },
];

export default function ServicesPicker({ value = [], onChange }) {
  const [desc, setDesc] = useState('');

  const add = () => {
    if (!desc.trim()) return;
    onChange([...value, { description: desc.trim(), quantity: 1, unit_price: '', billing_type: 'one_time', recurrence: 'monthly', recurrence_count: 1 }]);
    setDesc('');
  };

  const set = (idx, patch) =>
    onChange(value.map((sv, i) => (i === idx ? { ...sv, ...patch } : sv)));

  const remove = (idx) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((sv, i) => (
            <div key={i} className="bg-surface-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="text" value={sv.description}
                  onChange={(e) => set(i, { description: e.target.value })}
                  placeholder="Service description"
                  className="input flex-1"
                />
                <button
                  type="button" onClick={() => remove(i)}
                  className="text-gray-500 hover:text-brand text-xl leading-none shrink-0"
                  aria-label="Remove service"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-500">
                  Qty
                  <input
                    type="number" inputMode="numeric" min={1} value={sv.quantity}
                    onChange={(e) => set(i, { quantity: e.target.value })}
                    onBlur={() => set(i, { quantity: Math.max(1, Number(sv.quantity) || 1) })}
                    className="input w-16 text-center"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500 flex-1">
                  $/ea
                  <input
                    type="number" inputMode="decimal" step="0.01" min={0}
                    value={sv.unit_price ?? ''} placeholder="—"
                    onChange={(e) => set(i, { unit_price: e.target.value })}
                    className="input flex-1"
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg overflow-hidden border border-surface-500 text-xs">
                  <button
                    type="button" onClick={() => set(i, { billing_type: 'one_time' })}
                    className={`px-3 py-1.5 ${sv.billing_type !== 'recurring' ? 'bg-brand text-white' : 'text-gray-400'}`}
                  >
                    One-time
                  </button>
                  <button
                    type="button" onClick={() => set(i, { billing_type: 'recurring' })}
                    className={`px-3 py-1.5 ${sv.billing_type === 'recurring' ? 'bg-brand text-white' : 'text-gray-400'}`}
                  >
                    Recurring
                  </button>
                </div>
                {sv.billing_type === 'recurring' && (
                  <select
                    value={sv.recurrence || 'monthly'}
                    onChange={(e) => set(i, {
                      recurrence: e.target.value,
                      // Only a yearly cadence carries a count; switching away resets it.
                      recurrence_count: isAnnualCadence(e.target.value) ? (sv.recurrence_count || 1) : 1,
                    })}
                    className="input flex-1 py-1.5"
                  >
                    {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                )}
                {/* "Annual" is just "every 1 year" — the box turns it into a real
                    multi-year term (a domain bought 3 years at a time) instead of
                    the office having to guess later. */}
                {sv.billing_type === 'recurring' && isAnnualCadence(sv.recurrence) && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                    every
                    <input
                      type="number" inputMode="numeric" min={1} max={MAX_INTERVAL_COUNT}
                      value={sv.recurrence_count ?? 1}
                      onChange={(e) => set(i, { recurrence_count: e.target.value })}
                      onBlur={() => set(i, { recurrence_count: coerceIntervalCount(sv.recurrence_count, sv.recurrence) })}
                      className="input w-14 text-center"
                    />
                    yr
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text" value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a service (e.g. backups, antivirus)…"
          className="input flex-1"
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0">Add</button>
      </div>
    </div>
  );
}
