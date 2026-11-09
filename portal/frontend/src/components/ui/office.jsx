import { useState, useEffect } from 'react';

// Branch/office helpers shared across customer tabs. An item's `location_id` of NULL
// means the main office (whose details live on the customers row); a UUID means one of
// the customer_locations branch offices.
//
// Filter value semantics: 'all' (everything) | 'main' (location_id NULL) | '<uuid>'.
// Form value semantics:    '' (main office) | '<uuid>' (a branch).

export function branchLabel(loc) {
  return loc.label || loc.business_name || loc.address || 'Branch';
}

export function officeName(locations, locationId, companyName) {
  if (!locationId) return companyName ? `${companyName} (Main)` : 'Main Office';
  const loc = (locations ?? []).find(l => l.id === locationId);
  return loc ? branchLabel(loc) : 'Other office';
}

// Does an item match the active filter value?
export function officeMatches(item, value) {
  if (!value || value === 'all') return true;
  if (value === 'main') return !item.location_id;
  return item.location_id === value;
}

// The office a newly-added item should default to, given the active filter:
// a specific branch → that branch; All/Main → main office ('').
export function defaultOfficeFor(value) {
  return value && value !== 'all' && value !== 'main' ? value : '';
}

// Persisted office filter, scoped per customer + tab. Defaults to 'all'. Resets to
// 'all' if a previously-selected branch no longer exists.
export function useOfficeFilter(customerId, tabKey, locations) {
  const storageKey = `app-office-${customerId}-${tabKey}`;
  const [value, setValue] = useState(() => localStorage.getItem(storageKey) || 'all');

  useEffect(() => {
    if (value !== 'all' && value !== 'main' && !(locations ?? []).some(l => l.id === value)) {
      setValue('all');
      localStorage.removeItem(storageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const set = (v) => { setValue(v); localStorage.setItem(storageKey, v); };
  return [value, set];
}

// Filter chip bar. Renders nothing when the customer has no branch offices.
export function OfficeFilterBar({ locations, companyName, value, onChange, className = '' }) {
  if (!locations?.length) return null;
  const chip = (v, label) => (
    <button key={v} type="button" onClick={() => onChange(v)}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        value === v ? 'bg-brand text-white' : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'
      }`}>{label}</button>
  );
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span className="text-xs text-gray-600 mr-1">Office:</span>
      {chip('all', 'All')}
      {chip('main', companyName ? `${companyName} (Main)` : 'Main Office')}
      {locations.map(l => chip(l.id, branchLabel(l)))}
    </div>
  );
}

// Form dropdown for assigning an item's office. Value '' = main office. Renders
// nothing when there are no branches (everything is implicitly the main office).
export function OfficeSelect({ locations, companyName, value, onChange, label = 'Office' }) {
  if (!locations?.length) return null;
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <select className="input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">{companyName ? `${companyName} (Main Office)` : 'Main Office'}</option>
        {locations.map(l => <option key={l.id} value={l.id}>{branchLabel(l)}</option>)}
      </select>
    </div>
  );
}

// Small read-only badge showing an item's office. Hidden for single-office customers.
export function OfficeBadge({ locations, locationId, companyName, className = '' }) {
  if (!locations?.length) return null;
  return (
    <span className={`badge bg-surface-600 text-gray-400 text-xs ${className}`}>
      {officeName(locations, locationId, companyName)}
    </span>
  );
}
