import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Refresh for an admin card. Spins until the data is fetched again; `before` runs
 * first (for example asking the server to re-read something) and is awaited.
 */
export function RefreshButton({ query, queries = [], before, disabled = false, label = 'Refresh' }) {
  const [working, setWorking] = useState(false);
  const all = [query, ...queries].filter(Boolean);
  const spinning = working || all.some(q => q.isFetching);

  const run = async () => {
    setWorking(true);
    try {
      if (before) await before();
      await Promise.all(all.map(q => q.refetch()));
    } catch { /* the card shows its own errors */ } finally {
      setWorking(false);
    }
  };

  return (
    <button type="button" onClick={run} disabled={disabled || spinning} className="btn-ghost text-xs flex items-center gap-1">
      <RefreshCw size={12} className={spinning ? 'animate-spin' : ''} /> {label}
    </button>
  );
}
