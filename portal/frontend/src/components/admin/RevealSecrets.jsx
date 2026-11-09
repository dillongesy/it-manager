import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Download, Eye, Lock, ShieldCheck, Check } from 'lucide-react';
import { adminApi } from '../../api/admin.js';

// The recovery secrets (master encryption key, DB passwords, signing secrets) were
// generated on first boot. They can be revealed through the app EXACTLY ONCE:
// the server shreds them the instant they're sent, and the endpoint refuses
// forever after. This component holds them only in memory, for this page view.

function toEnvText(secrets) {
  const lines = [
    '# Recovery secrets — generated on first boot.',
    `# Revealed ${new Date().toLocaleString()}. Store offline (password manager / safe).`,
    '# ENCRYPTION_KEY decrypts every stored credential: without it they are unrecoverable.',
    '',
  ];
  for (const [group, value] of Object.entries(secrets)) {
    if (value && typeof value === 'object') {
      lines.push(`[${group}]`);
      for (const [k, v] of Object.entries(value)) lines.push(`${k}=${v}`);
      lines.push('');
    } else {
      lines.push(`# ${group}: ${value}`);
    }
  }
  return lines.join('\n');
}

function SecretsView({ secrets, onDone }) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const text = toEnvText(secrets);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `recovery-secrets-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md p-3 text-sm">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>
          <strong>This is the only time these will ever be shown.</strong> They have already been destroyed on the server.
          Save them now — download or copy them into a password manager. Leaving this page discards them.
        </div>
      </div>
      <pre className="bg-surface-900 border border-surface-600 rounded-md p-3 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre select-all max-h-80">{text}</pre>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} className="btn-primary flex items-center gap-2 text-sm"><Download size={14} /> Download .txt</button>
        <button type="button" onClick={copy} className="btn-secondary flex items-center gap-2 text-sm">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {onDone && (
        <div className="border-t border-surface-600 pt-4 space-y-3">
          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" className="mt-1" checked={ack} onChange={e => setAck(e.target.checked)} />
            I have saved these secrets somewhere safe. I understand they can never be shown again.
          </label>
          <button type="button" disabled={!ack} onClick={onDone} className="btn-primary text-sm">Continue</button>
        </div>
      )}
    </div>
  );
}

export function RevealSecrets({ onDone, compact = false }) {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({ queryKey: ['admin', 'security'], queryFn: adminApi.security });
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [secrets, setSecrets] = useState(null);

  if (secrets) return <SecretsView secrets={secrets} onDone={onDone} />;
  if (isLoading || !status) return <p className="text-gray-500 text-sm">Loading…</p>;

  if (status.secretsRevealedAt) {
    return (
      <div className="flex gap-3 text-sm">
        <Lock size={18} className="text-gray-500 shrink-0 mt-0.5" />
        <div className="text-gray-400">
          Revealed on <span className="text-gray-200">{new Date(status.secretsRevealedAt).toLocaleString()}</span>
          {status.secretsRevealedBy && <> by <span className="text-gray-200">{status.secretsRevealedBy}</span></>}.
          The reveal has self-destructed — the app can never show these again. Only someone with root access
          to the server can read them (see the README, “Recovering secrets as root”).
          {onDone && <div className="mt-3"><button className="btn-primary text-sm" onClick={onDone}>Continue</button></div>}
        </div>
      </div>
    );
  }

  if (!status.secretsAvailable) {
    return (
      <div className="flex gap-3 text-sm text-gray-400">
        <ShieldCheck size={18} className="text-gray-500 shrink-0 mt-0.5" />
        <div>
          {status.managedSecrets
            ? 'No recovery bundle exists on this server (it was removed, or this install was migrated). Secrets can only be read by root on the host.'
            : 'This server is not running with managed secrets (local development) — its secrets are in the backend .env file.'}
          {onDone && <div className="mt-3"><button className="btn-primary text-sm" onClick={onDone}>Continue</button></div>}
        </div>
      </div>
    );
  }

  const reveal = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await adminApi.reveal(password);
      setSecrets(data.secrets);
      setPassword('');
      qc.invalidateQueries({ queryKey: ['admin', 'security'] });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not reveal the secrets.');
      if (err.response?.status === 410) qc.invalidateQueries({ queryKey: ['admin', 'security'] });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={reveal} className="space-y-4">
      {!compact && (
        <p className="text-sm text-gray-400">
          On first boot the server generated the master encryption key (it protects every stored password),
          the database passwords and the signing secrets. Reveal them once and store them offline —
          you need the encryption key to restore a backup on a new server.
        </p>
      )}
      <div className="flex gap-2 bg-amber-900/30 border border-amber-900 text-amber-400 rounded-md p-3 text-sm">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>Revealing <strong>destroys</strong> the server's copy of this bundle. It works exactly once, for anyone, ever.</div>
      </div>
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
      <label className="flex items-start gap-2 text-sm text-gray-300">
        <input type="checkbox" className="mt-1" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
        I'm ready to save them right now (password manager or downloaded file).
      </label>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Confirm your password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      <button type="submit" disabled={busy || !understood || !password} className="btn-primary flex items-center gap-2 text-sm">
        <Eye size={14} /> {busy ? 'Revealing…' : 'Reveal once'}
      </button>
    </form>
  );
}
