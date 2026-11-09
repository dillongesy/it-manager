import 'dotenv/config';
import '../src/config/load-secrets.js';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import readline from 'readline';

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost', port: parseInt(process.env.DB_PORT ?? '5432'),
  database: process.env.DB_NAME ?? 'field', user: process.env.DB_USER ?? 'field',
  password: process.env.DB_PASSWORD,
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

async function main() {
  const { rows } = await pool.query("SELECT COUNT(*) FROM users WHERE role='admin'");
  if (parseInt(rows[0].count) > 0) { console.log('Admin already exists.'); process.exit(0); }

  console.log('\n── Create first Field App admin ──\n');
  const full_name = await ask('Full name:     ');
  const username  = await ask('Username:      ');
  const initials  = await ask('Initials:      ');
  const password  = await ask('Password (≥12 chars): ');

  if (password.length < 12) { console.error('Too short.'); process.exit(1); }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, full_name, initials, password_hash, role)
     VALUES ($1,$2,$3,$4,'admin')`,
    [username.toLowerCase().trim(), full_name.trim(), initials.toUpperCase().trim(), hash]
  );
  console.log(`\nAdmin created: ${full_name}`);
  rl.close(); await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
