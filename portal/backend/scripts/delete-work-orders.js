// One-off maintenance script — NOT a normal app feature.
// Permanently deletes specific work orders by their WO number, regardless of status
// (the app only allows deleting drafts). Use this to clean up test work orders that
// were created before going to production.
//
// Usage:
//   node scripts/delete-work-orders.js 12 15 18          # DRY RUN — lists what would be deleted
//   node scripts/delete-work-orders.js 12 15 18 --yes    # actually delete
//
// Pass the numeric part of the WO number (e.g. 34 for WO-00034). Child rows (sections,
// technicians, parts, services, proposal links) are removed automatically via ON DELETE
// CASCADE. This cannot be undone — take a DB backup first if unsure.
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the backend root regardless of the current working directory, so the
// script works whether you run it from portal/backend or from inside scripts/.
const __dir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dir, '..', '.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'portal',
  user: process.env.DB_USER ?? 'portal',
  password: process.env.DB_PASSWORD,
});

const woNum = (n) => `WO-${String(n).padStart(5, '0')}`;

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--yes');
  const numbers = args.filter(a => /^\d+$/.test(a)).map(Number);

  if (numbers.length === 0) {
    console.error('Usage: node scripts/delete-work-orders.js <number> [<number> ...] [--yes]');
    console.error('Example: node scripts/delete-work-orders.js 12 15 18 --yes');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT wo.id, wo.number, wo.status, c.name AS customer_name
     FROM work_orders wo JOIN customers c ON c.id = wo.customer_id
     WHERE wo.number = ANY($1::int[])
     ORDER BY wo.number`,
    [numbers]
  );

  const found = new Set(rows.map(r => r.number));
  const missing = numbers.filter(n => !found.has(n));

  if (rows.length === 0) {
    console.log('No matching work orders found for:', numbers.map(woNum).join(', '));
    process.exit(0);
  }

  console.log(`\nMatched ${rows.length} work order(s):`);
  for (const r of rows) {
    console.log(`  ${woNum(r.number)}  [${r.status}]  ${r.customer_name}`);
  }
  if (missing.length) console.log(`\nNot found (skipped): ${missing.map(woNum).join(', ')}`);

  if (!confirm) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --yes to permanently delete the above.\n');
    process.exit(0);
  }

  const ids = rows.map(r => r.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Children (sections → techs/items, services, proposals) cascade from work_orders.
    const del = await client.query('DELETE FROM work_orders WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
    console.log(`\nDeleted ${del.rowCount} work order(s): ${rows.map(r => woNum(r.number)).join(', ')}\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch(err => { console.error('Error:', err.stack || err); process.exitCode = 1; })
  .finally(() => pool.end());
