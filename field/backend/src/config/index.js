import 'dotenv/config';
import './load-secrets.js';

function require_env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port:    parseInt(process.env.PORT ?? '3001', 10),
  host:    process.env.HOST || '127.0.0.1',
  trustProxy: parseInt(process.env.TRUST_PROXY ?? '1', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev:   (process.env.NODE_ENV ?? 'development') === 'development',
  db: {
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME     ?? 'field',
    user:     process.env.DB_USER     ?? 'field',
    password: require_env('DB_PASSWORD'),
  },
  jwt: {
    accessSecret:      require_env('ACCESS_TOKEN_SECRET'),
    refreshSecret:     require_env('REFRESH_TOKEN_SECRET'),
    accessExpiry:      process.env.ACCESS_TOKEN_EXPIRY         ?? '15m',
    refreshExpiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS ?? '7', 10),
  },
  cors:         { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5174' },
  bcryptRounds: 12,

  // Shared-inventory bridge: the Portal authenticates to the Field API with this
  // static token (sent as X-Service-Token). Null = bridge disabled.
  serviceToken: process.env.SERVICE_TOKEN ?? null,
  // Defense in depth for the bridge: when set (Docker), /api/service/* only answers
  // connections whose source address is inside this CIDR - the internal bridge
  // network that only the Portal API shares. e.g. 172.29.7.0/24
  serviceAllowedCidr: process.env.SERVICE_ALLOWED_CIDR || null,
};
