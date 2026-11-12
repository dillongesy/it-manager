import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldOff, CalendarClock } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { HostLog } from './HostLog.jsx';
import { RefreshButton } from './RefreshButton.jsx';

// Admin → System: automatic updates (editable) and the host firewall (status only; it
// is chosen in the setup wizard or on the server with install.sh). Both come from the
// host helper that install.sh installs.

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/** 'weekly:sun:02' ↔ { frequency, day, hour } */
export function parseSchedule(preset) {
  const [frequency, a, b] = String(preset || 'off').split(':');
  if (frequency === 'daily') return { frequency, day: 'sun', hour: a ?? '02' };
  if (frequency === 'weekly') return { frequency, day: a ?? 'sun', hour: b ?? '02' };
  return { frequency: 'off', day: 'sun', hour: '02' };
}
export function formatSchedule({ frequency, day, hour }) {
  if (frequency === 'daily') return `daily:${hour}`;
  if (frequency === 'weekly') return `weekly:${day}:${hour}`;
  return 'off';
}
export function describeSchedule(preset) {
  const s = parseSchedule(preset);
  if (s.frequency === 'off') return 'Off';
  const at = `${s.hour}:00`;
  return s.frequency === 'daily' ? `Every day at ${at}` : `Every ${DAYS.find(([d]) => d === s.day)?.[1]} at ${at}`;
}

