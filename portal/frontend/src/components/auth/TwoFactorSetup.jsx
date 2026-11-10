import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { RecoveryCodes } from './RecoveryCodes.jsx';

// Set up an authenticator app: scan the QR code (or type the key), confirm with a
// code, then save the recovery codes.
//   start()        → { qr, secret }
//   confirm(code)  → { recoveryCodes, ... }
//   onDone(result) called with confirm()'s result after the codes are saved
export function TwoFactorSetup({ start, confirm, onDone, appName, doneLabel }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    start().then(s => { if (live) setSetup(s); })
      .catch(err => { if (live) setError(err.response?.data?.error ?? 'Could not start the setup.'); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      setResult(await confirm(code));
    } catch (err) {
      setError(err.response?.data?.error ?? 'That code is not valid.');
    } finally { setBusy(false); }
  };

  if (result) return <RecoveryCodes codes={result.recoveryCodes} appName={appName} onDone={() => onDone(result)} doneLabel={doneLabel} />;

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md px-3 py-2">
          <AlertCircle size={15} className="shrink-0" /> {error}
        </div>
      )}
      <ol className="list-decimal pl-5 space-y-1 text-gray-400">
        <li>Open an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, Authy or 1Password.</li>
        <li>Scan this QR code, or enter the key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {setup ? (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md bg-white p-1" />
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-1">Key</p>
            <p className="font-mono text-gray-200 break-all tracking-wider select-all">{setup.secret.match(/.{1,4}/g).join(' ')}</p>
          </div>
        </div>
      ) : !error && (
        <p className="flex items-center gap-2 text-gray-500"><Loader2 size={14} className="animate-spin" /> Preparing…</p>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Code from the app</label>
        <input className="input font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code"
          maxLength={7} value={code} onChange={e => setCode(e.target.value)} required placeholder="123456" />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || !setup}>{busy ? 'Checking…' : 'Turn on'}</button>
      </div>
    </form>
  );
}
