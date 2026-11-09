// Maintenance script — NOT a normal app feature.
// Permanently deletes JOB CAPTURES that have already been imported into the Portal
// (capture_status='imported') and are older than N days, along with their photo
// files on disk. Keeps the internet-facing Field DB clean — captures are meant to
// be ephemeral once they become a real Portal work order.
//
// Usage:
//   node scripts/purge-imported.js            # DRY RUN, default 30-day age
//   node scripts/purge-imported.js --days=14  # DRY RUN, 14-day age
//   node scripts/purge-imported.js --yes      # actually delete (30-day age)
//   node scripts/purge-imported.js --days=14 --yes
//
// Run from cron / a systemd timer. This cannot be undone — back up first if unsure.
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dir, '..', '.env') });
const UPLOAD = join(__dir, '..', 'uploads', 'photos');

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'field',
  user: process.env.DB_USER ?? 'field',
  password: process.env.DB_PASSWORD,
});

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--yes');
  const daysArg = args.find(a => /^--days=\d+$/.test(a));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

  const { rows: jobs } = await pool.query(
    `SELECT id, number, customer_name, imported_at, imported_wo_number
     FROM field_work_orders
     WHERE capture_status = 'imported'
       AND imported_at IS NOT NULL
       AND imported_at < NOW() - ($1 || ' days')::interval
     ORDER BY imported_at`,
    [String(days)]
  );

  if (jobs.length === 0) {
    console.log(`No imported jobs older than ${days} day(s) to purge.`);
    process.exit(0);
  }

  const ids = jobs.map(j => j.id);
  const { rows: photos } = await pool.query(
    `SELECT id, stored_name FROM field_photos WHERE work_order_id = ANY($1::uuid[])`,
    [ids]
  );

  console.log(`\nMatched ${jobs.length} imported job(s) older than ${days} day(s):`);
  for (const j of jobs) {
    const wo = j.imported_wo_number ? ` → WO-${String(j.imported_wo_number).padStart(5, '0')}` : '';
    console.log(`  Job #${j.number}  ${j.customer_name || ''}${wo}  (imported ${new Date(j.imported_at).toLocaleDateString()})`);
  }
  console.log(`  + ${photos.length} photo file(s)`);

  if (!confirm) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --yes to permanently delete the above.\n');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Photos FK is ON DELETE SET NULL, so remove the rows explicitly first.
    await client.query('DELETE FROM field_photos WHERE work_order_id = ANY($1::uuid[])', [ids]);
    const del = await client.query('DELETE FROM field_work_orders WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');

    // Unlink files after the DB commit so a rolled-back transaction can't orphan them.
    let removed = 0;
    for (const p of photos) {
      const path = join(UPLOAD, p.stored_name);
      if (existsSync(path)) { try { unlinkSync(path); removed++; } catch {} }
    }
    console.log(`\nPurged ${del.rowCount} job(s) and ${removed}/${photos.length} photo file(s).\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Purge failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch(err => { console.error('Error:', err.stack || err); process.exitCode = 1; })
  .finally(() => pool.end());
