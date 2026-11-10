import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, KeyRound } from 'lucide-react';
import { mfaApi } from '../../api/mfa.js';
import { useBranding } from '../../contexts/BrandingContext.jsx';
import { TwoFactorSetup } from './TwoFactorSetup.jsx';
import { RecoveryCodes } from './RecoveryCodes.jsx';

// The signed-in user's own two-factor authentication: turn it on, get new recovery
// codes, or turn it off (unless the administrator requires it).

function PasswordPrompt({ label, danger, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await onSubmit(password); } catch (err) { setError(err.response?.data?.error ?? 'Something went wrong.'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium text-gray-400">Confirm with your password</label>
      <input className="input" type="password" autoComplete="current-password" autoFocus value={password}
        onChange={e => setPassword(e.target.value)} required />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className={danger ? 'btn-primary bg-red-700 hover:bg-red-600' : 'btn-primary'} disabled={busy}>{busy ? 'Working…' : label}</button>
      </div>
    </form>
  );
}

export function TwoFactorAccount({ onClose }) {
  const branding = useBranding();
  const appName = [branding.companyName, branding.fieldAppName].filter(Boolean).join(' ') || 'Field App';
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('view');   // view | setup | codes | disable | newcodes
  const [codes, setCodes] = useState(null);

  const refresh = useCallback(() => {
    mfaApi.status().then(setData).catch(err => setLoadError(err.response?.data?.error ?? 'Could not load.'));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (loadError) return <p className="text-red-400 text-sm">{loadError}</p>;
  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;

  if (data.policy === 'off') {
    return <p className="text-gray-400 text-sm">Two-factor authentication is turned off for this app by your administrator.</p>;
  }

  if (mode === 'setup') {
    return (
      <TwoFactorSetup
        appName={appName}
        start={() => mfaApi.enrollStart()}
        confirm={(code) => mfaApi.enrollConfirm(code)}
        onDone={() => { refresh(); setMode('view'); }}
        doneLabel="Done"
      />
    );
  }
  if (mode === 'codes' && codes) {
    return <RecoveryCodes codes={codes} appName={appName} onDone={() => { setCodes(null); refresh(); setMode('view'); }} doneLabel="Done" />;
  }
  if (mode === 'newcodes') {
    return (
      <PasswordPrompt label="Create new codes" onCancel={() => setMode('view')}
        onSubmit={async (password) => { const r = await mfaApi.recoveryCodes(password); setCodes(r.recoveryCodes); setMode('codes'); }} />
    );
  }
  if (mode === 'disable') {
    return (
      <PasswordPrompt label="Turn off" danger onCancel={() => setMode('view')}
        onSubmit={async (password) => { await mfaApi.disable(password); refresh(); setMode('view'); }} />
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {data.enrolled ? (
        <>
          <p className="flex items-center gap-2 text-green-400"><ShieldCheck size={16} /> Two-factor authentication is on.</p>
          <p className="text-gray-400">
            Turned on {new Date(data.enabledAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.{' '}
            {data.recoveryCodesLeft} unused recovery code{data.recoveryCodesLeft === 1 ? '' : 's'} left.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={() => setMode('newcodes')}>
              <KeyRound size={14} /> New recovery codes
            </button>
            {data.policy !== 'required' && (
              <button type="button" className="btn-ghost text-red-400 flex items-center gap-1.5" onClick={() => setMode('disable')}>
                <ShieldOff size={14} /> Turn off
              </button>
            )}
          </div>
          {data.policy === 'required' && <p className="text-gray-500 text-xs">Your administrator requires two-factor authentication.</p>}
        </>
      ) : (
        <>
          <p className="text-gray-400">
            Protect your account with a code from an authenticator app on your phone, in addition to your password.
          </p>
          <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setMode('setup')}>
            <ShieldCheck size={14} /> Set up two-factor authentication
          </button>
        </>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
