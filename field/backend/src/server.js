import { config } from './config/index.js';
import { pool } from './db/index.js';
import app from './app.js';

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (err) {
    console.error('Cannot connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  app.listen(config.port, config.host, () => {
    console.log(`Field API running on ${config.host}:${config.port} [${config.nodeEnv}]`);
  }); 
}

start();
