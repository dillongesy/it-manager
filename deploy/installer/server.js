// Setup wizard served before the stack is installed (the `installer` service).
//
// It collects the server settings in the browser, hands them to the host helper (a
// root systemd service installed by install.sh) through the host_control volume, and
// shows the installation log as the helper writes it. It holds the Portal's port with
// the Portal's certificate; the helper stops it once the Portal is ready to take over.
//
//   GET  /api/installer/state          host facts, defaults and installation state
//   POST /api/installer/verify         { code }
//   POST /api/installer/check-prefix   { code, prefix } → overlaps with host networks
//   POST /api/installer/install        { code, settings }
//   GET  /api/installer/log?offset=N   installation log from byte N
//
// No dependencies; Node's https module only.
import https from 'node:https';
import crypto from 'node:crypto';
import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8443);
const TLS_DIR = process.env.TLS_DIR ?? '/tls';
const CONTROL = process.env.HOST_CONTROL_DIR ?? '/host-control';
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const RESULT_TIMEOUT_MS = 30_000;

// --- Validation (the host helper validates again) -----------------------------------

const RE = {
  cidr: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([0-9]|[12]\d|3[0-2])$/,
  prefix: /^(10\.(25[0-5]|2[0-4]\d|1?\d?\d)|172\.(1[6-9]|2\d|3[01])|192\.168)$/,
  name: /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/,
  updates: /^(off|daily:([01]\d|2[0-3])|weekly:(mon|tue|wed|thu|fri|sat|sun):([01]\d|2[0-3]))$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
};

function validateSettings(s = {}) {
  const errors = [];
  const lans = String(s.lanCidr ?? '').split(/[\s,]+/).filter(Boolean);
  if (!lans.length || lans.length > 8 || !lans.every(c => RE.cidr.test(c))) errors.push('Enter the LAN as a network range such as 192.168.1.0/24.');
  const names = String(s.names ?? '').split(/[\s,]+/).filter(Boolean);
  if (names.length > 10 || !names.every(n => RE.name.test(n))) errors.push('Portal names must be host names such as portal.office.lan.');
  if (!RE.prefix.test(String(s.prefix ?? ''))) errors.push('The internal subnet prefix must be a private range such as 172.29.');
  if (!['on', 'off'].includes(s.firewall)) errors.push('Choose whether to keep the firewall hardening.');
  if (!['bundled', 'external'].includes(s.proxy)) errors.push('Choose how the Field App is published.');
  if (s.proxy === 'external' && !RE.ipv4.test(String(s.proxyIp ?? ''))) errors.push('Enter the IP address of your reverse proxy.');
  if (!['dns', 'http'].includes(s.acme)) errors.push('Choose how the Field App certificate is validated.');
  if (!RE.updates.test(String(s.updates ?? ''))) errors.push('Choose an automatic update schedule.');
  return { errors, lans, names };
}

// --- Host helper ------------------------------------------------------------------

async function readJson(name) {
  try { return JSON.parse(await readFile(join(CONTROL, name), 'utf8')); } catch { return null; }
}

let queue = Promise.resolve();
function helperRequest(lines) {
  const run = queue.then(async () => {
    const id = crypto.randomUUID();
    const tmp = join(CONTROL, `.request-${id}`);
    await writeFile(tmp, [`id=${id}`, ...lines, ''].join('\n'), { mode: 0o644 });
    await rename(tmp, join(CONTROL, 'request'));
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const r = await readJson('result.json');
      if (r?.id === id) return r;
      await new Promise(res => setTimeout(res, 250));
    }
    return { ok: false, error: 'The server did not respond. Check that the it-manager-host service is running.' };
  });
  queue = run.catch(() => {});
  return run;
}

// --- Setup code -------------------------------------------------------------------

const failures = new Map();   // ip → { count, until }
const LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

