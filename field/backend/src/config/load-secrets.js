// Docker-secrets loader. For every `FOO_FILE=/path` environment variable, read
// that file into `FOO` (unless FOO is already set). Containers get their secrets
// as read-only files from a per-service volume written by the `init` container,
// so no secret ever lives in docker-compose.yml, an .env file, or `docker inspect`.
//
// Imported first by config/index.js and by the standalone scripts (migrate, seed).
import { readFileSync } from 'fs';

for (const [key, path] of Object.entries(process.env)) {
  if (!key.endsWith('_FILE') || !path) continue;
  const base = key.slice(0, -'_FILE'.length);
  if (process.env[base]) continue;
  try {
    process.env[base] = readFileSync(path, 'utf8').trim();
  } catch (err) {
    console.error(`Cannot read ${key} (${path}): ${err.code ?? err.message}`);
  }
}
