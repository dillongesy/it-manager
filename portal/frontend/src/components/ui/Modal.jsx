import { X } from 'lucide-react';

// Note: dismissal is intentionally limited to the X and the form's Cancel button.
// Esc and backdrop-click do NOT close the modal — these forms hold a lot of typed
// input and accidental dismissal was losing work.
//
// On a phone (below `sm`) the modal takes the whole screen — a centered box with a
// margin left forms a couple of hundred pixels wide. From `sm` up it's the same
// centered card as always.
export const MODAL_OVERLAY = 'fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4';
export const MODAL_PANEL   = 'w-full h-dvh sm:h-auto max-h-dvh sm:max-h-[90vh] flex flex-col shadow-2xl bg-surface-800 border-surface-600 sm:border sm:rounded-lg';

export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div className={`${MODAL_OVERLAY} bg-black/70`}>
      <div className={`${MODAL_PANEL} ${sizes[size]}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-surface-600 shrink-0"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <h3 className="text-gray-100 font-semibold text-base min-w-0 break-words">{title}</h3>
          <button onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-100 transition-colors p-2 -mr-2 sm:p-1 sm:mr-0 rounded-sm shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain flex-1 px-4 sm:px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
