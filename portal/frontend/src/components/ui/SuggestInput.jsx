import { useState, useEffect, useRef } from 'react';

/**
 * Text input with a live-search dropdown populated by an async fetch function.
 *
 * Props:
 *   value       – controlled value (string)
 *   onChange    – called with the new string value (not a synthetic event)
 *   fetch       – (query: string) => Promise<string[]>  - called on each keystroke
 *   placeholder, className, autoFocus, disabled – forwarded to the <input>
 *   minChars    – minimum chars before fetching (default 1). Pass 0 to also fetch on
 *                 focus with an empty box - i.e. "show me what's been entered before".
 *   inputProps  – extra attributes spread onto the <input> (e.g. noAutofill, name)
 */
export function SuggestInput({
  value,
  onChange,
  fetch: fetchSuggestions,
  placeholder,
  className = 'input',
  autoFocus,
  disabled,
  minChars = 1,
  inputProps = {},
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen]               = useState(false);
  const [active, setActive]           = useState(-1);   // keyboard-highlighted index
  const containerRef = useRef(null);
  const timerRef     = useRef(null);

  // Close on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setActive(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runFetch = async (q) => {
    try {
      const { data } = await fetchSuggestions(q);
      // Filter out exact match so we don't show "you typed this" as a suggestion.
      const filtered = (data ?? []).filter(s => s !== q);
      setSuggestions(filtered);
      setOpen(filtered.length > 0);
    } catch {
      setSuggestions([]); setOpen(false);
    }
  };

  const handleChange = (e) => {
    const q = e.target.value;
    onChange(q);
    setActive(-1);

    clearTimeout(timerRef.current);
    if (q.length < minChars) { setSuggestions([]); setOpen(false); return; }

    timerRef.current = setTimeout(() => runFetch(q), 200);
  };

  const handleFocus = () => {
    if (suggestions.length > 0) { setOpen(true); return; }
    // minChars 0 → an empty box on focus still offers everything entered before.
    if ((value ?? '').length >= minChars) runFetch(value ?? '');
  };

  const pick = (val) => {
    onChange(val);
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, -1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        {...inputProps}
      />
      {open && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  i === active
                    ? 'bg-surface-600 text-gray-100'
                    : 'text-gray-300 hover:bg-surface-700'
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
