import { useState } from 'react';
import { Copy, Download, Check } from 'lucide-react';

// One-time recovery codes, shown once. The user confirms they saved them to continue.
export function RecoveryCodes({ codes, appName, onDone, doneLabel = 'Continue' }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard unavailable */ }
  };
  const download = () => {
    const blob = new Blob([`${appName} recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-400">
        Save these recovery codes somewhere safe, such as a password manager. Each one signs you in once
        if you lose your phone. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-gray-100 bg-surface-900 border border-surface-600 rounded-md p-3">
        {codes.map(c => <li key={c} className="tracking-wider">{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-xs flex items-center gap-1.5" onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn-secondary text-xs flex items-center gap-1.5" onClick={download}>
          <Download size={13} /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-gray-300">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
        I have saved my recovery codes
      </label>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={!saved} onClick={onDone}>{doneLabel}</button>
      </div>
    </div>
  );
}
