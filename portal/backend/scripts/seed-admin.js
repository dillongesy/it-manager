// Run with: node scripts/seed-admin.js
// Creates the initial admin user. Run once after migration.
import 'dotenv/config';
import '../src/config/load-secrets.js';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import readline from 'readline';

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'portal',
  user: process.env.DB_USER ?? 'portal',
  password: process.env.DB_PASSWORD,
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  const { rows } = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
  if (parseInt(rows[0].count, 10) > 0) {
    console.log('An admin user already exists. Skipping seed.');
    process.exit(0);
  }

  console.log('\n── Create first admin account (normally done by the setup wizard) ──\n');
  const full_name = await ask('Full name:     ');
  const username  = await ask('Username:      ');
  const email     = await ask('Email:         ');
  const password  = await ask('Password (≥12 chars): ');

  if (password.length < 12) {
    console.error('Password too short.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [username.toLowerCase().trim(), email.toLowerCase().trim(), full_name.trim(), hash]
  );

  console.log(`\nAdmin account created for ${full_name}. You can now log in.`);
  rl.close();
  await pool.end();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
