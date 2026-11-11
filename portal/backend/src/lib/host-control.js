// Server settings applied by the host helper that install.sh sets up.
//
// The Portal API cannot change anything on the host itself. It writes a request file
// (key=value lines) into the host_control volume; a root systemd service validates it
// against a fixed whitelist, applies it, and writes result.json and status.json back.
// See install.sh (host-apply). Without install.sh there is no helper, and these
// settings are reported as unavailable.
//
//   updates=off | daily:HH | weekly:DAY:HH    automatic update schedule
//   update=now                                start an update immediately
//   network=apply, lan=, names=               office network and Portal DNS names; the
//                                             helper re-issues the certificates and
//                                             restarts portal-web and field-web
//   backup-settings=save, backup-*=           backup schedule, retention, storage, options
//                                             (with backup-test=1: only test the storage)
//   backup-task=now|verify|restore|delete|protect|unprotect|refresh, backup-name=
//
// Passwords and passphrases travel base64-encoded and are never reported back.
//
// The firewall is chosen in the setup wizard (before the Portal runs) and afterwards
// only on the server; the Portal shows its status but cannot change it.
import crypto from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';

// Same patterns as install.sh (host-apply).
export const CIDR = /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}\/([0-9]|[12][0-9]|3[0-2])$/;
export const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
export const MAX_NETWORKS = 8;
export const BACKUP_SCHEDULE = /^(off|daily:([01][0-9]|2[0-3]):[0-5][0-9]|weekly:(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun)){0,6}:([01][0-9]|2[0-3]):[0-5][0-9])$/;
export const BACKUP_NAME = /^itm-[0-9]{4}_[0-9]{2}_[0-9]{2}-[0-9]{2}_[0-9]{2}_[0-9]{2}\.tar(\.zst|\.gz)?(\.gpg)?$/;
const BACKUP_PATH = /^\/[A-Za-z0-9._/-]{1,200}$/;
const SYSTEM_PATH = /^\/(proc|sys|dev|etc|usr|bin|sbin|lib|lib64|boot|run)(\/|$)/;
const SMB_SHARE = /^\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._$ -]+)+$/;
const NFS_EXPORT = /^[A-Za-z0-9.-]+:\/[A-Za-z0-9._/-]*$/;
const SHARE_USER = /^[A-Za-z0-9._@-]{0,64}$/;
const SHARE_DOMAIN = /^[A-Za-z0-9.-]{0,64}$/;
const KEEP_KEYS = ['last', 'daily', 'weekly', 'monthly', 'yearly'];
export const BACKUP_TASKS = ['now', 'verify', 'restore', 'delete', 'protect', 'unprotect', 'refresh'];
const b64 = (v) => Buffer.from(String(v), 'utf8').toString('base64');
export const MAX_NAMES = 10;

export const UPDATE_PRESET = /^(off|daily:([01][0-9]|2[0-3])|weekly:(mon|tue|wed|thu|fri|sat|sun):([01][0-9]|2[0-3]))$/;
const RESULT_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const dir = () => config.hostControlDir;

/** The helper's last status report, or null when there is no helper. */
export async function hostStatus() {
  if (!dir()) return null;
  try {
    const status = JSON.parse(await readFile(join(dir(), 'status.json'), 'utf8'));
    return status?.agent === true ? status : null;
  } catch {
    return null;
  }
}

async function waitForResult(id, timeoutMs = RESULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = JSON.parse(await readFile(join(dir(), 'result.json'), 'utf8'));
      if (result?.id === id) return { ok: result.ok === true, error: result.error || null };
    } catch { /* not written yet */ }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  fail(504, 'The server did not apply the change. Check that the it-manager-host service is running.');
}

// One request at a time: the helper processes a single request file.
let queue = Promise.resolve();

/**
 * Ask the host helper to change settings and wait for the result.
 * @param {{ updates?: string, update?: 'now', network?: { lan: string[], names: string[] } }} change
 * @returns {Promise<{ ok: boolean, error: string|null }>}
 */
export function requestHostChange(change) {
  const run = queue.then(() => send(change));
  queue = run.catch(() => {});
  return run;
}

