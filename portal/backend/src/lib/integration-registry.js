// Every outside system the Portal can talk to, and the settings each one needs.
// These used to be .env variables; they are now edited in Admin → Integrations,
// stored in app_settings (secret fields encrypted), and copied into the live
// `config` object (config[section][key]) — the integration clients read config at
// call time, so a save takes effect immediately with no restart.
//
// Field shape: { key, label, secret?, required?, default?, placeholder?, help?, advanced?, env }
//   key      → config[section][key]
//   env      → the legacy .env variable, used once to seed settings on upgrade
//   required → the integration counts as "configured" only when these are set

export const INTEGRATIONS = [
  {
    id: 'connectwise',
    label: 'ConnectWise RMM',
    section: 'connectWise',
    summary: 'Import computers and servers (with hardware) into a customer\'s Devices tab. Read-only.',
    help: 'In ConnectWise RMM → Integrations → API Access → Generate API Access. Tick the read-only permissions Platform – Companies – Read, Sites – Read, Devices – Read and Assets – Read. The app only ever requests those scopes, even if the key has more.',
    fields: [
      { key: 'clientId',     label: 'Client ID',     required: true, env: 'CONNECTWISE_CLIENT_ID' },
      { key: 'clientSecret', label: 'Client secret', required: true, secret: true, env: 'CONNECTWISE_CLIENT_SECRET' },
      { key: 'baseUrl',      label: 'API base URL',  advanced: true, env: 'CONNECTWISE_BASE_URL',
        placeholder: 'Worked out from the Client ID (NA / EU / AU)', help: 'Only set this if sign-in fails and your account is on a different server.' },
    ],
  },
  {
    id: 'dell',
    label: 'Dell TechDirect',
    section: 'dell',
    summary: 'Fill "Warranty Expires" on Dell machines from their service tag. Read-only.',
    help: 'techdirect.dell.com → APIs → Request API Key → Warranty API ("Internal to our company"). Once approved: APIs → Manage API Keys — the "API Key" is the Client ID, the value in brackets is the Client Secret.',
    fields: [
      { key: 'clientId',     label: 'Client ID',     required: true, env: 'DELL_CLIENT_ID' },
      { key: 'clientSecret', label: 'Client secret', required: true, secret: true, env: 'DELL_CLIENT_SECRET' },
      { key: 'baseUrl',      label: 'API gateway URL', advanced: true, env: 'DELL_API_URL', placeholder: 'https://apigtwb2c.us.dell.com' },
    ],
  },
  {
    id: 'screenconnect',
    label: 'ScreenConnect',
    section: 'screenConnect',
    summary: 'A "Remote" button on a customer\'s devices that opens the machine\'s Join link.',
    help: 'In ScreenConnect: Admin → Extensions → install "RESTful API Manager", then ⋯ → Edit Settings and set RESTfulAuthenticationSecret to a long random value. Paste the same value here. Treat it like a domain admin password — the app only ever looks sessions up.',
    fields: [
      { key: 'url',         label: 'Instance URL', required: true, env: 'SCREENCONNECT_URL', placeholder: 'https://yourcompany.screenconnect.com' },
      { key: 'secret',      label: 'RESTful API secret', required: true, secret: true, env: 'SCREENCONNECT_API_SECRET' },
      { key: 'group',       label: 'Session group', default: 'All Machines', env: 'SCREENCONNECT_SESSION_GROUP' },
      { key: 'extensionId', label: 'Extension ID', advanced: true, default: '2d558935-686a-4bd0-9991-07539f5fe749', env: 'SCREENCONNECT_EXTENSION_ID',
        help: 'The RESTful API Manager\'s ID — the same on every instance.' },
    ],
  },
  {
    id: 'unifi',
    label: 'UniFi',
    section: 'unifi',
    summary: 'Import firewalls (WAN, VLANs, rules), switches, APs, WiFi passwords and Protect cameras.',
    help: 'unifi.ui.com → Settings → API Keys, signed in as the account that OWNS the customers\' consoles (consoles merely shared with the account only return the device list). The app only sends GET requests, but the key itself can change settings — keep it private.',
    fields: [
      { key: 'apiKey', label: 'API key', required: true, secret: true, env: 'UNIFI_API_KEY' },
    ],
  },
  {
    id: 'tdsynnex',
    label: 'TD SYNNEX StreamOne',
    section: 'tdSynnex',
    summary: 'Turn a customer\'s Microsoft 365 subscriptions into recurring charges on their Billing tab. Read-only.',
    help: 'EC Express → StreamOne → Integration → Developer API\'s → Developer Portal → Client Credentials → PROD. Sandbox credentials only work against the sandbox URLs.',
    fields: [
      { key: 'clientId',     label: 'Client ID',     required: true, env: 'TDSYNNEX_CLIENT_ID' },
      { key: 'clientSecret', label: 'Client secret', required: true, secret: true, env: 'TDSYNNEX_CLIENT_SECRET' },
      { key: 'apiUrl',   label: 'API URL',   advanced: true, default: 'https://api.us.tdsynnex.com', env: 'TDSYNNEX_API_URL' },
      { key: 'tokenUrl', label: 'Token URL', advanced: true, default: 'https://sso.us.tdsynnex.com/oauth2/v1/token', env: 'TDSYNNEX_TOKEN_URL' },
    ],
  },
  {
    id: 'auvik',
    label: 'Auvik',
    section: 'auvik',
    summary: '"Web UI" buttons on network devices that open Auvik\'s Remote Browser. Read-only.',
    help: 'In Auvik → your initials → Profile → API Key → Generate (shown once). Username is the email you sign in with. Region is the part before ".my.auvik.com" in your Auvik address (e.g. us6).',
    fields: [
      { key: 'username', label: 'Username (email)', required: true, env: 'AUVIK_USERNAME' },
      { key: 'apiKey',   label: 'API key', required: true, secret: true, env: 'AUVIK_API_KEY' },
      { key: 'region',   label: 'Region', default: 'us1', env: 'AUVIK_REGION', placeholder: 'us1' },
    ],
  },
  {
    id: 'outlook',
    label: 'Outlook calendar',
    section: 'outlook',
    summary: 'Show and edit the team\'s shared Outlook calendar beside tasks, and "Add to Outlook" from a task.',
    help: 'Register an app in Microsoft Entra ID with application permission Calendars.ReadWrite (or Calendars.Read for view-only) and grant admin consent. Calendar owner is the mailbox that owns the shared calendar; leave the calendar name blank for their main calendar.',
    fields: [
      { key: 'tenantId',     label: 'Tenant ID', required: true, env: 'OUTLOOK_TENANT_ID' },
      { key: 'clientId',     label: 'Client ID', required: true, env: 'OUTLOOK_CLIENT_ID' },
      { key: 'clientSecret', label: 'Client secret', required: true, secret: true, env: 'OUTLOOK_CLIENT_SECRET' },
      { key: 'owner',        label: 'Calendar owner (email)', required: true, env: 'OUTLOOK_CALENDAR_OWNER' },
      { key: 'calendarName', label: 'Calendar name', env: 'OUTLOOK_CALENDAR_NAME', placeholder: 'Blank = their main calendar' },
      { key: 'timeZone',     label: 'Office time zone (IANA)', default: 'America/Chicago', env: 'OUTLOOK_TIME_ZONE' },
    ],
  },
  {
    id: 'threatlocker',
    label: 'ThreatLocker',
    section: 'threatlocker',
    summary: 'Use each customer organization\'s protected-computer count as the seat count of a recurring charge. Read-only.',
    help: 'portal.threatlocker.com (your parent organization): Users → Add API User with a view-only role (View Organizations, View Computers). Instance is the letter in portalapi.<letter>.threatlocker.com (F12 → Network). Organization ID is your own parent organization\'s ID.',
    fields: [
      { key: 'apiKey',         label: 'API key', required: true, secret: true, env: 'THREATLOCKER_API_KEY' },
      { key: 'instance',       label: 'Instance letter', required: true, env: 'THREATLOCKER_INSTANCE', placeholder: 'g' },
      { key: 'organizationId', label: 'Parent organization ID', required: true, env: 'THREATLOCKER_ORGANIZATION_ID' },
    ],
  },
];

export const integrationById = (id) => INTEGRATIONS.find(i => i.id === id) ?? null;
