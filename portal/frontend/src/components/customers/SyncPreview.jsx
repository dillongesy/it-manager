import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

// Shared pieces of the "import / sync" dialogs: every row says what will happen
// (new, update · N fields, up to date, needs attention) and can expand into exactly
// which fields change, old → new.
//
// ConnectWise and UniFi merge the same way (backend lib/sync-merge.js): blanks are filled
// and new items added; a value already on file that the source reports differently is
// KEPT (preview.differs) unless the person ticks "Also replace values that changed".

/** What a row will do once the "replace values that changed" choice is applied. */
export function effectiveAction(preview, takeNewer = false) {
  const extra = takeNewer ? (preview?.differs?.length ?? 0) : 0;
  const count = (preview?.changes?.length ?? 0) + extra;
  if (preview?.action === 'unchanged' && extra) return { action: 'update', count };
  return { action: preview?.action, count };
}

/** How many of these rows have values that differ from what's on file. */
export const countDiffers = (rows) => (rows ?? []).filter(r => r?.preview?.differs?.length).length;

export function ActionChip({ action, count = 0, createLabel = 'New' }) {
  const map = {
    create:    [createLabel, 'bg-green-900/30 text-green-400'],
    fill:      ['Fill in', 'bg-green-900/30 text-green-400'],
    update:    [count ? `Update · ${count} field${count !== 1 ? 's' : ''}` : 'Update', 'bg-amber-900/40 text-amber-400'],
    unchanged: ['Up to date', 'bg-surface-600 text-gray-400'],
    ambiguous: ['Needs attention', 'bg-red-900/40 text-red-400'],
    not_found: ['Not found', 'bg-surface-600 text-gray-500'],
    no_tag:    ['No service tag', 'bg-surface-600 text-gray-500'],
  };
  const [label, cls] = map[action] ?? map.create;
  return <span className={`badge ${cls} shrink-0`}>{label}</span>;
}

/**
 * "Updates <name> (matched by …) ▸ what changes · ▸ 2 kept as they are" plus the
 * expandable lists. With takeNewer the kept values are listed as changes instead.
 * @param source "ConnectWise" / "UniFi" — named in the kept-values list
 */
export function MatchLine({ preview, labels, noun = 'device', takeNewer = false, source = 'the source' }) {
  const [open, setOpen] = useState(false);
  const [openKept, setOpenKept] = useState(false);
  const target = preview.device ?? preview.camera ?? preview.credential ?? preview.charge;
  const differs = preview.differs ?? [];
  const changes = takeNewer ? [...preview.changes, ...differs] : preview.changes;
  const { action } = effectiveAction(preview, takeNewer);
  return (
    <>
      {target && (
        <p className="text-xs text-gray-400 mt-1">
          {action === 'unchanged' ? 'Matches' : 'Updates'} <span className="text-gray-200">{target.name}</span>
          <span className="text-gray-600"> (matched by {preview.reason})</span>
          {changes.length > 0 && (
            <button type="button" onClick={() => setOpen(v => !v)}
              className="ml-2 text-accent hover:underline inline-flex items-center gap-0.5">
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} what changes
            </button>
          )}
          {!takeNewer && differs.length > 0 && (
            <button type="button" onClick={() => setOpenKept(v => !v)}
              className="ml-2 text-gray-500 hover:text-gray-300 hover:underline inline-flex items-center gap-0.5"
              title={`${source} reports different values for these. What's on file is kept.`}>
              {openKept ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {differs.length} kept as {differs.length === 1 ? 'it is' : 'they are'}
            </button>
          )}
        </p>
      )}
      {open && <ChangeList changes={changes} labels={labels} />}
      {openKept && !takeNewer && <KeptList differs={differs} labels={labels} source={source} />}
      {preview.action === 'ambiguous' && (
        <p className="text-xs text-red-400 mt-1">
          {preview.candidates.length} {noun}s here share this name ({preview.candidates.map(c => c.name).join(', ')}).
          Rename one so they can be told apart{noun === 'device' || noun === 'camera' ? ' (or put the MAC on the right one)' : ''}, then try again.
        </p>
      )}
    </>
  );
}

