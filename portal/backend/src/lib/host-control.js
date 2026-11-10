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
//
// The firewall is chosen in the setup wizard (before the Portal runs) and afterwards
// only on the server; the Portal shows its status but cannot change it.
import crypto from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';

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

async function waitForResult(id) {
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
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
 * @param {{ updates?: string, update?: 'now' }} change
 * @returns {Promise<{ ok: boolean, error: string|null }>}
 */
export function requestHostChange(change) {
  const run = queue.then(() => send(change));
  queue = run.catch(() => {});
  return run;
}

async function send({ updates, update } = {}) {
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
  if (!lines.length) fail(400, 'Nothing to change.');

  const id = crypto.randomUUID();
  const tmp = join(dir(), `.request-${id}`);
  await writeFile(tmp, [`id=${id}`, ...lines, ''].join('\n'), { mode: 0o644 });
  await rename(tmp, join(dir(), 'request'));
  return waitForResult(id);
}

/** The installation or the last update's log, as written by the host helper. */
export async function hostLog(name) {
  if (!dir() || !['install', 'update'].includes(name)) return null;
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
