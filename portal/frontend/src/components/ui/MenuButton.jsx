import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

// A button that opens a short list of actions.
//   items: [{ label, icon: LucideIcon, onClick, hint?, disabled? }]
// Closes on a pick, a click outside, or Esc.
// compact: a small ghost button (for a device card's header) instead of a toolbar button.
export function MenuButton({ label, icon: Icon, items, className = '', align = 'right', compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open}
        className={compact
          ? 'btn-ghost px-2 py-1 text-xs flex items-center gap-1 text-accent whitespace-nowrap'
          : 'btn-secondary w-full flex items-center justify-center gap-2 text-sm whitespace-nowrap'}>
        {Icon && <Icon size={compact ? 13 : 14} />} {label} <ChevronDown size={compact ? 11 : 13} className="text-gray-500" />
      </button>
      {open && (
        <div role="menu"
          className={`absolute z-30 mt-1 min-w-full w-64 max-w-[calc(100vw-2rem)] card py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map(item => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
              className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              {item.icon && <item.icon size={15} className="text-gray-400 mt-0.5 shrink-0" />}
              <span className="min-w-0">
                <span className="block text-sm text-gray-200">{item.label}</span>
                {item.hint && <span className="block text-xs text-gray-500">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
