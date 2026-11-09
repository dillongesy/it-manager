import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Free-text input with a filter-as-you-type dropdown of existing options.
 * Typing filters the list; the user may pick an existing option OR keep their
 * typed text to create a new one. Used for credential sections and file categories.
 */
export function Combobox({ value, onChange, options = [], placeholder, required }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = (value ?? '').toLowerCase();
  const filtered = options.filter(o => o.toLowerCase().includes(q) && o.toLowerCase() !== q);

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <input
          className="input pr-8"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
        />
        <button type="button" tabIndex={-1} onClick={() => setOpen(o => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-1">
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-surface-700 border border-surface-500 rounded-md max-h-48 overflow-y-auto shadow-xl">
          {filtered.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-surface-600"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
