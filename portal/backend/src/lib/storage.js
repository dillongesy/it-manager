// Server storage: disk capacity, what the application stores, growth and a forecast
// of when the disk fills up.
//
// The disk is measured on the uploads volume, which lives on the same filesystem as all
// Docker data (databases, images, logs), so its free space is what the stack runs on.
// A snapshot is recorded every few hours; the forecast is a least-squares trend of the
// used space over the last FORECAST_DAYS days.
import { statfs, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db/index.js';
import { fieldPlatform, isFieldConfigured } from './field-client.js';

export const UPLOADS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

const DAY_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const FORECAST_DAYS = 30;
const RETENTION_DAYS = 400;
const MIN_HISTORY_DAYS = 1;

// A disk is "warning" or "critical" when it is this full, or expected to fill this soon.
export const THRESHOLDS = Object.freeze({
  warningPercent: 80, criticalPercent: 90,
  warningDays: 60, criticalDays: 14,
});

/** Capacity of the filesystem holding `path`, in bytes. `free` is what non-root can use. */
export async function diskUsage(path) {
  const s = await statfs(path);
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { total, free, used: total - s.bfree * s.bsize };
}

/** Total size of the regular files under `path`, in bytes (symlinks are not followed). */
export async function directorySize(path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await lstat(child)).size;
  }
  return total;
}

async function databaseSize() {
  const { rows } = await query('SELECT pg_database_size(current_database())::bigint AS bytes');
  return Number(rows[0].bytes);
}

/** Measure everything now. The Field App part is null when its API can't be reached. */
export async function measure() {
  const [disk, portalDatabase, portalFiles] = await Promise.all([
    diskUsage(UPLOADS_ROOT), databaseSize(), directorySize(UPLOADS_ROOT),
  ]);
  let field = null;
  if (isFieldConfigured()) {
    try {
      const f = await fieldPlatform.storage();
      field = { database: Number(f.database) || 0, files: Number(f.files) || 0 };
    } catch { /* reported as unavailable */ }
  }
  return {
    measuredAt: new Date().toISOString(),
    disk,
    portal: { database: portalDatabase, files: portalFiles },
    field,
  };
}

/**
 * Least-squares growth of disk usage, in bytes per day, over `days` days before `now`.
 * Returns null when the history spans less than MIN_HISTORY_DAYS.
 * @param {{ takenAt: Date|string, used: number }[]} history
 */
export function growthPerDay(history, now = new Date(), days = FORECAST_DAYS) {
  const since = now.getTime() - days * DAY_MS;
  const points = history
    .map(h => ({ t: new Date(h.takenAt).getTime(), y: Number(h.used) }))
    .filter(p => p.t >= since && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2 || points[points.length - 1].t - points[0].t < MIN_HISTORY_DAYS * DAY_MS) return null;

  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.y - meanY);
    den += (p.t - meanT) ** 2;
  }
  return den === 0 ? null : (num / den) * DAY_MS;
}

/**
 * Forecast and status for a disk.
 * @returns {{ usedPercent: number, growthPerDay: number|null, daysUntilFull: number|null,
 *             fullBy: string|null, status: 'ok'|'warning'|'critical' }}
 */
export function forecast(disk, history, now = new Date()) {
  const usedPercent = disk.total > 0 ? Math.round(((disk.total - disk.free) / disk.total) * 1000) / 10 : 0;
  const growth = growthPerDay(history, now);
  const daysUntilFull = growth && growth > 0 ? Math.floor(disk.free / growth) : null;
  const fullBy = daysUntilFull == null ? null : new Date(now.getTime() + daysUntilFull * DAY_MS).toISOString().slice(0, 10);

  let status = 'ok';
  if (usedPercent >= THRESHOLDS.criticalPercent || (daysUntilFull != null && daysUntilFull < THRESHOLDS.criticalDays)) {
    status = 'critical';
  } else if (usedPercent >= THRESHOLDS.warningPercent || (daysUntilFull != null && daysUntilFull < THRESHOLDS.warningDays)) {
    status = 'warning';
  }
  return { usedPercent, growthPerDay: growth, daysUntilFull, fullBy, status };
}

async function recordSnapshot(m) {
  await query(
    `INSERT INTO storage_snapshots (disk_total, disk_used, disk_free, portal_database, portal_files, field_database, field_files)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [m.disk.total, m.disk.used, m.disk.free, m.portal.database, m.portal.files, m.field?.database ?? null, m.field?.files ?? null]
  );
  await query(`DELETE FROM storage_snapshots WHERE taken_at < NOW() - make_interval(days => $1)`, [RETENTION_DAYS]);
}

async function history() {
  const { rows } = await query(
    `SELECT taken_at, disk_used FROM storage_snapshots
      WHERE taken_at > NOW() - make_interval(days => $1) ORDER BY taken_at`,
    [FORECAST_DAYS]
  );
  return rows.map(r => ({ takenAt: r.taken_at, used: Number(r.disk_used) }));
}

/** The Admin → System storage report: a fresh measurement plus the forecast. */
export async function storageReport() {
  const m = await measure();
  return { ...m, forecast: forecast(m.disk, await history()), thresholds: THRESHOLDS };
}

/** Record a snapshot now if the last one is older than the interval, then on a timer. */
export function startStorageMonitor() {
  const tick = async () => {
    try {
      const { rows } = await query('SELECT MAX(taken_at) AS last FROM storage_snapshots');
      const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0;
      if (Date.now() - last >= SNAPSHOT_INTERVAL_MS - 60_000) await recordSnapshot(await measure());
    } catch (err) {
      console.error('Storage snapshot failed:', err.message);
    }
  };
  tick();
  const timer = setInterval(tick, SNAPSHOT_INTERVAL_MS);
  timer.unref();
  return timer;
}
