import 'dotenv/config';
import './load-secrets.js';

function require_env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  // Bind address. Containers set HOST to the API's fixed address on the internal
  // app network, so nothing on the Field bridge network can open a connection to it.
  host: process.env.HOST || '127.0.0.1',
  // Proxies in front of the API (Docker: portal-web = 1).
  trustProxy: parseInt(process.env.TRUST_PROXY ?? '1', 10),
  appVersion: process.env.APP_VERSION || 'dev',
  // One-time setup material written by the init container (setup code + the
  // reveal-once recovery bundle). Unset in local dev = no setup code required.
  revealDir: process.env.REVEAL_DIR || null,
  // The internet-facing reverse proxy's network. Requests from it are always refused.
  proxySubnet: process.env.PROXY_SUBNET || null,
  // Volume shared with the host helper installed by install.sh (lib/host-control.js).
  hostControlDir: process.env.HOST_CONTROL_DIR || null,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'portal',
    user: process.env.DB_USER ?? 'portal',
    password: require_env('DB_PASSWORD'),
  },

  jwt: {
    accessSecret: require_env('ACCESS_TOKEN_SECRET'),
    refreshSecret: require_env('REFRESH_TOKEN_SECRET'),
    accessExpiry: process.env.ACCESS_TOKEN_EXPIRY ?? '15m',
    refreshExpiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS ?? '7', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  },

  bcryptRounds: 12,

  encryptionKey: require_env('ENCRYPTION_KEY'),

  // Shared-inventory bridge - the Portal reaches OUT to the Field App's service
  // API to read and consume shared stock. One-way: the Field App never calls back.
  // Both unset = inventory feature disabled (the UI shows it's not configured).
  fieldApi: {
    url: process.env.FIELD_API_URL ?? null,
    token: process.env.FIELD_API_TOKEN ?? null,
  },

  // ConnectWise RMM (ConnectWise Platform / "Asio" API) - read-only machine import into a
  // customer's Devices tab. Credentials come from ConnectWise RMM → Integrations → API
  // Access. Outbound only: the Portal calls ConnectWise; nothing on the internet calls the
  // Portal. Client ID + secret unset = the import button explains how to configure it.
  connectWise: {
    clientId:     process.env.CONNECTWISE_CLIENT_ID ?? null,
    clientSecret: process.env.CONNECTWISE_CLIENT_SECRET ?? null,
    // Optional. Normally worked out from the Client ID's prefix (NA / EU / AU region).
    baseUrl:      process.env.CONNECTWISE_BASE_URL ?? null,
  },

  // Dell TechDirect warranty API - fills "Warranty Expires" on Dell machines from their
  // service tag. Read-only lookups. Unset = the warranty buttons explain how to set it up.
  dell: {
    clientId:     process.env.DELL_CLIENT_ID ?? null,
    clientSecret: process.env.DELL_CLIENT_SECRET ?? null,
    // Optional override (e.g. a sandbox gateway Dell gives you while the key is pending).
    baseUrl:      process.env.DELL_API_URL ?? null,
  },

  // ScreenConnect (the instance bundled with ConnectWise RMM) - the Remote button on a
  // device. Needs the RESTful API Manager extension; the Portal only ever calls its
  // session lookup, never the command methods the same secret could reach.
  screenConnect: {
    url:         process.env.SCREENCONNECT_URL ?? null,
    secret:      process.env.SCREENCONNECT_API_SECRET ?? null,
    // The session group in the join link (…/Host#Access/<group>//<session>/Join).
    group:       process.env.SCREENCONNECT_SESSION_GROUP || 'All Machines',
    // The RESTful API Manager's extension ID - the same on every instance.
    extensionId: process.env.SCREENCONNECT_EXTENSION_ID || '2d558935-686a-4bd0-9991-07539f5fe749',
  },

  // UniFi (api.ui.com) - device / network / camera import. One cloud API key; the
  // Portal only sends GET requests, though the key itself could change things.
  unifi: {
    apiKey: process.env.UNIFI_API_KEY ?? null,
  },

  // TD SYNNEX (StreamOne Stellr) - Microsoft 365 subscriptions → a customer's Billing tab.
  // OAuth2 client credentials from the Stellr Developer Portal. Read-only lookups.
  // Sandbox and production credentials are separate - the URLs must match the key.
  // Auvik - "Web UI" buttons (Remote Browser) on network gear. Read-only.
  auvik: {
    username: process.env.AUVIK_USERNAME ?? null,
    apiKey:   process.env.AUVIK_API_KEY ?? null,
    region:   process.env.AUVIK_REGION || 'us1',
  },

  // Outlook - the team's shared calendar on the Tasks schedule, via Microsoft Graph. The Portal
  // shows and edits its events, and puts tasks on it on request ("Add to Outlook").
  outlook: {
    tenantId:     process.env.OUTLOOK_TENANT_ID ?? null,
    clientId:     process.env.OUTLOOK_CLIENT_ID ?? null,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET ?? null,
    // Whoever shared the calendar (it lives in their mailbox), and its name in their Outlook.
    owner:        process.env.OUTLOOK_CALENDAR_OWNER ?? null,
    calendarName: process.env.OUTLOOK_CALENDAR_NAME ?? null,
    // The office's time zone (IANA). Times the Portal writes to Outlook are wall-clock times here.
    timeZone:     process.env.OUTLOOK_TIME_ZONE || 'America/Chicago',
  },

  // ThreatLocker - computers per customer org → Billing-tab seat counts. Read-only.
  threatlocker: {
    apiKey:         process.env.THREATLOCKER_API_KEY ?? null,
    instance:       process.env.THREATLOCKER_INSTANCE ?? null,
    organizationId: process.env.THREATLOCKER_ORGANIZATION_ID ?? null,
  },


  tdSynnex: {
    clientId:     process.env.TDSYNNEX_CLIENT_ID ?? null,
    clientSecret: process.env.TDSYNNEX_CLIENT_SECRET ?? null,
    apiUrl:       process.env.TDSYNNEX_API_URL || 'https://api.us.tdsynnex.com',
    tokenUrl:     process.env.TDSYNNEX_TOKEN_URL || 'https://sso.us.tdsynnex.com/oauth2/v1/token',
  },
};
