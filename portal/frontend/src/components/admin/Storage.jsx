import { useQuery } from '@tanstack/react-query';
import { HardDrive, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { adminApi } from '../../api/admin.js';
import { RefreshButton } from './RefreshButton.jsx';

// Admin → System → Storage: disk capacity, what the application stores, growth rate
// and the forecast date the disk fills up.

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${bytes < 0 ? '-' : ''}${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(days) {
  if (days >= 730) return `about ${Math.round(days / 365)} years`;
  if (days >= 60) return `about ${Math.round(days / 30)} months`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

const STATUS = {
  ok:       { label: 'Healthy',  pill: 'bg-green-900/30 text-green-400', bar: 'bg-brand' },
  warning:  { label: 'Warning',  pill: 'bg-amber-900/30 text-amber-400', bar: 'bg-amber-500' },
  critical: { label: 'Critical', pill: 'bg-red-900/30 text-red-400',     bar: 'bg-red-500' },
};

export const storageQuery = { queryKey: ['admin', 'storage'], queryFn: adminApi.storage, staleTime: 5 * 60 * 1000 };

export function Storage() {
  const query = useQuery(storageQuery);
  const backupsQuery = useQuery({ queryKey: ['admin', 'backups'], queryFn: adminApi.backups });
  const { data, isLoading, isError } = query;

  if (isLoading) return <section className="card p-5 text-sm text-gray-500">Measuring storage…</section>;
  if (isError || !data) return <section className="card p-5 text-sm text-red-400">Storage could not be measured.</section>;

  const { disk, portal, field, forecast: f } = data;
  const backups = backupsQuery.data?.available ? backupsQuery.data : null;
  const backupBytes = backups?.list?.backups?.reduce((sum, b) => sum + b.size, 0) ?? null;
  const backupsHere = backups?.settings?.storage === 'local';
  const status = STATUS[f.status] ?? STATUS.ok;
  const appTotal = portal.database + portal.files + (field ? field.database + field.files : 0);
  const rows = [
    ['Portal database', portal.database],
    ['Portal files', portal.files],
    ['Field App database', field?.database],
    ['Field App photos', field?.files],
    ...(backups ? [['Backups', backupBytes, backupsHere ? 'On this server' : backups.settings.storage === 'smb' ? 'On the network share' : 'On the NFS export']] : []),
    ['Everything else on the disk', Math.max(disk.used - appTotal - (backupsHere ? backupBytes ?? 0 : 0), 0), 'Operating system, Docker images and logs.'],
  ];

  let outlook;
  if (f.daysUntilFull != null) {
    outlook = <>At the current rate the disk is full in <strong className="text-gray-100">{formatDuration(f.daysUntilFull)}</strong> (around {new Date(`${f.fullBy}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}).</>;
  } else if (f.growthPerDay != null) {
    outlook = <>Disk usage is not growing.</>;
  }

  return (
    <section className="card p-5 space-y-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><HardDrive size={16} /> Storage</h2>
        <div className="flex items-center gap-2">
          <span className={`text-xs rounded-full px-2 py-0.5 ${status.pill}`}>{status.label}</span>
          <RefreshButton query={query} queries={[backupsQuery]} />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-gray-400 mb-1.5">
          <span><strong className="text-gray-100">{formatBytes(disk.used)}</strong> of {formatBytes(disk.total)} used ({f.usedPercent}%)</span>
          <span>{formatBytes(disk.free)} free</span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-700 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.usedPercent} aria-label="Disk used">
          <div className={`h-full ${status.bar}`} style={{ width: `${Math.min(f.usedPercent, 100)}%` }} />
        </div>
      </div>

      {(outlook || f.growthPerDay > 0) && (
        <p className="text-gray-400">
          {f.growthPerDay != null && f.growthPerDay > 0 && <>Growing about <strong className="text-gray-100">{formatBytes(f.growthPerDay)}</strong> per day over the last 30 days. </>}
          {outlook}
        </p>
      )}

      {f.status !== 'ok' && (
        <p className="flex items-start gap-2 rounded-sm p-2 bg-amber-900/20 text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Free up space or enlarge the disk. Postgres stops accepting writes when the disk is full.</span>
        </p>
      )}

      <table className="w-full">
        <tbody>
          {rows.map(([label, bytes, hint]) => (
            <tr key={label} className="border-t border-surface-700">
              <td className="py-1.5 text-gray-400">{label}{hint && <span className="block text-xs text-gray-500">{hint}</span>}</td>
              <td className="py-1.5 text-right text-gray-200 font-mono">{bytes == null ? 'Unavailable' : formatBytes(bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Admin-only banner shown across the app while storage is in warning or critical. */
export function StorageAlert({ enabled }) {
  const { data } = useQuery({ ...storageQuery, enabled, staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false });
  const f = data?.forecast;
  if (!enabled || !f || f.status === 'ok') return null;
  const critical = f.status === 'critical';
  const detail = f.daysUntilFull != null ? `, full in about ${formatDuration(f.daysUntilFull)}` : '';
  return (
    <Link to="/admin?tab=system"
      className={`flex items-center gap-2 px-4 py-2 text-sm ${critical ? 'bg-red-900/40 text-red-200' : 'bg-amber-900/30 text-amber-200'}`}>
      <AlertTriangle size={14} className="shrink-0" />
      Server storage is {f.usedPercent}% used{detail}. Open Admin → System for details.
    </Link>
  );
}