/** Request lines for Admin → Backups settings; throws 400 on anything invalid. */
export function backupSettingsLines(b = {}) {
  const bad = (m) => fail(400, m);
  const onOff = (v) => (v ? 'on' : 'off');
  if (!BACKUP_SCHEDULE.test(String(b.schedule))) bad('Invalid backup schedule.');
  if (!['local', 'smb', 'nfs'].includes(b.storage)) bad('Choose where to store the backups.');
  const lines = ['backup-settings=save', `backup-schedule=${b.schedule}`, `backup-storage=${b.storage}`];
  if (b.storage === 'local') {
    const path = String(b.path ?? '').trim().replace(/\/+$/, '');
    if (!BACKUP_PATH.test(path) || path.includes('..') || SYSTEM_PATH.test(path)) bad('Choose a folder such as /var/backups/it-manager or a mounted disk (/mnt/backup).');
    lines.push(`backup-path=${path}`);
  } else {
    const share = String(b.share ?? '').trim();
    if (b.storage === 'smb' && !SMB_SHARE.test(share)) bad('Enter the share as //server/share (letters, digits, spaces, . _ - $).');
    if (b.storage === 'nfs' && !NFS_EXPORT.test(share)) bad('Enter the export as server:/path.');
    lines.push(`backup-share=${share}`);
  }
  if (b.storage === 'smb') {
    const user = String(b.user ?? '').trim();
    const domain = String(b.domain ?? '').trim();
    if (!SHARE_USER.test(user)) bad('Invalid share user name.');
    if (!SHARE_DOMAIN.test(domain)) bad('Invalid share domain.');
    lines.push(`backup-user=${user}`, `backup-domain=${domain}`);
    if (b.password) {
      if (/[\r\n]/.test(b.password) || String(b.password).length > 256) bad('Invalid share password.');
      lines.push(`backup-pass=${b64(b.password)}`);
    }
  }
  const keep = KEEP_KEYS.map(k => Number(b.keep?.[k] ?? 0));
  if (!keep.every(n => Number.isInteger(n) && n >= 0 && n <= 999)) bad('Retention values must be 0 to 999.');
  lines.push(`backup-keep=${keep.join(',')}`);
  if (!['zstd', 'gzip', 'none'].includes(b.compress)) bad('Invalid compression.');
  lines.push(`backup-compress=${b.compress}`);
  if (!['keep', 'set', 'off'].includes(b.encryption)) bad('Invalid encryption setting.');
  lines.push(`backup-encrypt=${b.encryption}`);
  if (b.encryption === 'set') {
    const p = String(b.passphrase ?? '');
    if (p.length < 12 || p.length > 256 || /[\r\n]/.test(p)) bad('The passphrase must be 12 to 256 characters, on one line.');
    lines.push(`backup-passphrase=${b64(p)}`);
  }
  lines.push(`backup-secrets=${onOff(b.includeKeys)}`, `backup-verify=${onOff(b.verify)}`);
  return lines;
}

async function send({ updates, update, network, backup, backupTest, backupTask } = {}) {
  if (!(await hostStatus())) fail(503, 'Server settings are available only on installations set up with install.sh.');
  const lines = [];
  if (updates !== undefined) {
    if (!UPDATE_PRESET.test(String(updates))) fail(400, 'Invalid update schedule.');
    lines.push(`updates=${updates}`);
  }
  if (update !== undefined) {
    if (update !== 'now') fail(400, 'Invalid update request.');
    lines.push('update=now');
  }
  if (network !== undefined) {
    const { lan = [], names = [] } = network;
    if (!lan.length || lan.length > MAX_NETWORKS || !lan.every(c => CIDR.test(c))) fail(400, 'Invalid office network.');
    if (names.length > MAX_NAMES || !names.every(n => HOSTNAME.test(n))) fail(400, 'Invalid DNS name.');
    lines.push('network=apply', `lan=${lan.join(',')}`, `names=${names.join(',')}`);
  }
  if (backup !== undefined) lines.push(...backupSettingsLines(backup));
  if (backupTest !== undefined) lines.push(...backupSettingsLines(backupTest), 'backup-test=1');
  if (backupTask !== undefined) {
    const { task, name } = backupTask;
    if (!BACKUP_TASKS.includes(task)) fail(400, 'Invalid backup task.');
    lines.push(`backup-task=${task}`);
    if (!['now', 'refresh'].includes(task)) {
      if (!BACKUP_NAME.test(String(name))) fail(400, 'Invalid backup name.');
      lines.push(`backup-name=${name}`);
    }
  }
  if (!lines.length) fail(400, 'Nothing to change.');

  const id = crypto.randomUUID();
  const tmp = join(dir(), `.request-${id}`);
  await writeFile(tmp, [`id=${id}`, ...lines, ''].join('\n'), { mode: 0o600 });
  await rename(tmp, join(dir(), 'request'));
  // Saving backup settings tests the storage (mounting a share can take a while).
  return waitForResult(id, backup !== undefined || backupTest !== undefined ? 180_000 : RESULT_TIMEOUT_MS);
}

export const LOGS = ['install', 'update', 'network', 'backup', 'verify', 'restore'];

/** The backups on the configured storage, as last listed by the host helper. */
export async function backupList() {
  if (!dir()) return null;
  try { return JSON.parse(await readFile(join(dir(), 'backups.json'), 'utf8')); } catch { return null; }
}

/** A log written by the host helper: installation, last update, network change, backup, verify or restore. */
export async function hostLog(name) {
  if (!dir() || !LOGS.includes(name)) return null;
  try { return await readFile(join(dir(), `${name}.log`), 'utf8'); } catch { return null; }
}

/** The setup wizard's copy of the setup code (see init-secrets.sh). */
export async function writeInstallerSetupCode(code) {
  if (!dir()) return;
  const tmp = join(dir(), `.setup_code-${crypto.randomUUID()}`);
  await writeFile(tmp, code, { mode: 0o600 });
  await rename(tmp, join(dir(), 'setup_code'));
}

export async function removeInstallerSetupCode() {
  if (dir()) await rm(join(dir(), 'setup_code'), { force: true });
}