/** Frequency / day / hour pickers for an update schedule. */
export function ScheduleFields({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="flex flex-wrap gap-2">
      <select className="input w-auto" value={value.frequency} onChange={set('frequency')} aria-label="Frequency">
        <option value="off">Off</option>
        <option value="daily">Every day</option>
        <option value="weekly">Every week</option>
      </select>
      {value.frequency === 'weekly' && (
        <select className="input w-auto" value={value.day} onChange={set('day')} aria-label="Day">
          {DAYS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
        </select>
      )}
      {value.frequency !== 'off' && (
        <select className="input w-auto" value={value.hour} onChange={set('hour')} aria-label="Time">
          {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
      )}
    </div>
  );
}

const major = (v) => parseInt(String(v || '').split('.')[0], 10);

/** Nginx Proxy Manager: installed version, newest release, and how to move to a new major version. */
function ProxyVersion({ proxy, ip, adminPort }) {
  const newMajor = proxy.latest && major(proxy.latest) > Number(proxy.tag);
  return (
    <div className="space-y-2 border-t border-surface-600 pt-4">
      <p className="text-gray-200 font-medium">Nginx Proxy Manager</p>
      <dl className="grid grid-cols-3 gap-3 text-xs">
        <div><dt className="text-gray-500">Installed</dt><dd className="text-gray-200">{proxy.version || 'not running'}</dd></div>
        <div><dt className="text-gray-500">Latest release</dt><dd className="text-gray-200">{proxy.latest || 'unknown'}</dd></div>
        <div><dt className="text-gray-500">Follows</dt><dd className="text-gray-200">{proxy.tag ? `${proxy.tag}.x releases` : 'unknown'}</dd></div>
      </dl>
      {newMajor && (
        <div className="rounded-sm p-2 text-xs text-gray-300 bg-surface-700 space-y-1">
          <p><strong className="text-gray-100">Version {major(proxy.latest)} is available.</strong> It is not installed automatically. To install it:</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>Read its release notes: <a className="underline" href="https://github.com/NginxProxyManager/nginx-proxy-manager/releases" target="_blank" rel="noreferrer">github.com/NginxProxyManager/nginx-proxy-manager/releases</a>.</li>
            <li>Make a backup (Admin → Backups → Back up now).</li>
            <li>On the server: <code className="font-mono text-gray-200">cd /opt/it-manager && sudo ./install.sh proxy-version {major(proxy.latest)}</code></li>
            <li>Check that the Field App still opens from the internet. To go back: <code className="font-mono text-gray-200">sudo ./install.sh proxy-version {proxy.tag}</code></li>
          </ol>
        </div>
      )}
      <p className="text-xs text-amber-300">
        Nginx Proxy Manager{ip ? <> (<span className="font-mono">http://{ip}:{adminPort ?? 81}</span>)</> : ''} uses plain HTTP: the password crosses the office network unencrypted.
      </p>
    </div>
  );
}

export function HostSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'host'], queryFn: adminApi.host });
  const { data, isLoading } = query;
  const [schedule, setSchedule] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data?.available) setSchedule(parseSchedule(data.updates)); }, [data]);

  if (isLoading || !data) return null;

  if (!data.available) {
    return (
      <section className="card p-5 space-y-2 text-sm">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><CalendarClock size={16} /> Updates and firewall</h2>
        <p className="text-gray-400">
          This server was not set up with install.sh. Update with <code className="font-mono text-gray-300">docker compose pull &amp;&amp; docker compose up -d</code>.
        </p>
      </section>
    );
  }

  const run = async (fn, okText) => {
    setBusy(true); setMessage(null);
    try {
      const result = await fn();
      if (result.status) qc.setQueryData(['admin', 'host'], { available: true, ...result.status });
      setMessage({ ok: okText });
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'The change was not applied.' });
    } finally { setBusy(false); }
  };

  const preset = schedule ? formatSchedule(schedule) : data.updates;

  return (
    <section className="card p-5 space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><CalendarClock size={16} /> Updates and firewall</h2>
        <RefreshButton query={query} before={() => qc.invalidateQueries({ queryKey: ['host-log'] })} />
      </div>

      <div className="space-y-2">
        <p className="text-gray-200 font-medium">Automatic updates</p>
        {schedule && <ScheduleFields value={schedule} onChange={setSchedule} />}
        <p className="text-gray-500 text-xs">Every update makes a backup first, and stops if that backup fails.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-sm" disabled={busy || preset === data.updates}
            onClick={() => run(() => adminApi.saveUpdates(preset), 'Update schedule saved.')}>
            Save schedule
          </button>
          <button type="button" className="btn-secondary text-sm" disabled={busy}
            onClick={() => { if (confirm('Update now? A backup is made first, then the Portal restarts if a new version is available.')) run(adminApi.updateNow, 'Update started. The page may disconnect briefly.'); }}>
            Update now
          </button>
        </div>
      </div>

      <div className="border-t border-surface-600 pt-4">
        <p className="text-gray-200 font-medium flex items-center gap-2">
          {data.firewall === 'on' ? <Shield size={14} className="text-green-400" /> : <ShieldOff size={14} className="text-amber-400" />}
          Host firewall: {data.firewall === 'on' ? 'hardened' : data.firewall === 'off' ? 'off' : 'unknown'}
        </p>
      </div>

      {data.proxyMode === 'external' ? (
        <div className="space-y-1 border-t border-surface-600 pt-4">
          <p className="text-gray-200 font-medium">Reverse proxy</p>
          <p className="text-gray-400 text-xs">
            Yours, at <span className="font-mono">{data.externalProxy}</span>. It forwards the Field App's domain to{' '}
            <span className="font-mono">http://{data.host?.ip}:{data.ports?.fieldProxy ?? 4480}</span>.
          </p>
        </div>
      ) : data.proxy && <ProxyVersion proxy={data.proxy} ip={data.host?.ip} adminPort={data.ports?.proxyAdmin} />}

      <div className="space-y-2 border-t border-surface-600 pt-4">
        <details>
          <summary className="cursor-pointer text-gray-200 font-medium">Last update log</summary>
          <div className="mt-2"><HostLog name="update" /></div>
        </details>
        <details>
          <summary className="cursor-pointer text-gray-200 font-medium">Installation log</summary>
          <div className="mt-2"><HostLog name="install" /></div>
        </details>
      </div>

      {message && (
        <p className={`rounded-sm p-2 ${message.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>{message.error || message.ok}</p>
      )}
    </section>
  );
}
