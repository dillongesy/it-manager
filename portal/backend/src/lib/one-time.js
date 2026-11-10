// One-time material written by the init container into the REVEAL_DIR volume
// (the only volume the Portal API can write to besides uploads):
//
//   setup_code   - proves the person running the setup wizard can see the server's
//                  container logs (the Portal API prints it on start-up until setup
//                  is complete). Shredded when setup completes.
//   bundle.json  - the recovery secrets (master encryption key, DB passwords, …).
//                  Shredded the instant it is read. After that, no API route can
//                  produce it again: the only copies left are the read-only secret
//                  files mounted into each container, which no route exposes.
//                  Getting them back requires root on the host (`docker` access).
//
// "Shred" = claim the file with an atomic rename (so two concurrent requests can
// never both read it), overwrite it with random bytes, fsync, truncate, unlink.
// Overwriting is best-effort on copy-on-write / journaling filesystems; the hard
// guarantee is that the file is gone and the API refuses forever (see the
// system.secretsRevealedAt flag checked by the caller).
import crypto from 'crypto';
import { existsSync } from 'fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/index.js';

const pathOf = (name) => (config.revealDir ? join(config.revealDir, name) : null);

export const SETUP_CODE = 'setup_code';
export const BUNDLE = 'bundle.json';

export function oneTimeExists(name) {
  const p = pathOf(name);
  return Boolean(p && existsSync(p));
}

export async function peekOneTime(name) {
  const p = pathOf(name);
  if (!p) return null;
  try { return (await readFile(p, 'utf8')).trim(); } catch { return null; }
}

/** A new setup code, e.g. "4F2A-91C0-7BDE". */
export function generateSetupCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
}

/** Write a one-time file atomically, readable by this process only. */
export async function writeOneTime(name, value) {
  const p = pathOf(name);
  if (!p) return;
  const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, value, { mode: 0o600 });
  await rename(tmp, p);
}

async function shred(p) {
  try {
    const { size } = await stat(p);
    const fh = await open(p, 'r+');
    try {
      const len = Math.max(size, 1);
      for (let pass = 0; pass < 3; pass++) {
        await fh.write(crypto.randomBytes(len), 0, len, 0);
        await fh.sync();
      }
      await fh.truncate(0);
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch { /* fall through to unlink */ }
  await unlink(p).catch(() => {});
}

// Serialize consumers inside this process too, so "exactly once" never depends on
// the filesystem's rename semantics (atomic on Linux, not on every platform).
let lock = Promise.resolve();

// Read the file exactly once, then destroy it. Returns null if it is already gone.
export function consumeOneTime(name) {
  const run = lock.then(() => consumeUnlocked(name));
  lock = run.catch(() => {});
  return run;
}

async function consumeUnlocked(name) {
  const p = pathOf(name);
  if (!p) return null;
  const claimed = `${p}.${crypto.randomBytes(8).toString('hex')}.claimed`;
  try {
    await rename(p, claimed);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return await readFile(claimed, 'utf8');
  } finally {
    await shred(claimed);
  }
}

export async function destroyOneTime(name) {
  const p = pathOf(name);
  if (p && existsSync(p)) await shred(p);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
