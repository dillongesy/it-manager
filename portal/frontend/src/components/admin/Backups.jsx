import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup, Play, ShieldCheck, Shield, Trash2, RotateCcw, CheckCircle2, XCircle,
  Lock, KeyRound, AlertTriangle, Loader2, HardDrive, Clock, FlaskConical,
} from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { formatBytes } from './Storage.jsx';
import { parseSchedule } from './HostSettings.jsx';
import { HostLog } from './HostLog.jsx';
import { RefreshButton } from './RefreshButton.jsx';
import { Modal } from '../ui/Modal.jsx';
import { PasswordInput } from '../ui/PasswordInput.jsx';

// Admin → Backups: schedule, retention, storage, encryption and the list of backups,
// applied by the host helper (scripts/backup.sh). Restores need the admin's password.

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const KEEP = [['last', 'Keep last'], ['daily', 'Keep daily'], ['weekly', 'Keep weekly'], ['monthly', 'Keep monthly'], ['yearly', 'Keep yearly']];
const pad = (n) => String(n).padStart(2, '0');

/** 'weekly:mon,wed:01:30' ↔ { frequency, days, time } */
export function parseBackupSchedule(value) {
  const s = String(value || 'off');
  if (s.startsWith('daily:')) return { frequency: 'daily', days: ['sun'], time: s.slice(6) };
  if (s.startsWith('weekly:')) {
    const rest = s.slice(7);
    const i = rest.indexOf(':');
    return { frequency: 'weekly', days: rest.slice(0, i).split(','), time: rest.slice(i + 1) };
  }
  return { frequency: 'off', days: ['sun'], time: '01:00' };
}
export function formatBackupSchedule({ frequency, days, time }) {
  if (frequency === 'daily') return `daily:${time}`;
  if (frequency === 'weekly') return `weekly:${DAYS.map(([d]) => d).filter(d => days.includes(d)).join(',')}:${time}`;
  return 'off';
}
export function describeBackupSchedule(value) {
  const s = parseBackupSchedule(value);
  if (s.frequency === 'off') return 'Off';
  if (s.frequency === 'daily') return `Every day at ${s.time}`;
  return `${DAYS.filter(([d]) => s.days.includes(d)).map(([, l]) => l).join(', ')} at ${s.time}`;
}

/** An everyday backup an hour before the automatic updates, or null when updates are off. */
export function suggestedBackupSchedule(updateValue) {
  const u = parseSchedule(updateValue);
  if (u.frequency === 'off') return null;
  const hour = (Number(u.hour) + 23) % 24;
  return { frequency: 'daily', days: ['sun'], time: `${pad(hour)}:00` };
}

