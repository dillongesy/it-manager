import { useEffect } from 'react';

/**
 * Mobile-friendly modal: bottom sheet on phones, centered card on larger screens.
 * Tap the backdrop or × to close.
 */
export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-surface-800 border border-surface-600 rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-2xl leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
