import { useState } from 'react';
import { Modal } from '../../ui/Modal.jsx';

// Pieces the schedule's views share: drag-and-drop between them, and the "this event or the
// whole series?" question every change to a repeating event asks first.

export const DRAG_TYPE = 'application/x-app-task';
export const DRAG_EVENT = 'application/x-app-outlook-event';

/** A day (or the "Not scheduled yet" panel) that takes dropped tasks, and Outlook events when onDropEvent is given. */
export function DropZone({ onDropTask, onDropEvent, className = '', children, ...rest }) {
  const [over, setOver] = useState(false);
  const accepts = (types) => types.includes(DRAG_TYPE) || (onDropEvent && types.includes(DRAG_EVENT));
  return (
    <div {...rest}
      onDragOver={e => { if (accepts(e.dataTransfer.types)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false);
        const task = e.dataTransfer.getData(DRAG_TYPE);
        const event = onDropEvent && e.dataTransfer.getData(DRAG_EVENT);
        if (task) onDropTask?.(task); else if (event) onDropEvent(event);
      }}
      className={`${className} ${over ? 'ring-2 ring-inset ring-accent/70 bg-accent/5' : ''}`}>
      {children}
    </div>
  );
}

/**
 * Ask a question with a few choices; resolves with the chosen value, or null if cancelled.
 *   const [ask, dialog] = useAsk();  …  const scope = await ask({ title, options: [{ value, label, hint, disabled }] });
 */
export function useAsk() {
  const [q, setQ] = useState(null);
  const ask = (cfg) => new Promise(resolve => setQ({ ...cfg, resolve }));
  const done = (v) => { q?.resolve(v); setQ(null); };
  const dialog = q ? <AskDialog key={q.title} {...q} onDone={done} /> : null;
  return [ask, dialog];
}

function AskDialog({ title, message, options, confirmLabel = 'OK', danger = false, onDone }) {
  const [value, setValue] = useState(options.find(o => !o.disabled)?.value ?? null);
  return (
    <Modal open onClose={() => onDone(null)} title={title} size="sm">
      <div className="space-y-4">
        {message && <p className="text-sm text-gray-400">{message}</p>}
        <div className="space-y-2" role="radiogroup" aria-label={title}>
          {options.map(o => (
            <label key={o.value} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors
              ${o.disabled ? 'opacity-50 cursor-not-allowed border-surface-700' : value === o.value ? 'border-brand bg-brand/10' : 'border-surface-600 hover:bg-surface-700/50'}`}>
              <input type="radio" name="ask" className="accent-brand mt-1" disabled={o.disabled} checked={value === o.value} onChange={() => setValue(o.value)} />
              <span className="min-w-0">
                <span className="block text-sm text-gray-200">{o.label}</span>
                {o.hint && <span className="block text-xs text-gray-500 mt-0.5">{o.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => onDone(null)} className="btn-secondary">Cancel</button>
          <button onClick={() => onDone(value)} disabled={value == null} className={danger ? 'btn-primary bg-red-700 hover:bg-red-600' : 'btn-primary'} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
