// Run with: node scripts/gen-env.js
// Generates a .env file with real random secrets. Run once during setup.
import crypto from 'crypto';
import { writeFileSync, existsSync } from 'fs';

const envPath = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

if (existsSync(envPath)) {
  console.log('.env already exists — delete it first if you want to regenerate.');
  process.exit(0);
}

const access     = crypto.randomBytes(64).toString('hex');
const refresh    = crypto.randomBytes(64).toString('hex');
const encryption = crypto.randomBytes(32).toString('hex');

const content = `# Auto-generated — keep this file secret, never commit it
DB_HOST=localhost
DB_PORT=5432
DB_NAME=field
DB_USER=field
DB_PASSWORD=change_me_strong_password

ACCESS_TOKEN_SECRET=${access}
REFRESH_TOKEN_SECRET=${refresh}

ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY_DAYS=7

# Encrypts all stored passwords/credentials at rest
ENCRYPTION_KEY=${encryption}

PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
`;

writeFileSync(envPath, content, 'utf8');
console.log('.env created with fresh secrets.');
console.log('→ Update DB_PASSWORD before running the server.');
