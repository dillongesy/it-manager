import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { parseBackupSchedule } from './Backups.jsx';

// Dashboard alerts for admins, from the host helper's status: backups (failed, overdue,
// off, kept only on this server), updates (failed or skipped), and a new major version
// of Nginx Proxy Manager. Each can be hidden for a week; a failure that changes (a newer
// failed attempt) shows again.

const HIDE_DAYS = 7;
const hiddenKey = 'app-hidden-server-alerts';

function readHidden() {
  try { return JSON.parse(localStorage.getItem(hiddenKey)) || {}; } catch { return {}; }
}

const DAY = 24 * 60 * 60 * 1000;
const major = (v) => parseInt(String(v || '').split('.')[0], 10);

/** The alerts that apply to a host status (exported for tests and reuse). */
export function serverAlerts(status, now = Date.now()) {
  if (!status?.available) return [];
  const alerts = [];
  const b = status.backup;
  if (b) {
    const schedule = parseBackupSchedule(b.schedule);
    const lastAt = b.lastAt ? Date.parse(b.lastAt) : null;
    if (b.lastResult === 'failed') {
      alerts.push({ id: `backup-failed:${b.lastAt}`, level: 'error', to: '/admin?tab=backups',
        text: `The last backup failed (${new Date(lastAt).toLocaleString()}). Your data is not protected until a backup succeeds.` });
    } else if (schedule.frequency === 'off') {
      alerts.push({ id: 'backup-off', level: 'warning', to: '/admin?tab=backups',
        text: 'Automatic backups are off. A failed disk or a mistake would lose every record and file.' });
    } else if (!lastAt) {
      alerts.push({ id: 'backup-never', level: 'warning', to: '/admin?tab=backups',
        text: 'No backup has been made yet. Choose where to store backups, then use “Back up now”.' });
    } else {
      const limit = (schedule.frequency === 'daily' ? 2 : 8) * DAY;
      if (now - lastAt > limit) {
        alerts.push({ id: `backup-overdue:${b.lastAt}`, level: 'warning', to: '/admin?tab=backups',
          text: `The last successful backup is ${Math.floor((now - lastAt) / DAY)} days old. Check the backup schedule and storage.` });
      }
    }
    if (b.storage === 'local') {
      alerts.push({ id: 'backup-local', level: 'info', to: '/admin?tab=backups',
        text: 'Backups are stored only on this server. They will not survive a failed disk; store them on a network share.' });
    }
  }
  if (status.lastUpdateResult === 'failed' || status.lastUpdateResult === 'skipped') {
    alerts.push({ id: `update-${status.lastUpdateResult}:${status.lastUpdateAt}`, level: 'error', to: '/admin?tab=system',
      text: status.lastUpdateResult === 'skipped'
        ? `The automatic update on ${new Date(status.lastUpdateAt).toLocaleString()} was skipped because the backup before it failed.`
        : `The automatic update on ${new Date(status.lastUpdateAt).toLocaleString()} failed. See the update log.` });
  }
  const p = status.proxy;
  if (p?.latest && major(p.latest) > Number(p.tag)) {
    alerts.push({ id: `proxy-major:${p.latest}`, level: 'info', to: '/admin?tab=system',
      text: `Nginx Proxy Manager ${p.latest} is available (a new major version). It is not installed automatically; see Admin → System.` });
  }
  return alerts;
}

const STYLE = {
  error:   { box: 'bg-red-900/25 border-red-800 text-red-200', Icon: XCircle },
  warning: { box: 'bg-amber-900/20 border-amber-800 text-amber-200', Icon: AlertTriangle },
  info:    { box: 'bg-surface-800 border-surface-600 text-gray-300', Icon: Info },
};

export function ServerAlerts({ enabled }) {
  const { data } = useQuery({ queryKey: ['admin', 'host'], queryFn: adminApi.host, enabled, staleTime: 60_000 });
  const [hidden, setHidden] = useState(readHidden);
  if (!enabled) return null;

  const now = Date.now();
  const visible = serverAlerts(data, now).filter(a => !(hidden[a.id] && hidden[a.id] > now));
  if (!visible.length) return null;

  const hide = (id) => {
    const next = Object.fromEntries(Object.entries({ ...hidden, [id]: now + HIDE_DAYS * DAY }).filter(([, until]) => until > now));
    setHidden(next);
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  return (
    <div className="space-y-2 mb-6" role="status">
      {visible.map(a => {
        const { box, Icon } = STYLE[a.level];
        return (
          <div key={a.id} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${box}`}>
            <Icon size={16} className="shrink-0 mt-0.5" />
            <Link to={a.to} className="flex-1 hover:underline">{a.text}</Link>
            <button type="button" onClick={() => hide(a.id)} className="p-0.5 opacity-70 hover:opacity-100" aria-label="Hide for a week" title="Hide for a week">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
