// Size of the Field App's uploaded files, reported to the Portal over the service bridge.
import { readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPLOADS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');

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
