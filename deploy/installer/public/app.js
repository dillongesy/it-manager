// Setup wizard client: verify → network → security → review → install (live log),
// then hand over to the Portal's own setup at /setup.
const $ = (sel) => document.querySelector(sel);
const STEPS = ['verify', 'network', 'security', 'review', 'install'];
const CODE_KEY = 'app-setup-code';   // read by the Portal's setup page to skip re-entering it
const settings = {};
let code = sessionStorage.getItem(CODE_KEY) || '';
let host = null;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function show(step) {
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== step;
  const at = STEPS.indexOf(step);
  for (const li of document.querySelectorAll('#steps li')) {
    const i = STEPS.indexOf(li.dataset.step);
    li.className = i < at ? 'done' : i === at ? 'active' : '';
  }
  const first = document.querySelector(`[data-panel="${step}"] input:not([type=radio]), [data-panel="${step}"] button.primary`);
  first?.focus();
}

function setError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

// --- 1. Verify ---------------------------------------------------------------------

$('#verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  code = $('#code').value.trim().toUpperCase();
  try {
    await api('/api/installer/verify', {});
    sessionStorage.setItem(CODE_KEY, code);
    setError($('#verify-error'), '');
    show('network');
    checkPrefix();
  } catch (err) {
    setError($('#verify-error'), err.message);
  }
});

// --- 2. Network --------------------------------------------------------------------

let prefixCheck = 0;
async function checkPrefix() {
  const status = $('#prefix-status');
  const prefix = $('#prefix').value.trim();
  const mine = ++prefixCheck;
  status.className = 'status';
  status.textContent = 'Checking…';
  try {
    const r = await api('/api/installer/check-prefix', { prefix });
    if (mine !== prefixCheck) return false;
    if (!r.ok) { status.className = 'status bad'; status.textContent = r.error; return false; }
    if (r.overlaps.length) {
      status.className = 'status bad';
      status.textContent = `Overlaps networks on this server: ${r.overlaps.join('; ')}. Choose another prefix.`;
      return false;
    }
    status.className = 'status good';
    status.textContent = `${prefix}.0.0 – ${prefix}.8.255 is free on this server.`;
    return true;
  } catch (err) {
    if (mine === prefixCheck) { status.className = 'status bad'; status.textContent = err.message; }
    return false;
  }
}
$('#prefix').addEventListener('change', checkPrefix);

$('#network-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await checkPrefix())) return;
  settings.lanCidr = $('#lan').value.trim();
  settings.names = $('#names').value.trim();
  settings.prefix = $('#prefix').value.trim();
  show('security');
});

// --- 3. Security and updates ---------------------------------------------------------

for (let h = 0; h < 24; h++) {
  const hh = String(h).padStart(2, '0');
  $('#update-hour').append(new Option(`${hh}:00`, hh, h === 2, h === 2));
}
function syncUpdateFields() {
  const f = $('#update-frequency').value;
  $('#update-day').hidden = f !== 'weekly';
  $('#update-hour').hidden = f === 'off';
}
$('#update-frequency').addEventListener('change', syncUpdateFields);
syncUpdateFields();

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
function syncProxyFields() {
  const external = document.querySelector('input[name=proxy]:checked').value === 'external';
  $('#proxy-ip-field').hidden = !external;
  $('#acme-fieldset').hidden = external;
}
document.querySelectorAll('input[name=proxy]').forEach(r => r.addEventListener('change', syncProxyFields));
syncProxyFields();

$('#security-form').addEventListener('submit', (e) => {
  e.preventDefault();
  settings.firewall = document.querySelector('input[name=firewall]:checked').value;
  settings.proxy = document.querySelector('input[name=proxy]:checked').value;
  settings.proxyIp = settings.proxy === 'external' ? $('#proxy-ip').value.trim() : '';
  if (settings.proxy === 'external' && !IPV4.test(settings.proxyIp)) {
    setError($('#proxy-ip-status'), 'Enter the IP address of your reverse proxy, such as 192.168.1.20.');
    return;
  }
  setError($('#proxy-ip-status'), '');
  settings.acme = settings.proxy === 'external' ? 'dns' : document.querySelector('input[name=acme]:checked').value;
  const f = $('#update-frequency').value;
  const hour = $('#update-hour').value;
  settings.updates = f === 'off' ? 'off' : f === 'daily' ? `daily:${hour}` : `weekly:${$('#update-day').value}:${hour}`;
  renderReview();
  show('review');
});

// --- 4. Review ---------------------------------------------------------------------

function describeUpdates(preset) {
  const [f, a, b] = preset.split(':');
  if (f === 'off') return 'Off';
  return f === 'daily' ? `Every day at ${a}:00` : `Every ${DAY_NAMES[a]} at ${b}:00`;
}

