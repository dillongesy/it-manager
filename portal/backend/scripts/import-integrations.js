// Copy integration settings from an old Portal .env file into Admin → Integrations
// (encrypted in the database). Used by scripts/import-existing.sh; safe to re-run.
//
//   node scripts/import-integrations.js /path/to/old.env
//   node scripts/import-integrations.js - < old.env        (read from stdin)
import '../src/config/load-secrets.js';
import { readFileSync } from 'fs';
import { parse } from 'dotenv';
import { INTEGRATIONS } from '../src/lib/integration-registry.js';
import { saveIntegration } from '../src/lib/settings.js';
import { pool } from '../src/db/index.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/import-integrations.js <old.env>'); process.exit(2); }
const env = parse(readFileSync(file === '-' ? 0 : file));

let imported = 0;
for (const def of INTEGRATIONS) {
  const values = {};
  for (const f of def.fields) if (env[f.env]) values[f.key] = env[f.env];
  if (!Object.keys(values).length) continue;
  const complete = def.fields.filter(f => f.required).every(f => values[f.key]);
  try {
    await saveIntegration(def.id, { enabled: complete, values }, null);
    console.log(`  ${def.label}: imported${complete ? ' and enabled' : ' (incomplete — left off)'}`);
    imported++;
  } catch (err) {
    console.error(`  ${def.label}: ${err.message}`);
  }
}
console.log(imported ? `${imported} integration(s) imported.` : 'No integration settings found in that file.');
await pool.end();
