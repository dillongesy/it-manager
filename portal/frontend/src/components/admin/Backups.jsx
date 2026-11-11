import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup, RefreshCw, Play, ShieldCheck, Shield, Trash2, RotateCcw, CheckCircle2, XCircle,
  Lock, KeyRound, AlertTriangle, Loader2, HardDrive, Clock,
} from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { formatBytes } from './Storage.jsx';
import { describeSchedule, parseSchedule } from './HostSettings.jsx';
import { HostLog } from './HostLog.jsx';
import { Modal } from '../ui/Modal.jsx';
import { PasswordInput } from '../ui/PasswordInput.jsx';

// Admin → Backups: schedule, retention, storage, encryption and the list of backups,
// applied by the host helper (scripts/backup.sh). Restores need the admin's password.

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const KEEP = [
  ['last', 'Last', 'The newest backups, whatever their age.'],
  ['daily', 'Daily', 'One per day, for this many days.'],
  ['weekly', 'Weekly', 'One per week, for this many weeks.'],
  ['monthly', 'Monthly', 'One per month, for this many months.'],
  ['yearly', 'Yearly', 'One per year, for this many years.'],
];
const backupsQuery = { queryKey: ['admin', 'backups'], queryFn: adminApi.backups };

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

/**
 * Whether every scheduled update has a scheduled backup earlier the same day.
 * Returns null when there is nothing to compare.
 */
export function backupPrecedesUpdates(backupValue, updateValue) {
  const b = parseBackupSchedule(backupValue);
  const u = parseSchedule(updateValue);
  if (b.frequency === 'off' || u.frequency === 'off') return null;
  const updateDays = u.frequency === 'daily' ? DAYS.map(([d]) => d) : [u.day];
  const backupDays = b.frequency === 'daily' ? DAYS.map(([d]) => d) : b.days;
  const before = b.time < `${u.hour}:00`;
  return updateDays.every(d => backupDays.includes(d)) && before;
}

const fromSettings = (s) => {
  const [last, daily, weekly, monthly, yearly] = String(s.keep || '0,0,0,0,0').split(',').map(Number);
  return {
    schedule: parseBackupSchedule(s.schedule),
    storage: s.storage || 'local',
    path: s.path || '/var/backups/it-manager',
    share: s.share || '',
    user: s.user || '',
    domain: s.domain || '',
    password: '',
    keep: { last, daily, weekly, monthly, yearly },
    compress: s.compress || 'zstd',
    encryption: 'keep',
    passphrase: '',
    passphrase2: '',
    includeKeys: s.secrets === 'on',
    beforeUpdate: s.beforeUpdate !== 'off',
    verify: s.verify !== 'off',
  };
};

