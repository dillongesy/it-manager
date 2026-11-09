import { Check } from 'lucide-react';

// Persistent done/undone checkbox (task lists).
export function DoneCheck({ done, onToggle, size = 20 }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={done ? 'Mark as not done' : 'Mark as done'}
      style={{ width: size, height: size }}
      className={`rounded border flex items-center justify-center shrink-0 transition-colors ${
        done
          ? 'bg-green-600 border-green-600 text-white'
          : 'border-surface-400 text-transparent hover:border-brand hover:text-brand/40'
      }`}
    >
      <Check size={Math.round(size * 0.65)} />
    </button>
  );
}