function renderReview() {
  const ip = host?.ip ?? 'this server';
  const rows = [
    ['Portal address', `https://${ip}${settings.names ? ` and ${settings.names.split(/[\s,]+/).filter(Boolean).map(n => `https://${n}`).join(', ')}` : ''}`],
    ['Office network', settings.lanCidr],
    ['Container networks', `${settings.prefix}.0.0 – ${settings.prefix}.9.255`],
    ['Field App in the office', `https://${ip}:4433 (office network only)`],
    ['Firewall hardening', settings.firewall === 'on' ? 'On' : 'Off'],
    ['Field App publishing', settings.proxy === 'external' ? `Your reverse proxy at ${settings.proxyIp}` : 'Included Nginx Proxy Manager'],
    ...(settings.proxy === 'external' ? [] : [['Field App certificate', settings.acme === 'dns' ? 'DNS validation (port 443 only)' : 'HTTP validation (ports 443 and 80)']]),
    ['Automatic updates', describeUpdates(settings.updates)],
    ['Backups', 'Every day at 01:00, before the updates, on this server. Choose a network share in Admin → Backups after setup.'],
  ];
  const dl = $('#summary');
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
  const note = $('#router-note');
  note.replaceChildren();
  const h = document.createElement('strong');
  const ul = document.createElement('ul');
  let items;
  if (settings.proxy === 'external') {
    h.textContent = 'Later, in your reverse proxy (to publish the Field App):';
    items = [
      `Add a host for the Field App's domain that forwards to http://${ip}:4480.`,
      'Keep your router forwarding to your reverse proxy, as it does now. Do not forward anything to this server.',
    ];
  } else {
    h.textContent = 'Later, on your router (to publish the Field App):';
    items = [`Forward external TCP port 443 to ${ip} port 4443.`];
    if (settings.acme === 'http') items.push(`Forward external TCP port 80 to ${ip} port 80.`);
    items.push('Do not forward any other port.');
  }
  for (const t of items) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
  note.append(h, ul);
}

$('#install-button').addEventListener('click', async () => {
  $('#install-button').disabled = true;
  try {
    await api('/api/installer/install', { settings });
    setError($('#install-error'), '');
    show('install');
    followLog();
  } catch (err) {
    setError($('#install-error'), err.message);
    $('#install-button').disabled = false;
  }
});

// --- 5. Install --------------------------------------------------------------------

// The host helper marks each stage with a line "==> STEP n/total: Label", and finishes
// with "==> DONE" or "==> FAILED: reason".
const progress = new Map();
function renderProgress(current, failed) {
  const ul = $('#progress');
  ul.replaceChildren(...[...progress.entries()].map(([n, label]) => {
    const li = document.createElement('li');
    li.textContent = label;
    li.className = n < current ? 'done' : n === current ? (failed ? 'failed' : 'active') : '';
    return li;
  }));
}

let offset = 0;
let current = 0;
let finished = false;
let lostContact = 0;

function appendLog(text) {
  const pre = $('#log');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.append(text);
  if (atBottom) pre.scrollTop = pre.scrollHeight;
  for (const line of text.split('\n')) {
    const step = /^==> STEP (\d+)\/(\d+): (.+)$/.exec(line);
    if (step) {
      current = Number(step[1]);
      progress.set(current, step[3]);
      renderProgress(current, false);
    } else if (line.startsWith('==> DONE')) {
      finished = true;
      renderProgress(Infinity, false);
    } else if (line.startsWith('==> FAILED')) {
      finished = true;
      renderProgress(current, true);
      $('#install-status').className = 'status bad';
      $('#install-status').textContent = `${line.slice(4)}. The log above shows what happened. Fix the cause and run sudo ./install.sh on the server to try again.`;
    }
  }
}

async function portalReady() {
  try {
    const res = await fetch('/api/setup/status', { cache: 'no-store' });
    return res.ok && (await res.json()).needsSetup !== undefined;
  } catch {
    return false;
  }
}

async function followLog() {
  while (true) {
    try {
      const r = await api(`/api/installer/log?offset=${offset}`);
      lostContact = 0;
      if (r.text) appendLog(r.text);
      offset = r.offset;
      if (r.state === 'failed' && !finished) appendLog('==> FAILED: The installation stopped\n');
    } catch {
      // The installer stops when the Portal takes over its address.
      lostContact += 1;
      if (await portalReady()) return handOver();
      $('#install-status').className = 'status';
      $('#install-status').textContent = 'Starting the Portal…';
      if (lostContact > 120) {
        $('#install-status').className = 'status bad';
        $('#install-status').textContent = 'The Portal has not started. On the server, check: docker compose ps';
        return;
      }
    }
    await new Promise(res => setTimeout(res, 1000));
  }
}

function handOver() {
  renderProgress(Infinity, false);
  $('#install-status').className = 'status good';
  $('#install-status').textContent = 'Installed. The Portal setup continues with your company and first admin account.';
  $('#continue-actions').hidden = false;
  setTimeout(() => { window.location.assign('/setup'); }, 3000);
}

// --- Start -------------------------------------------------------------------------

(async () => {
  let state;
  try {
    state = await api('/api/installer/state');
  } catch {
    if (await portalReady()) return window.location.assign('/setup');
    document.body.textContent = 'The setup wizard could not reach the server. Reload the page.';
    return;
  }
  host = state.host;
  $('#portal-url').textContent = `https://${host?.ip ?? '<server>'}`;
  $('#lan').value = host?.lanCidr ?? '';
  $('#lan-detected').textContent = host?.lanCidr ?? 'unknown';
  $('#prefix').value = host?.prefix ?? '172.29';
  if (!state.helper) {
    document.body.textContent = 'The host helper is not running. Run sudo ./install.sh on the server again.';
    return;
  }
  if (state.state === 'installing' || state.state === 'installed' || state.state === 'failed') {
    show('install');
    followLog();
    return;
  }
  if (code) $('#code').value = code;
  show('verify');
})();