export function ChangeList({ changes, labels = {} }) {
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {changes.map((c, i) => (
        <li key={`${c.field}-${i}`} className="text-gray-400">
          <span className="text-gray-500">{labels[c.field] ?? c.field}:</span>{' '}
          {c.mode === 'fill' || c.mode === 'add'
            ? <><span className="text-green-400">add</span> <span className="whitespace-pre-line break-words">{c.to}</span></>
            : <>
                <span className="line-through text-gray-600 whitespace-pre-line break-words">{c.from}</span>
                {String(c.to).includes('\n') ? <br /> : ' → '}
                <span className="whitespace-pre-line break-words">{c.to}</span>
              </>}
        </li>
      ))}
    </ul>
  );
}

/** Values on file that the source reports differently — kept, shown side by side. */
export function KeptList({ differs, labels = {}, source }) {
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {differs.map((c, i) => (
        <li key={`${c.field}-${i}`} className="text-gray-400">
          <span className="text-gray-500">{labels[c.field] ?? c.field}:</span>{' '}
          <span className="text-gray-300 whitespace-pre-line break-words">{c.from}</span>
          <span className="text-gray-600">{String(c.to).includes('\n') ? <br /> : ' · '}{source} has </span>
          <span className="text-gray-500 whitespace-pre-line break-words">{c.to}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one choice about records already on file. Off (the default): only blanks are filled
 * and new items added — nothing typed in or imported earlier is replaced. On: values the
 * source reports differently replace what's there. Hidden when nothing differs.
 */
export function NewerToggle({ source, count, checked, onChange }) {
  if (!count) return null;
  return (
    <label className="card p-3 flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
      <input type="checkbox" className="h-4 w-4 mt-0.5 accent-brand" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="text-gray-200 font-medium">Also replace values that changed in {source}</span>
        <span className="block mt-0.5">
          {count} record{count !== 1 ? 's' : ''} on file {count !== 1 ? 'have' : 'has'} values {source} reports differently (an IP, OS, firmware…).
          {checked ? ` They'll be replaced with ${source}'s.` : ' They\'re kept as they are — imports only fill in blanks and add what\'s new.'}
        </span>
      </span>
    </label>
  );
}

/** One titled block of an import summary. */
export function ResultSection({ title, rows, className, render }) {
  if (!rows?.length) return null;
  return (
    <div>
      <p className={`text-sm font-medium mb-1 ${className}`}>{title} ({rows.length})</p>
      <ul className="text-sm text-gray-300 space-y-0.5 pl-1">{rows.map((r, i) => <li key={i}>{render(r)}</li>)}</ul>
    </div>
  );
}

/** "This isn't set up yet" — numbered steps and a Close button. */
export function SetupSteps({ title, steps, onClose }) {
  return (
    <div className="space-y-3 text-sm text-gray-400">
      <p className="text-gray-200 font-medium">{title}</p>
      <ol className="list-decimal pl-5 space-y-1">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Close</button></div>
    </div>
  );
}

export const Env = ({ children }) => <code className="text-accent">{children}</code>;

/**
 * "Import into office" — the top of every import dialog for a customer with branch
 * offices. New records go to the chosen office; with "move" ticked, records already on
 * file (matched by the import) move there too. `elsewhere` counts matched records that
 * currently sit in a different office, so the tech sees what ticking it would do.
 * Hidden for single-office customers (there's nowhere else to put anything).
 */
export function OfficeTarget({ locations, companyName, value, onChange, move, onMoveChange, elsewhere = 0, noun = 'devices' }) {
  if (!locations?.length) return null;
  return (
    <div className="card p-3 space-y-2 border-accent/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-300 font-medium">Import into office:</span>
        <select className="input py-1 w-auto max-w-full" value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">{companyName ? `${companyName} (Main Office)` : 'Main Office'}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.label || l.business_name || l.address || 'Branch'}</option>)}
        </select>
      </div>
      {onMoveChange && (
        <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 mt-0.5 accent-brand" checked={move} onChange={e => onMoveChange(e.target.checked)} />
          <span>
            Also move {noun} already on file into this office
            {elsewhere > 0 && <span className="text-amber-400"> — {elsewhere} matched {elsewhere === 1 ? 'one is' : 'ones are'} in a different office now</span>}
          </span>
        </label>
      )}
    </div>
  );
}
