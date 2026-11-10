import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Shield, ShieldOff, CalendarClock } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { HostLog } from './HostLog.jsx';

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

export function HostSettings() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['admin', 'host'], queryFn: adminApi.host });
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
          This server was not set up with install.sh, so updates and the host firewall are managed on the server.
          Update with <code className="font-mono text-gray-300">docker compose pull &amp;&amp; docker compose up -d</code>.
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
  const lastAt = data.lastUpdateAt ? new Date(data.lastUpdateAt).toLocaleString() : null;

  return (
    <section className="card p-5 space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><CalendarClock size={16} /> Updates and firewall</h2>
        <button onClick={() => refetch()} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-gray-200 font-medium">Automatic updates</p>
        <p className="text-gray-400">
          {describeSchedule(data.updates)}.
          {data.nextUpdate && <> Next: {data.nextUpdate}.</>}
          {lastAt && <> Last: {lastAt} ({data.lastUpdateResult === 'success' ? 'succeeded' : data.lastUpdateResult || 'unknown'}).</>}
        </p>
        <p className="text-gray-500 text-xs">
          Pulls new images for every service, including Nginx Proxy Manager, and restarts what changed. The Portal is
          briefly unavailable while it restarts.
        </p>
        {schedule && <ScheduleFields value={schedule} onChange={setSchedule} />}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-sm" disabled={busy || preset === data.updates}
            onClick={() => run(() => adminApi.saveUpdates(preset), 'Update schedule saved.')}>
            Save schedule
          </button>
          <button type="button" className="btn-secondary text-sm" disabled={busy}
            onClick={() => { if (confirm('Update now? The Portal restarts if a new version is available.')) run(adminApi.updateNow, 'Update started. The page may disconnect briefly.'); }}>
            Update now
          </button>
        </div>
      </div>

      <div className="space-y-1 border-t border-surface-600 pt-4">
        <p className="text-gray-200 font-medium flex items-center gap-2">
          {data.firewall === 'on' ? <Shield size={14} className="text-green-400" /> : <ShieldOff size={14} className="text-amber-400" />}
          Host firewall: {data.firewall === 'on' ? 'hardened' : data.firewall === 'off' ? 'off' : 'unknown'}
        </p>
        <p className="text-gray-500 text-xs">
          {data.firewall === 'on' && data.ports && <>Open to everyone: port {data.ports.proxyHttps} (Field App{data.acme === 'http' ? '; and 80 for certificates' : ''}).
            Office network only: {data.ports.portal} (Portal) and {data.ports.proxyAdmin} (proxy admin). </>}
          Chosen during setup. To change it, run <code className="font-mono text-gray-300">sudo ./install.sh firewall on</code> or{' '}
          <code className="font-mono text-gray-300">off</code> on the server.
        </p>
      </div>

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