/** Plain-English summary of the retention settings. */
export function describeRetention(keep) {
  const parts = [];
  if (keep.last) parts.push(`the ${keep.last} newest`);
  if (keep.daily) parts.push(`one a day for ${keep.daily} day${keep.daily === 1 ? '' : 's'}`);
  if (keep.weekly) parts.push(`one a week for ${keep.weekly} week${keep.weekly === 1 ? '' : 's'}`);
  if (keep.monthly) parts.push(`one a month for ${keep.monthly} month${keep.monthly === 1 ? '' : 's'}`);
  if (keep.yearly) parts.push(`one a year for ${keep.yearly} year${keep.yearly === 1 ? '' : 's'}`);
  if (!parts.length) return 'Keeps every backup.';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Keeps ${list}. Older backups are deleted.`;
}

const fromSettings = (s) => {
  const [last, daily, weekly, monthly, yearly] = String(s.keep || '3,0,0,0,0').split(',').map(Number);
  const keep = { last, daily, weekly, monthly, yearly };
  return {
    schedule: parseBackupSchedule(s.schedule),
    storage: s.storage || 'local',
    path: s.path || '/var/backups/it-manager',
    share: s.share || '',
    user: s.user || '',
    domain: s.domain || '',
    password: '',
    keepAll: Object.values(keep).every(n => !n),
    keep: Object.values(keep).every(n => !n) ? { last: 3, daily: 0, weekly: 0, monthly: 0, yearly: 0 } : keep,
    compress: s.compress || 'zstd',
    encryption: 'keep',
    passphrase: '',
    passphrase2: '',
    includeKeys: s.secrets === 'on',
    verify: s.verify !== 'off',
  };
};

const storageKey = (f) => JSON.stringify([f.storage, f.storage === 'local' ? f.path : f.share, f.user, f.domain, f.password]);

function Message({ value }) {
  if (!value) return null;
  return <p className={`rounded-sm p-2 text-sm ${value.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>{value.error || value.ok}</p>;
}

export function Backups() {
  const qc = useQueryClient();
  // Poll while a task runs, and for a short while after starting one (its status lags a moment).
  const watchUntil = useRef(0);
  const query = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: adminApi.backups,
    refetchInterval: (q) => (q.state.data?.settings?.running || Date.now() < watchUntil.current ? 3000 : false),
  });
  const { data, isLoading } = query;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [restoreName, setRestoreName] = useState(null);

  const settings = data?.settings;
  useEffect(() => { if (settings && !form) setForm(fromSettings(settings)); }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a running task finishes, refresh the logs and the storage figures.
  const running = !!settings?.running;
  useEffect(() => {
    if (!running) {
      qc.invalidateQueries({ queryKey: ['host-log'] });
      qc.invalidateQueries({ queryKey: ['admin', 'host'] });
    }
  }, [running, qc]);

  if (isLoading) return <section className="card p-5 text-sm text-gray-500">Loading backups…</section>;
  if (!data?.available) {
    return (
      <section className="card p-5 text-sm text-gray-400 space-y-2">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><DatabaseBackup size={16} /> Backups</h2>
        <p>This server was not set up with install.sh, so backups are not available here.</p>
      </section>
    );
  }

  const act = async (fn, ok, { watch = false } = {}) => {
    setBusy(true); setMessage(null);
    try {
      await fn();
      setMessage({ ok });
      if (watch) watchUntil.current = Date.now() + 15_000;
      await query.refetch();
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'The server did not accept the request.' });
    } finally { setBusy(false); }
  };

  const list = data.list?.backups ?? [];

  return (
    <div className="space-y-6">
      <StatusCard data={data} busy={busy} running={running}
        refresh={<RefreshButton query={query} disabled={running} before={async () => {
          await adminApi.refreshBackups();
          await qc.invalidateQueries({ queryKey: ['host-log'] });
        }} />}
        onRun={() => act(adminApi.backupNow, 'Backup started. It appears in the list when it finishes.', { watch: true })} />

      {message && <Message value={message} />}

      {form && (
        <SettingsForm form={form} setForm={setForm} settings={settings} updates={data.updates} busy={busy}
          onSave={(body) => act(async () => { await adminApi.saveBackups(body); setForm(null); }, 'Backup settings saved.')} />
      )}

      <section className="card p-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200">Backups ({list.length})</h2>
          {data.list?.free > 0 && <span className="text-xs text-gray-500">{formatBytes(data.list.free)} free on the storage</span>}
        </div>
        {list.length === 0 ? (
          <p className="text-gray-500">No backups yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500 border-b border-surface-600">
                <tr>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 pr-3 font-medium">Size</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Verified</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map(b => (
                  <BackupRow key={b.name} b={b} busy={busy || running}
                    onVerify={() => act(() => adminApi.verifyBackup(b.name), 'Verification started.', { watch: true })}
                    onProtect={() => act(() => adminApi.protectBackup(b.name, !b.protected), b.protected ? 'Protection removed.' : 'Backup protected: it is never deleted automatically.')}
                    onDelete={() => { if (confirm(`Delete the backup from ${new Date(b.created).toLocaleString()}? This cannot be undone.`)) act(() => adminApi.deleteBackup(b.name), 'Backup deleted.'); }}
                    onRestore={() => setRestoreName(b.name)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-2 text-sm">
        <details>
          <summary className="cursor-pointer text-gray-200 font-medium">Last backup log</summary>
          <div className="mt-2"><HostLog name="backup" /></div>
        </details>
        <details>
          <summary className="cursor-pointer text-gray-200 font-medium">Last verification log</summary>
          <div className="mt-2"><HostLog name="verify" /></div>
        </details>
        <details>
          <summary className="cursor-pointer text-gray-200 font-medium">Last restore log</summary>
          <div className="mt-2"><HostLog name="restore" /></div>
        </details>
      </section>

      <RestoreElsewhere />

      <RestoreModal name={restoreName} backup={list.find(b => b.name === restoreName)} onClose={() => setRestoreName(null)} />
    </div>
  );
}

function StatusCard({ data, busy, running, onRun, refresh }) {
  const s = data.settings;
  const last = s.lastAt ? new Date(s.lastAt) : null;
  const where = s.storage === 'local' ? s.path : s.share;
  return (
    <section className="card p-5 space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><DatabaseBackup size={16} /> Backups</h2>
        <div className="flex gap-2">
          {refresh}
          <button type="button" className="btn-primary text-sm flex items-center gap-1.5" disabled={busy || running} onClick={onRun}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {running ? 'Working…' : 'Back up now'}
          </button>
        </div>
      </div>

      <dl className="grid sm:grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-gray-500">Last backup</dt>
          <dd className="text-gray-200 flex items-center gap-1.5">
            {!last ? 'Never' : <>
              {s.lastResult === 'success' ? <CheckCircle2 size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}
              {last.toLocaleString()}{s.lastResult === 'success' ? ` (${formatBytes(s.lastSize)})` : ' (failed)'}
            </>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Schedule</dt>
          <dd className="text-gray-200">{describeBackupSchedule(s.schedule)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Stored on</dt>
          <dd className="text-gray-200 break-all font-mono text-xs mt-0.5">{where}</dd>
        </div>
      </dl>

      {s.schedule === 'off' && (
        <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Scheduled backups are off.</p>
      )}
    </section>
  );
}

function Choice({ checked, onChange, title, children, disabled = false }) {
  return (
    <label className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${checked ? 'border-brand bg-brand/10' : 'border-surface-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="radio" className="mt-1" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="space-y-0.5">
        <span className="block text-gray-200 font-medium">{title}</span>
        <span className="block text-xs text-gray-400">{children}</span>
      </span>
    </label>
  );
}

function SettingsForm({ form, setForm, settings, updates, busy, onSave }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSchedule = (patch) => setForm(f => ({ ...f, schedule: { ...f.schedule, ...patch } }));
  const [test, setTest] = useState({});   // { key, ok, error, busy }

  const scheduleValue = formatBackupSchedule(form.schedule);
  const suggestion = suggestedBackupSchedule(updates);
  const suggestionValue = suggestion && formatBackupSchedule(suggestion);
  const willEncrypt = form.encryption === 'set' || (form.encryption === 'keep' && settings.encrypted);
  const keep = form.keepAll ? { last: 0, daily: 0, weekly: 0, monthly: 0, yearly: 0 } : form.keep;

  // A changed storage location must pass a test before it can be saved.
  const savedKey = storageKey({ ...fromSettings(settings), password: '' });
  const currentKey = storageKey(form);
  const storageChanged = currentKey !== savedKey;
  const tested = test.key === currentKey && test.ok;

  const problems = useMemo(() => {
    const p = [];
    if (form.schedule.frequency === 'weekly' && !form.schedule.days.length) p.push('Choose at least one day.');
    if (!form.keepAll && Object.values(form.keep).every(n => !n)) p.push('Set at least one “Keep” value, or choose “Keep all backups”.');
    if (form.storage === 'smb' && !form.password && !(settings.passwordSet && settings.storage === 'smb' && form.user === settings.user)) p.push('Enter the share password.');
    if (form.encryption === 'set' && form.passphrase.length < 12) p.push('The passphrase must be at least 12 characters.');
    if (form.encryption === 'set' && form.passphrase !== form.passphrase2) p.push('The two passphrases do not match.');
    if (storageChanged && !tested) p.push('Test the storage location before saving.');
    return p;
  }, [form, settings, storageChanged, tested]);

  const body = () => ({
    schedule: scheduleValue, storage: form.storage, path: form.path, share: form.share, user: form.user, domain: form.domain,
    password: form.password || undefined, keep, compress: form.compress, encryption: form.encryption,
    passphrase: form.encryption === 'set' ? form.passphrase : undefined,
    includeKeys: form.includeKeys && willEncrypt, verify: form.verify,
  });

  const runTest = async () => {
    setTest({ key: currentKey, busy: true });
    try {
      await adminApi.testBackupStorage(body());
      setTest({ key: currentKey, ok: true });
    } catch (err) {
      setTest({ key: currentKey, error: err.response?.data?.error ?? 'The storage did not work.' });
    }
  };

  const save = () => {
    if (form.encryption === 'set' && !confirm('Store this passphrase somewhere safe, away from the server.\n\nWithout it, encrypted backups cannot be restored on another server.')) return;
    if (form.encryption === 'off' && settings.encrypted && !confirm('New backups will not be encrypted. Existing encrypted backups stay readable on this server.')) return;
    onSave(body());
  };

  return (
    <section className="card p-5 space-y-6 text-sm">
      {/* Schedule */}
      <div className="space-y-2">
        <h3 className="text-gray-200 font-medium flex items-center gap-2"><Clock size={14} /> Schedule</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={form.schedule.frequency} onChange={e => setSchedule({ frequency: e.target.value })} aria-label="Frequency">
            <option value="off">Off</option>
            <option value="daily">Every day</option>
            <option value="weekly">On selected days</option>
          </select>
          {form.schedule.frequency !== 'off' && (
            <input type="time" className="input w-auto" value={form.schedule.time} aria-label="Time"
              onChange={e => setSchedule({ time: e.target.value || '01:00' })} />
          )}
        </div>
        {form.schedule.frequency === 'weekly' && (
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([d, label]) => {
              const on = form.schedule.days.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on}
                  className={`px-2.5 py-1 rounded-md border text-xs ${on ? 'border-brand bg-brand/20 text-gray-100' : 'border-surface-600 text-gray-400 hover:text-gray-200'}`}
                  onClick={() => setSchedule({ days: on ? form.schedule.days.filter(x => x !== d) : [...form.schedule.days, d] })}>
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {suggestion && (
          <p className="text-xs text-gray-500">
            Suggested: {describeBackupSchedule(suggestionValue).toLowerCase()}, an hour before the automatic updates.
            {suggestionValue !== scheduleValue && (
              <button type="button" className="ml-2 underline text-brand-light" onClick={() => setSchedule(suggestion)}>Use this</button>
            )}
          </p>
        )}
      </div>

      {/* Retention */}
      <div className="space-y-3 border-t border-surface-600 pt-5">
        <h3 className="text-gray-200 font-medium">Retention</h3>
        <label className="flex items-center gap-2 text-gray-300">
          <input type="checkbox" checked={form.keepAll} onChange={e => set('keepAll', e.target.checked)} /> Keep all backups
        </label>
        <div className={`grid grid-cols-2 sm:grid-cols-5 gap-3 ${form.keepAll ? 'opacity-40' : ''}`}>
          {KEEP.map(([k, label]) => (
            <label key={k} className="space-y-1">
              <span className="text-xs text-gray-400">{label}</span>
              <input type="number" min="0" max="999" className="input" disabled={form.keepAll} value={form.keep[k] || ''} placeholder="0"
                onChange={e => set('keep', { ...form.keep, [k]: Math.max(0, Math.min(999, parseInt(e.target.value || '0', 10) || 0)) })} />
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">{describeRetention(keep)}</p>
      </div>

      {/* Storage */}
      <div className="space-y-3 border-t border-surface-600 pt-5">
        <h3 className="text-gray-200 font-medium flex items-center gap-2"><HardDrive size={14} /> Storage</h3>
        <div className="flex flex-wrap gap-4">
          {[['local', 'Folder on this server'], ['smb', 'Windows / NAS share (SMB)'], ['nfs', 'NFS export']].map(([v, label]) => (
            <label key={v} className="flex items-center gap-2 text-gray-300">
              <input type="radio" name="storage" checked={form.storage === v} onChange={() => set('storage', v)} /> {label}
            </label>
          ))}
        </div>
        {form.storage === 'local' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">Folder</span>
              <input className="input font-mono" value={form.path} onChange={e => set('path', e.target.value)} placeholder="/var/backups/it-manager" />
            </label>
            <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2 text-xs"><AlertTriangle size={14} className="shrink-0" />
              Backups stored only on this server will not survive a failed disk. Use a network share.</p>
          </>
        )}
        {form.storage === 'smb' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-gray-400">Share</span>
              <input className="input font-mono" value={form.share} onChange={e => set('share', e.target.value)} placeholder="//nas.office.lan/Backups" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">User name</span>
              <input className="input" value={form.user} onChange={e => set('user', e.target.value)} autoComplete="off" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Domain (optional)</span>
              <input className="input" value={form.domain} onChange={e => set('domain', e.target.value)} placeholder="OFFICE" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-gray-400">Password</span>
              <PasswordInput value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={settings.passwordSet && settings.storage === 'smb' ? 'Saved (leave empty to keep it)' : ''} />
            </label>
          </div>
        )}
        {form.storage === 'nfs' && (
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Export</span>
            <input className="input font-mono" value={form.share} onChange={e => set('share', e.target.value)} placeholder="nas.office.lan:/volume1/backups" />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary text-sm flex items-center gap-1.5" disabled={test.busy || busy} onClick={runTest}>
            {test.busy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} {test.busy ? 'Testing…' : 'Test storage'}
          </button>
          {test.key === currentKey && test.ok && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 size={14} /> Works: the server can write there.</span>}
          {test.key === currentKey && test.error && <span className="text-red-400 text-xs flex items-center gap-1"><XCircle size={14} /> {test.error}</span>}
        </div>
      </div>

      {/* Encryption */}
      <div className="space-y-3 border-t border-surface-600 pt-5">
        <h3 className="text-gray-200 font-medium flex items-center gap-2"><Lock size={14} /> Encryption</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {settings.encrypted ? (
            <>
              <Choice checked={form.encryption === 'keep'} onChange={() => set('encryption', 'keep')} title="Keep encrypting">
                Backups stay encrypted with the current passphrase.
              </Choice>
              <Choice checked={form.encryption === 'set'} onChange={() => set('encryption', 'set')} title="Change the passphrase">
                New backups use the new passphrase. Older backups still open on this server.
              </Choice>
              <Choice checked={form.encryption === 'off'} onChange={() => set('encryption', 'off')} title="Stop encrypting">
                New backups are readable by anyone who can open the files.
              </Choice>
            </>
          ) : (
            <>
              <Choice checked={form.encryption !== 'set'} onChange={() => set('encryption', 'keep')} title="No encryption">
                Anyone who can open the backup files (for example on the share) can read the customer data in them.
              </Choice>
              <Choice checked={form.encryption === 'set'} onChange={() => set('encryption', 'set')} title="Encrypt with a passphrase (recommended)">
                The files can only be opened with your passphrase. Keep it somewhere safe: without it, the backups cannot be restored.
              </Choice>
            </>
          )}
        </div>
        {form.encryption === 'set' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Passphrase (at least 12 characters)</span>
              <PasswordInput value={form.passphrase} onChange={e => set('passphrase', e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Repeat the passphrase</span>
              <PasswordInput value={form.passphrase2} onChange={e => set('passphrase2', e.target.value)} />
            </label>
          </div>
        )}
        <label className={`flex items-start gap-2 ${willEncrypt ? 'text-gray-300' : 'text-gray-600'}`}>
          <input type="checkbox" className="mt-0.5" disabled={!willEncrypt} checked={form.includeKeys && willEncrypt} onChange={e => set('includeKeys', e.target.checked)} />
          <span>
            <KeyRound size={13} className="inline mr-1" />Include the app's encryption keys
            <span className="block text-xs text-gray-400 mt-0.5">
              The app encrypts stored customer passwords with its own keys, which are separate from this passphrase. With this on, a
              backup restores onto a new server with just the passphrase. With it off, you also need the <code className="font-mono">ENCRYPTION_KEY</code>{' '}
              values from the recovery secrets you saved during setup.{!willEncrypt && ' Only available for encrypted backups.'}
            </span>
          </span>
        </label>
      </div>

      {/* Options */}
      <div className="space-y-3 border-t border-surface-600 pt-5">
        <label className="flex items-start gap-2 text-gray-300">
          <input type="checkbox" className="mt-0.5" checked={form.verify} onChange={e => set('verify', e.target.checked)} />
          <span>Verify each new backup</span>
        </label>
        <label className="flex items-center gap-2 text-gray-300">
          Compression
          <select className="input w-auto" value={form.compress} onChange={e => set('compress', e.target.value)}>
            <option value="zstd">Zstandard (recommended)</option>
            <option value="gzip">gzip</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>

      <div className="border-t border-surface-600 pt-5 space-y-2">
        {problems.map(p => <p key={p} className="text-amber-300 text-xs">{p}</p>)}
        <button type="button" className="btn-primary text-sm" disabled={busy || problems.length > 0} onClick={save}>
          {busy ? 'Saving…' : 'Save backup settings'}
        </button>
      </div>
    </section>
  );
}

function BackupRow({ b, busy, onVerify, onProtect, onDelete, onRestore }) {
  const [verifiedAt, verifiedResult] = String(b.verified || '').split(' ');
  const meta = Object.fromEntries(String(b.meta || '').split(' ').filter(Boolean).map(kv => kv.split('=')));
  const reason = { scheduled: 'Scheduled', manual: 'Manual', 'pre-update': 'Before update' }[meta.reason] ?? '';
  return (
    <tr className="border-b border-surface-700 last:border-0">
      <td className="py-2 pr-3 text-gray-200 whitespace-nowrap">
        {b.created ? new Date(b.created).toLocaleString() : b.name}
        {reason && <span className="block text-xs text-gray-500">{reason}{meta.version ? ` · ${meta.version}` : ''}</span>}
      </td>
      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{formatBytes(b.size)}</td>
      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {b.encrypted && <Lock size={13} className="text-green-400" aria-label="Encrypted" />}
          {meta.keys === 'yes' && <KeyRound size={13} className="text-accent" aria-label="Includes encryption keys" />}
          {b.protected && <ShieldCheck size={13} className="text-brand-light" aria-label="Protected" />}
          <span className="text-xs">{[b.encrypted && 'encrypted', meta.keys === 'yes' && 'keys', b.protected && 'protected'].filter(Boolean).join(', ') || 'plain'}</span>
        </span>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap text-xs">
        {!verifiedAt ? <span className="text-gray-500">Not yet</span>
          : verifiedResult === 'ok' ? <span className="text-green-400">OK · {new Date(verifiedAt).toLocaleDateString()}</span>
          : <span className="text-red-400">Failed · {new Date(verifiedAt).toLocaleDateString()}</span>}
      </td>
      <td className="py-2">
        <div className="flex justify-end gap-1">
          <button type="button" className="btn-ghost px-2 text-xs" disabled={busy} onClick={onVerify} title="Verify"><CheckCircle2 size={14} /></button>
          <button type="button" className="btn-ghost px-2 text-xs" disabled={busy} onClick={onProtect} title={b.protected ? 'Remove protection' : 'Protect (never deleted automatically)'}>
            {b.protected ? <ShieldCheck size={14} className="text-brand-light" /> : <Shield size={14} />}
          </button>
          <button type="button" className="btn-ghost px-2 text-xs" disabled={busy} onClick={onRestore} title="Restore"><RotateCcw size={14} /></button>
          <button type="button" className="btn-ghost px-2 text-xs text-red-400" disabled={busy || b.protected} onClick={onDelete} title={b.protected ? 'Protected' : 'Delete'}><Trash2 size={14} /></button>
        </div>
      </td>
    </tr>
  );
}

function RestoreModal({ name, backup, onClose }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [state, setState] = useState({});
  useEffect(() => { setPassword(''); setTyped(''); setState({}); }, [name]);
  if (!name) return null;
  const when = backup?.created ? new Date(backup.created).toLocaleString() : name;

  const start = async () => {
    setState({ busy: true });
    try {
      await adminApi.restoreBackup(name, password);
      setState({ started: true });
    } catch (err) {
      setState({ error: err.response?.data?.error ?? 'The restore was not started.' });
    }
  };

  return (
    <Modal open onClose={onClose} title="Restore a backup" size="md">
      {state.started ? (
        <div className="space-y-3 text-sm text-gray-300">
          <p className="flex items-center gap-2 text-green-400"><Loader2 size={16} className="animate-spin" /> Restore started.</p>
          <p>The Portal and the Field App stop for a few minutes while the data is replaced. Reload this page afterwards and sign in again.</p>
        </div>
      ) : (
        <div className="space-y-4 text-sm text-gray-300">
          <p className="rounded-sm p-2 text-red-300 bg-red-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>This <strong>replaces all current data</strong> with the backup from <strong>{when}</strong>. Everything entered since then is lost.</span></p>
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Type <strong className="text-gray-200">RESTORE</strong> to confirm</span>
            <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Your password</span>
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {state.error && <p className="text-red-400">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary bg-red-700 hover:bg-red-600" disabled={state.busy || typed !== 'RESTORE' || !password} onClick={start}>
              {state.busy ? 'Starting…' : 'Restore'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const Cmd = ({ children }) => (
  <pre className="mt-1 rounded-md bg-surface-900 border border-surface-600 p-2 text-xs text-gray-300 whitespace-pre-wrap break-all font-mono">{children}</pre>
);

function RestoreElsewhere() {
  return (
    <section className="card p-5 space-y-2 text-sm text-gray-400">
      <details>
        <summary className="cursor-pointer text-gray-200 font-medium">Restoring onto a new server (disaster recovery)</summary>
        <ol className="list-decimal pl-5 space-y-3 mt-3">
          <li>Install IT Manager on the new server (<code className="font-mono text-gray-300">sudo ./install.sh</code> and the setup wizard).
            Stop at the Portal's own setup page; there is no need to create the admin.</li>
          <li>Copy the backup file to the new server, for example into <code className="font-mono text-gray-300">/root</code>.</li>
          <li>
            Run the command that matches the backup (the file name ends in <code className="font-mono">.gpg</code> when it is encrypted):
            <p className="mt-2 text-gray-300">Unencrypted backup:</p>
            <Cmd>{`cd /opt/it-manager
sudo ./install.sh backup restore /root/itm-YYYY_MM_DD-HH_MM_SS.tar.zst \\
  --encryption-key <ENCRYPTION_KEY> --field-encryption-key <Field ENCRYPTION_KEY>`}</Cmd>
            <p className="mt-2 text-gray-300">Encrypted backup that includes the encryption keys:</p>
            <Cmd>{`cd /opt/it-manager
echo 'your backup passphrase' | sudo tee /root/passphrase.txt > /dev/null
sudo ./install.sh backup restore /root/itm-YYYY_MM_DD-HH_MM_SS.tar.zst.gpg --passphrase-file /root/passphrase.txt
sudo rm /root/passphrase.txt`}</Cmd>
            <p className="mt-2 text-gray-300">Encrypted backup without the encryption keys:</p>
            <Cmd>{`sudo ./install.sh backup restore /root/itm-YYYY_MM_DD-HH_MM_SS.tar.zst.gpg --passphrase-file /root/passphrase.txt \\
  --encryption-key <ENCRYPTION_KEY> --field-encryption-key <Field ENCRYPTION_KEY>`}</Cmd>
            <p className="mt-2 text-xs">The two keys are in the recovery secrets you saved during setup. Type <strong>RESTORE</strong> when asked.</p>
          </li>
          <li>Sign in with an account from the backup, then set up backups again here.</li>
        </ol>
      </details>
    </section>
  );
}
