import { useEffect, useState } from 'react';
import { usersApi } from '../api/users.js';
import { fmtHours, parseHours } from '../utils/jobDays.js';

/**
 * Dual-mode technician picker — the office can do BOTH:
 *  1. Pick from a dropdown of real user accounts (links user_id, fills initials/name).
 *  2. Free-type initials (and optional name) like they write on paper now.
 *
 * With `withHours` each technician also carries the hours THEY worked on THIS day
 * (the day's total is the sum — see utils/jobDays.js). Rows are full-width with a
 * big hours field so they're easy to hit on a phone; without hours they collapse
 * back to compact chips.
 *
 * value:    array of { user_id?, initials, full_name?, hours? }
 * onChange: (next array) => void
 */
export default function TechnicianPicker({ value = [], onChange, withHours = false, disabled = false }) {
  const [users, setUsers] = useState([]);
  const [typedInitials, setTypedInitials] = useState('');
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    usersApi
      .list({ active: true })
      .then((res) => setUsers(res.data || []))
      .catch(() => setUsers([]));
  }, []);

  const has = (initials) =>
    value.some((t) => (t.initials || '').toUpperCase() === (initials || '').toUpperCase());

  const add = (tech) => {
    const initials = (tech.initials || '').trim().toUpperCase();
    if (!initials || has(initials)) return;
    onChange([...value, { user_id: tech.user_id || null, initials, full_name: tech.full_name || null, hours: '' }]);
  };

  const remove = (idx) => onChange(value.filter((_, i) => i !== idx));

  const setHours = (idx, hours) =>
    onChange(value.map((t, i) => (i === idx ? { ...t, hours } : t)));

  const addFromSelect = (e) => {
    const id = e.target.value;
    if (!id) return;
    const u = users.find((x) => String(x.id) === id);
    if (u) add({ user_id: u.id, initials: u.initials, full_name: u.full_name });
    e.target.value = '';
  };

  const addTyped = () => {
    if (!typedInitials.trim()) return;
    add({ initials: typedInitials, full_name: typedName.trim() || null });
    setTypedInitials('');
    setTypedName('');
  };

  const available = users.filter((u) => u.initials && !has(u.initials));
  const total = value.reduce((sum, t) => sum + parseHours(t.hours), 0);
  const anyBlank = withHours && value.some((t) => parseHours(t.hours) === 0);

  if (disabled) {
    return value.length === 0 ? (
      <p className="text-sm text-gray-500">No technicians</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {value.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-2 bg-surface-700 rounded-full px-3 py-1.5 text-sm">
            <span className="font-semibold text-accent">{t.initials}</span>
            {withHours && <span className="text-gray-400">{fmtHours(parseHours(t.hours))}h</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        withHours ? (
          <div className="space-y-2">
            {value.map((t, i) => (
              <div key={`${t.initials}-${i}`} className="flex items-center gap-2 bg-surface-700 rounded-xl p-2">
                <div className="min-w-0 flex-1 pl-1">
                  <div className="font-semibold text-accent leading-tight">{t.initials}</div>
                  {t.full_name && <div className="text-xs text-gray-500 truncate">{t.full_name}</div>}
                </div>
                <input
                  type="number" inputMode="decimal" step="0.25" min={0}
                  value={t.hours ?? ''} placeholder="0"
                  onChange={(e) => setHours(i, e.target.value)}
                  aria-label={`Hours for ${t.initials}`}
                  className="input w-20 text-center px-2 shrink-0"
                />
                <span className="text-sm text-gray-500 shrink-0">h</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-gray-500 hover:text-brand shrink-0 w-9 h-9 flex items-center justify-center text-xl leading-none"
                  aria-label={`Remove ${t.initials}`}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-gray-500">
                {anyBlank && 'Blank hours count as 0'}
              </span>
              <span className="text-gray-400">Day total <span className="text-gray-100 font-semibold">{fmtHours(total)}h</span></span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {value.map((t, i) => (
              <span
                key={`${t.initials}-${i}`}
                className="inline-flex items-center gap-2 bg-surface-700 rounded-full pl-3 pr-2 py-1.5 text-sm"
              >
                <span className="font-semibold text-accent">{t.initials}</span>
                {t.full_name && <span className="text-gray-400">{t.full_name}</span>}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-gray-500 hover:text-brand text-lg leading-none w-5 h-5 flex items-center justify-center"
                  aria-label={`Remove ${t.initials}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )
      )}

      {available.length > 0 && (
        <select className="input" onChange={addFromSelect} defaultValue="">
          <option value="">+ Add from staff…</option>
          {available.map((u) => (
            <option key={u.id} value={u.id}>
              {u.initials} — {u.full_name || u.username}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={typedInitials}
          onChange={(e) => setTypedInitials(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder="Initials"
          autoCapitalize="characters"
          className="input w-24 uppercase"
        />
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder="Name (optional)"
          className="input flex-1"
        />
        <button type="button" onClick={addTyped} className="btn-secondary shrink-0">Add</button>
      </div>
    </div>
  );
}
