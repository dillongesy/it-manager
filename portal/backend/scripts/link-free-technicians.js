// One-off maintenance script — NOT a normal app feature.
//
// Work orders imported from the Field App BEFORE the technician-matching fix carry
// their whole field crew as free-text technicians. Where that person also has a Portal
// login, the work order shows them twice: once as a free-text chip, and again as their
// own (unselected) Portal user in the technician picker.
//
// This converts those free-text rows into real linked-user rows, using the same
// matching rules as the importer (exact full name, or UNAMBIGUOUS initials). Names that
// don't resolve to exactly one active Portal user are left alone — subcontractors and
// crew without accounts belong as free text.
//
// Usage:
//   node scripts/link-free-technicians.js           # DRY RUN — shows what would change
//   node scripts/link-free-technicians.js --yes     # apply
//   node scripts/link-free-technicians.js 123 --yes # limit to WO-00123
//
// Safe to re-run: a row already linked to a user is never touched, and if the section
// already has that user linked the redundant free-text row is simply deleted.
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { matchPortalUser } from '../src/lib/field-import.js';

const __dir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dir, '..', '.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'portal',
  user: process.env.DB_USER ?? 'portal',
  password: process.env.DB_PASSWORD,
});

const args    = process.argv.slice(2);
const apply   = args.includes('--yes');
const woArgs  = args.filter((a) => /^\d+$/.test(a)).map(Number);

const woNum = (n) => `WO-${String(n).padStart(5, '0')}`;

async function main() {
  const { rows: users } = await pool.query('SELECT id, full_name FROM users WHERE is_active = true');
  if (!users.length) {
    console.log('No active Portal users — nothing to match against.');
    return;
  }

  const params = [];
  let where = 'wot.user_id IS NULL AND wot.name IS NOT NULL';
  if (woArgs.length) {
    params.push(woArgs);
    where += ` AND wo.number = ANY($${params.length})`;
  }

  const { rows: freeRows } = await pool.query(
    `SELECT wot.id, wot.name, wot.section_id, wot.work_order_id, wo.number
       FROM work_order_technicians wot
       JOIN work_orders wo ON wo.id = wot.work_order_id
      WHERE ${where}
      ORDER BY wo.number, wot.name`,
    params
  );

  const toLink = [];
  const toDrop = [];   // section already has this user linked — the chip is redundant
  const skipped = [];

  for (const row of freeRows) {
    const userId = matchPortalUser(row.name, users);
    if (!userId) { skipped.push(row); continue; }
    const { rows: dupe } = await pool.query(
      'SELECT 1 FROM work_order_technicians WHERE section_id = $1 AND user_id = $2 LIMIT 1',
      [row.section_id, userId]
    );
    (dupe.length ? toDrop : toLink).push({ ...row, userId });
  }

  const nameOf = (id) => users.find((u) => u.id === id)?.full_name ?? id;

  console.log(`\nFree-text technician rows examined: ${freeRows.length}\n`);
  for (const r of toLink) console.log(`  ${woNum(r.number)}  link   "${r.name}" → ${nameOf(r.userId)}`);
  for (const r of toDrop) console.log(`  ${woNum(r.number)}  drop   "${r.name}" (${nameOf(r.userId)} already on this section)`);
  if (skipped.length) {
    const names = [...new Set(skipped.map((r) => r.name))].sort();
    console.log(`\n  Left as free text (no single matching Portal user): ${names.join(', ')}`);
  }

  if (!toLink.length && !toDrop.length) { console.log('\nNothing to change.'); return; }
  if (!apply) {
    console.log(`\nDRY RUN — re-run with --yes to apply ${toLink.length + toDrop.length} change(s).`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of toLink) {
      await client.query(
        'UPDATE work_order_technicians SET user_id = $2, name = NULL WHERE id = $1',
        [r.id, r.userId]
      );
    }
    for (const r of toDrop) {
      await client.query('DELETE FROM work_order_technicians WHERE id = $1', [r.id]);
    }
    await client.query('COMMIT');
    console.log(`\nDone — ${toLink.length} linked, ${toDrop.length} redundant row(s) removed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