async function checkCode(ip, code) {
  const f = failures.get(ip);
  if (f && f.until > Date.now() && f.count >= LIMIT) return { status: 429, error: 'Too many attempts. Wait 15 minutes and try again.' };
  let expected = '';
  try { expected = (await readFile(join(CONTROL, 'setup_code'), 'utf8')).trim().toUpperCase(); } catch { /* missing */ }
  const given = Buffer.from(String(code ?? '').trim().toUpperCase());
  const ok = expected && given.length === expected.length && crypto.timingSafeEqual(given, Buffer.from(expected));
  if (ok) { failures.delete(ip); return null; }
  const entry = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
  entry.count += 1;
  failures.set(ip, entry);
  return { status: 403, error: expected ? 'Setup code is incorrect.' : 'No setup code is available. Run sudo ./install.sh again.' };
}

// --- HTTP -------------------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  if (req.method === 'GET' && url.pathname === '/api/installer/state') {
    const status = await readJson('status.json');
    return send(res, 200, { state: status?.state ?? 'unknown', host: status?.host ?? null, helper: Boolean(status?.agent) });
  }
  if (req.method === 'GET' && url.pathname === '/api/installer/log') {
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    let text = '';
    let next = offset;
    try {
      const fh = await open(join(CONTROL, 'install.log'), 'r');
      try {
        const buf = Buffer.alloc(256 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
        text = buf.subarray(0, bytesRead).toString('utf8');
        next = offset + bytesRead;
      } finally { await fh.close(); }
    } catch { /* no log yet */ }
    const status = await readJson('status.json');
    return send(res, 200, { text, offset: next, state: status?.state ?? 'unknown' });
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found.' });

  const body = await readBody(req);
  const denied = await checkCode(ip, body.code);
  if (denied) return send(res, denied.status, { error: denied.error });

  if (url.pathname === '/api/installer/verify') return send(res, 200, { ok: true });

  if (url.pathname === '/api/installer/check-prefix') {
    if (!RE.prefix.test(String(body.prefix ?? ''))) return send(res, 200, { ok: false, error: 'Use a private range: 10.x, 172.16 to 172.31, or 192.168.' });
    const r = await helperRequest([`check-prefix=${body.prefix}`]);
    return send(res, 200, { ok: r.ok, error: r.error || null, overlaps: Array.isArray(r.overlaps) ? r.overlaps : [] });
  }

  if (url.pathname === '/api/installer/install') {
    const s = body.settings ?? {};
    const { errors, lans, names } = validateSettings(s);
    if (errors.length) return send(res, 400, { error: errors.join(' ') });
    const r = await helperRequest([
      'install=start', `lan=${lans.join(',')}`, `names=${names.join(',')}`, `prefix=${s.prefix}`,
      `firewall=${s.firewall}`, `acme=${s.acme}`, `updates=${s.updates}`,
      `proxy=${s.proxy}`, ...(s.proxy === 'external' ? [`proxy-ip=${s.proxyIp}`] : []),
    ]);
    return send(res, r.ok ? 202 : 400, r.ok ? { ok: true } : { error: r.error || 'The server refused the settings.' });
  }
  return send(res, 404, { error: 'Not found.' });
}

async function staticFile(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  const type = TYPES[extname(file)];
  if (!file.startsWith(PUBLIC) || !type) return send(res, 200, await readFile(join(PUBLIC, 'index.html')), TYPES['.html']);
  try {
    return send(res, 200, await readFile(file), type);
  } catch {
    return send(res, 200, await readFile(join(PUBLIC, 'index.html')), TYPES['.html']);
  }
}

const server = https.createServer({
  cert: await readFile(join(TLS_DIR, 'cert.pem')),
  key: await readFile(join(TLS_DIR, 'key.pem')),
}, async (req, res) => {
  const url = new URL(req.url, 'https://installer');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/ca.crt') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="it-manager-ca.crt"' });
      return res.end(await readFile(join(TLS_DIR, 'ca.crt')));
    }
    return await staticFile(res, url.pathname);
  } catch (err) {
    if (!res.headersSent) send(res, err.status ?? 500, { error: err.status ? err.message : 'Internal error.' });
    else res.end();
  }
});

server.listen(PORT, async () => {
  let code = '';
  try { code = (await readFile(join(CONTROL, 'setup_code'), 'utf8')).trim(); } catch { /* none */ }
  const line = '='.repeat(64);
  console.log([line, ' Setup wizard: open https://<server> in a browser.', code ? ` SETUP CODE: ${code}` : ' No setup code found.', line].join('\n'));
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