function Message({ value }) {
  if (!value) return null;
  return <p className={`rounded-sm p-2 text-sm ${value.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>{value.error || value.ok}</p>;
}

export function Backups() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    ...backupsQuery,
    refetchInterval: (q) => (q.state.data?.settings?.running ? 5000 : false),
  });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [restoreName, setRestoreName] = useState(null);

  const settings = data?.settings;
  useEffect(() => { if (settings && !form) setForm(fromSettings(settings)); }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a running task finishes, refresh the logs too.
  const running = !!settings?.running;
  useEffect(() => {
    if (!running) ['backup', 'verify', 'restore'].forEach(n => qc.invalidateQueries({ queryKey: ['host-log', n] }));
  }, [running, qc]);

  if (isLoading) return <section className="card p-5 text-sm text-gray-500">Loading backups…</section>;
  if (!data?.available) {
    return (
      <section className="card p-5 text-sm text-gray-400 space-y-2">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><DatabaseBackup size={16} /> Backups</h2>
        <p>Backups are managed by the host helper that install.sh sets up. This server was not set up with install.sh, or the
          helper has not reported yet. On the server: <code className="font-mono text-gray-300">sudo ./install.sh</code>.</p>
      </section>
    );
  }

  const act = async (fn, ok) => {
    setBusy(true); setMessage(null);
    try {
      await fn();
      setMessage({ ok });
      await qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
      qc.invalidateQueries({ queryKey: ['admin', 'host'] });
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'The server did not accept the request.' });
    } finally { setBusy(false); }
  };

  const list = data.list?.backups ?? [];
  const last = settings.lastAt ? new Date(settings.lastAt) : null;

  return (
    <div className="space-y-6">
      <StatusCard data={data} busy={busy} running={running}
        onRun={() => act(adminApi.backupNow, 'Backup started. It appears in the list when it finishes.')}
        onRefresh={() => act(adminApi.refreshBackups, 'Backup list refreshed.')} last={last} />

      {message && <Message value={message} />}

      {form && (
        <SettingsForm form={form} setForm={setForm} settings={settings} updates={data.updates} busy={busy}
          onSave={(body) => act(async () => { await adminApi.saveBackups(body); setForm(null); },
            'Backup settings saved. The storage was tested and works.')} />
      )}

      <section className="card p-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200">Backups on the storage ({list.length})</h2>
          {data.list?.free > 0 && (
            <span className="text-xs text-gray-500">{formatBytes(data.list.free)} free of {formatBytes(data.list.total)}</span>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-gray-500">No backups yet. Use “Back up now”, or wait for the schedule.</p>
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
                    onVerify={() => act(() => adminApi.verifyBackup(b.name), 'Verification started.')}
                    onProtect={() => act(() => adminApi.protectBackup(b.name, !b.protected), b.protected ? 'Protection removed.' : 'Backup protected: it is never pruned or deleted.')}
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

function StatusCard({ data, busy, running, onRun, onRefresh, last }) {
  const s = data.settings;
  const local = s.storage === 'local';
  const where = local ? s.path : s.share;
  return (
    <section className="card p-5 space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><DatabaseBackup size={16} /> Backups</h2>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-xs flex items-center gap-1" disabled={busy || running} onClick={onRefresh}>
            <RefreshCw size={12} /> Refresh
          </button>
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
          <dd className="text-gray-200">{describeBackupSchedule(s.schedule)}{s.next ? <span className="text-gray-500"> (next: {s.next})</span> : ''}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Stored on</dt>
          <dd className="text-gray-200 break-all flex items-center gap-1.5"><HardDrive size={13} className="shrink-0 text-gray-500" />
            {local ? 'This server: ' : s.storage === 'smb' ? 'Share: ' : 'NFS: '}<span className="font-mono text-xs">{where}</span></dd>
        </div>
      </dl>

      {running && <p className="text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> A backup task is running. This page updates when it finishes.</p>}

      {s.schedule === 'off' && (
        <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Scheduled backups are off. Without backups, a failed disk or a mistake loses every record and file.</p>
      )}
      {local && (
        <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Backups are kept on this server{s.path?.startsWith('/var/') ? '’s own disk' : ''}. They protect against mistakes and failed updates,
            but not against losing the disk or the server. Store them on a network share (below), or on a second disk mounted on the server.</span></p>
      )}
      {!s.encrypted && !local && (
        <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2"><Lock size={16} className="shrink-0 mt-0.5" />
          Backups are not encrypted. Anyone who can read the share can read the customer data in them. Set an encryption passphrase below.</p>
      )}
    </section>
  );
}

function SettingsForm({ form, setForm, settings, updates, busy, onSave }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSchedule = (patch) => setForm(f => ({ ...f, schedule: { ...f.schedule, ...patch } }));
  const scheduleValue = formatBackupSchedule(form.schedule);
  const precedes = backupPrecedesUpdates(scheduleValue, updates);
  const willEncrypt = form.encryption === 'set' || (form.encryption === 'keep' && settings.encrypted);
  const keepAll = Object.values(form.keep).every(n => !Number(n));

  const problems = useMemo(() => {
    const p = [];
    if (form.schedule.frequency === 'weekly' && !form.schedule.days.length) p.push('Choose at least one day.');
    if (form.storage === 'local' && !form.path.startsWith('/')) p.push('The folder must be a full path, such as /var/backups/it-manager.');
    if (form.storage === 'smb' && !form.share.startsWith('//')) p.push('Enter the share as //server/share.');
    if (form.storage === 'smb' && !form.password && !(settings.passwordSet && settings.storage === 'smb' && form.user === settings.user)) p.push('Enter the share password.');
    if (form.storage === 'nfs' && !/^[^/]+:\//.test(form.share)) p.push('Enter the export as server:/path.');
    if (form.encryption === 'set' && form.passphrase.length < 12) p.push('The passphrase must be at least 12 characters.');
    if (form.encryption === 'set' && form.passphrase !== form.passphrase2) p.push('The two passphrases do not match.');
    if (form.includeKeys && !willEncrypt) p.push('The encryption keys can only be included in encrypted backups.');
    return p;
  }, [form, settings, willEncrypt]);

  const save = () => {
    if (form.encryption === 'set' && !confirm('Store this passphrase somewhere safe, away from the server (with the recovery secrets).\n\nWithout it, encrypted backups cannot be restored on another server.')) return;
    if (form.encryption === 'off' && settings.encrypted && !confirm('New backups will not be encrypted. Existing encrypted backups stay readable on this server.')) return;
    onSave({
      schedule: scheduleValue, storage: form.storage, path: form.path, share: form.share, user: form.user, domain: form.domain,
      password: form.password || undefined, keep: form.keep, compress: form.compress, encryption: form.encryption,
      passphrase: form.encryption === 'set' ? form.passphrase : undefined,
      includeKeys: form.includeKeys && willEncrypt, beforeUpdate: form.beforeUpdate, verify: form.verify,
    });
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
          <span className="text-xs text-gray-500">server time</span>
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
        <p className="text-gray-400">
          <strong className="text-gray-200">We recommend scheduling backups before the automatic update time</strong>, so every update starts
          from a fresh backup. Updates run: {describeSchedule(updates)}.
        </p>
        {precedes === false && (
          <p className="rounded-sm p-2 text-amber-300 bg-amber-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
            This schedule does not back up before every update. Choose an earlier time, or days that include the update day.</p>
        )}
        <label className="flex items-start gap-2 text-gray-300">
          <input type="checkbox" className="mt-0.5" checked={form.beforeUpdate} onChange={e => set('beforeUpdate', e.target.checked)} />
          <span>Back up before each update (recommended). If that backup fails, the update is skipped and shown as an alert.</span>
        </label>
      </div>

      {/* Retention */}
      <div className="space-y-2 border-t border-surface-600 pt-5">
        <h3 className="text-gray-200 font-medium">Retention</h3>
        <p className="text-gray-500 text-xs">
          Older backups are removed after each backup. Each rule keeps the newest backup of that many days, weeks, months or years not
          already kept by an earlier rule. Protected backups are always kept. {keepAll && <strong className="text-amber-300">All zero keeps every backup.</strong>}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {KEEP.map(([k, label, hint]) => (
            <label key={k} className="space-y-1" title={hint}>
              <span className="text-xs text-gray-400">Keep {label.toLowerCase()}</span>
              <input type="number" min="0" max="999" className="input" value={form.keep[k]}
                onChange={e => set('keep', { ...form.keep, [k]: Math.max(0, Math.min(999, parseInt(e.target.value || '0', 10))) })} />
            </label>
          ))}
        </div>
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
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Folder</span>
            <input className="input font-mono" value={form.path} onChange={e => set('path', e.target.value)} placeholder="/var/backups/it-manager" />
            <span className="text-xs text-gray-500 block">A second disk mounted on the server (for example <code className="font-mono">/mnt/backup</code>) survives the main disk failing.</span>
          </label>
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
              <span className="text-xs text-gray-500 block">Stored on the server, readable by root only. Use an account that can write only to this share.</span>
            </label>
          </div>
        )}
        {form.storage === 'nfs' && (
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Export</span>
            <input className="input font-mono" value={form.share} onChange={e => set('share', e.target.value)} placeholder="nas.office.lan:/volume1/backups" />
            <span className="text-xs text-gray-500 block">The export must allow this server's address with read-write access.</span>
          </label>
        )}
        <p className="text-xs text-gray-500">Backups go into an <code className="font-mono">it-manager/&lt;server name&gt;</code> folder. The storage is tested when you save.</p>
      </div>

      {/* Options */}
      <div className="space-y-3 border-t border-surface-600 pt-5">
        <h3 className="text-gray-200 font-medium flex items-center gap-2"><Lock size={14} /> Encryption and options</h3>
        <p className="text-gray-400">
          Encryption: <strong className="text-gray-200">{settings.encrypted ? 'on (AES-256)' : 'off'}</strong>.
          {' '}Encrypted backups can be read only with the passphrase. It is kept on this server for scheduled backups;
          keep a copy elsewhere, or the backups cannot be restored on a new server.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-gray-300">
            <input type="radio" name="enc" checked={form.encryption === 'keep'} onChange={() => set('encryption', 'keep')} />
            {settings.encrypted ? 'Keep the current passphrase' : 'Leave unencrypted'}
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="radio" name="enc" checked={form.encryption === 'set'} onChange={() => set('encryption', 'set')} />
            {settings.encrypted ? 'Change the passphrase' : 'Encrypt with a passphrase'}
          </label>
          {settings.encrypted && (
            <label className="flex items-center gap-2 text-gray-300">
              <input type="radio" name="enc" checked={form.encryption === 'off'} onChange={() => set('encryption', 'off')} /> Stop encrypting
            </label>
          )}
        </div>
        {form.encryption === 'set' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Passphrase (at least 12 characters)</span>
              <PasswordInput value={form.passphrase} onChange={e => set('passphrase', e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Repeat</span>
              <PasswordInput value={form.passphrase2} onChange={e => set('passphrase2', e.target.value)} />
            </label>
            {settings.encrypted && <p className="sm:col-span-2 text-xs text-gray-500">Backups made with the old passphrase stay readable on this server.</p>}
          </div>
        )}
        <label className={`flex items-start gap-2 ${willEncrypt ? 'text-gray-300' : 'text-gray-600'}`}>
          <input type="checkbox" className="mt-0.5" disabled={!willEncrypt} checked={form.includeKeys && willEncrypt} onChange={e => set('includeKeys', e.target.checked)} />
          <span><KeyRound size={13} className="inline mr-1" />Include the encryption keys (encrypted backups only). A backup then restores onto a new server
            with just the passphrase. Without them you also need <code className="font-mono">ENCRYPTION_KEY</code> from the recovery secrets, or
            stored customer passwords cannot be read.</span>
        </label>
        <label className="flex items-start gap-2 text-gray-300">
          <input type="checkbox" className="mt-0.5" checked={form.verify} onChange={e => set('verify', e.target.checked)} />
          <span>Verify each new backup (re-reads it and checks every file's checksum and both database dumps).</span>
        </label>
        <label className="flex items-center gap-2 text-gray-300">
          Compression
          <select className="input w-auto" value={form.compress} onChange={e => set('compress', e.target.value)}>
            <option value="zstd">Zstandard (fast, recommended)</option>
            <option value="gzip">gzip</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>

      <div className="border-t border-surface-600 pt-5 space-y-2">
        {problems.map(p => <p key={p} className="text-amber-300 text-xs">{p}</p>)}
        <button type="button" className="btn-primary text-sm" disabled={busy || problems.length > 0} onClick={save}>
          {busy ? 'Saving and testing…' : 'Save backup settings'}
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
          <button type="button" className="btn-ghost px-2 text-xs" disabled={busy} onClick={onProtect} title={b.protected ? 'Remove protection' : 'Protect (never pruned or deleted)'}>
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
          <p>The Portal and the Field App stop while the data is replaced, usually for a few minutes, then start again. This page loses
            its connection in the meantime. Reload it afterwards and sign in again; the restore log is in Admin → Backups.</p>
        </div>
      ) : (
        <div className="space-y-4 text-sm text-gray-300">
          <p className="rounded-sm p-2 text-red-300 bg-red-900/20 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>This <strong>replaces all current data</strong> (both databases, all uploaded files and the Nginx Proxy Manager settings) with
              the backup from <strong>{when}</strong>. Everything entered since then is lost. Consider “Back up now” first.</span></p>
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

function RestoreElsewhere() {
  return (
    <section className="card p-5 space-y-2 text-sm text-gray-400">
      <details>
        <summary className="cursor-pointer text-gray-200 font-medium">Restoring onto a new server (disaster recovery)</summary>
        <ol className="list-decimal pl-5 space-y-1.5 mt-3">
          <li>Install IT Manager on the new server (<code className="font-mono text-gray-300">sudo ./install.sh</code> and the setup wizard).
            Stop at the Portal's own setup page; there is no need to create the admin.</li>
          <li>Copy the backup file to the new server, for example into <code className="font-mono text-gray-300">/root</code>, or mount the share.</li>
          <li>Run:
            <pre className="mt-1 rounded-md bg-surface-900 border border-surface-600 p-2 text-xs text-gray-300 whitespace-pre-wrap break-all font-mono">{`cd /opt/it-manager
sudo ./install.sh backup restore /root/itm-YYYY_MM_DD-HH_MM_SS.tar.zst.gpg --passphrase-file /root/passphrase.txt`}</pre>
            For an encrypted backup, put the passphrase alone in that file. If the backup does not include the encryption keys, also add{' '}
            <code className="font-mono text-gray-300">--encryption-key</code> and <code className="font-mono text-gray-300">--field-encryption-key</code>{' '}
            with the values from the recovery secrets.</li>
          <li>Sign in with an account from the backup. Then set up backups again here.</li>
        </ol>
      </details>
    </section>
  );
}
