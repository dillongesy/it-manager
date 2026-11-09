import { config } from './config/index.js';
import { pool } from './db/index.js';
import app from './app.js';
import { loadIntegrations } from './lib/settings.js';
import { pushBrandingWithRetry } from './lib/branding-sync.js';

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (err) {
    console.error('Cannot connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  // Integration credentials live in the database (Admin → Integrations), not .env.
  try {
    await loadIntegrations();
  } catch (err) {
    console.error('Could not load integration settings:', err.message);
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`Portal API ${config.appVersion} running on ${config.host}:${config.port} [${config.nodeEnv}]`);
  });

  // Keep the Field App's copy of the branding current (it may still be booting).
  pushBrandingWithRetry().catch(() => {});

  process.on('SIGTERM', () => {
    server.close(() => {
      pool.end();
      process.exit(0);
    });
  });
}

start();
