import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import * as unifi from '../lib/unifi-client.js';
import {
  hostOf, deviceOf, deviceFields, wanFrom, vlansFrom, internalIpsFrom, rulesFrom,
  planDevice, findDeviceMatch, mergeVlans, mergeRules,
  cameraFields, planCamera, findCameraMatch, systemFields, planSystem, findSystemMatch,
  WIFI_SECTION, wifiCredential, findWifiMatch, planWifi,
  vpnsFrom, clientsFrom, groupClients, clientFields, clientInsertFields, vpnCredentials,
} from '../lib/unifi.js';
import { ensureDeviceType } from './customer-devices.js';
import { ensureSection } from './customer-credentials.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';
import { saveLink, linksFor, customersLinkedTo } from '../lib/integration-links.js';
import { columnsFor, changesFor } from '../lib/sync-merge.js';

// UniFi → a customer's Devices and Cameras tabs.
//
//   GET  /api/unifi/consoles                                 — every console the account sees
//   GET  /api/customers/:customerId/unifi/preview?hostId=&siteId=&cameraSystemId=
//                                       — what an import of that console would do
//   POST /api/customers/:customerId/unifi/import             — create new / update matched
//
// Read-only against UniFi. Mapping and merge rules: lib/unifi.js.

const NOT_CONFIGURED = {
  error: 'UniFi is not configured. An admin can set it up in Admin → Integrations.',
  configured: false,
};

function sendError(res, next, err) {
  if (err instanceof unifi.UnifiError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

const deviceName = (d) => d.label || d.computer_name || d.model || 'Unnamed device';
const toDb = (v) => (Array.isArray(v) ? JSON.stringify(v) : v);

// A matched record's preview: what the import adds (changes — applied), and what it keeps
// that UniFi reports differently (differs — applied only with take_newer). lib/sync-merge.js
const matched = (key, target, reason, plan) => ({
  action: plan.changes.length ? 'update' : 'unchanged', [key]: target, reason,
  changes: plan.changes, differs: plan.differs, updates: plan.updates, newer: plan.newer,
});
// At import time: fold the differences in when the person asked for them.
const settle = (preview, takeNewer) => {
  if (!preview?.newer) return;
  preview.updates = columnsFor(preview, takeNewer);
  preview.changes = changesFor(preview, takeNewer);
};
const SHARED_NOTE = 'This console is shared with your UniFi account rather than owned by it, so UniFi only provides its device list — '
  + 'WAN settings, VLANs, firewall rules and WiFi passwords need your account to own the console.';

// ─── Global: consoles ─────────────────────────────────────────────────────────

export const unifiRouter = Router();

unifiRouter.get('/consoles', requireAuth, async (req, res, next) => {
  if (!unifi.isUnifiConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const refresh = req.query.refresh === '1';
    const [hosts, groups, linked] = await Promise.all([unifi.hosts({ refresh }), unifi.deviceGroups({ refresh }), customersLinkedTo('unifi')]);
    const counts = new Map(groups.map(g => {
      const devs = (g.devices ?? []).map(d => deviceOf(d));
      return [g.hostId, { devices: devs.filter(d => d.portal_type).length, cameras: devs.filter(d => d.kind === 'camera').length }];
    }));
    const consoles = hosts.map(hostOf).filter(h => h.id).map(({ wans, ...h }) => ({
      ...h,
      device_count: counts.get(h.id)?.devices ?? 0,
      camera_count: counts.get(h.id)?.cameras ?? 0,
      linked: linked.get(h.id) ?? [],
    }));
    consoles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    res.json({ consoles });
  } catch (err) { sendError(res, next, err); }
});

// ─── Per customer: preview + import ───────────────────────────────────────────

async function loadCustomer(customerId) {
  const [{ rows: devices }, { rows: systems }, { rows: credentials }] = await Promise.all([
    query('SELECT * FROM customer_devices WHERE customer_id = $1 ORDER BY sort_order, created_at', [customerId]),
    query('SELECT * FROM customer_camera_systems WHERE customer_id = $1 ORDER BY label', [customerId]),
    query(`SELECT id, category, label, password_enc, extra_notes, custom_fields, unifi_wifi_id, location_id
             FROM customer_credentials WHERE customer_id = $1`, [customerId]),
  ]);
  const { rows: cameras } = systems.length
    ? await query('SELECT * FROM customer_cameras WHERE camera_system_id = ANY($1::uuid[]) ORDER BY sort_order, name', [systems.map(s => s.id)])
    : { rows: [] };
  for (const c of credentials) c.has_password = hasValue(c.password_enc);
  return { devices, systems, cameras, credentials };
}

/**
 * Everything an import of one console would do. Shared by preview and import so both
 * walk the devices in the same order with the same "claimed" set.
 */
async function buildPlan(customerId, { hostId, siteId, cameraSystemId, refresh = false }) {
  const [hosts, groups, portal] = await Promise.all([
    unifi.hosts({ refresh }), unifi.deviceGroups({ refresh }), loadCustomer(customerId),
  ]);
  const rawHost = hosts.find(h => h.id === hostId);
  if (!rawHost) throw new unifi.UnifiError('That console is no longer on your UniFi account.', 404);
  const host = hostOf(rawHost);
  const all = ((groups.find(g => g.hostId === hostId)?.devices) ?? []).map(d => deviceOf(d, host));

  // WAN / VLANs / firewall rules — only on consoles the account owns, running Network.
  let net = null;
  let limited = null;
  if (!host.owner) limited = SHARED_NOTE;
  else if (!host.network) limited = 'This console isn\'t running the UniFi Network app, so there are no WAN, VLAN or firewall settings to read.';
  else if (!host.online) limited = 'This console is offline, so only its last-known device list is available.';
  else {
    try {
      net = await unifi.consoleNetwork(hostId, siteId || null, { refresh });
    } catch (e) {
      if (!(e instanceof unifi.UnifiError)) throw e;
      limited = e.code === 'not_owner' ? SHARED_NOTE : e.message;
    }
  }

  // A console hosting several Network sites (a self-hosted Cloud Key): only this site's gear.
  let gear = all.filter(d => d.portal_type);
  if (net?.sites?.length > 1 && net.device_macs.length) gear = gear.filter(d => net.device_macs.includes(d.serial));
  // Each switch / AP's own LAN setting — DHCP or static (a gateway's is its WAN, so not shown).
  gear = gear.map(d => ({ ...d, ip_assignment: d.kind === 'gateway' ? null : (net?.device_ip_modes?.[d.serial] ?? null) }));

  const extras = net ? {
    ...wanFrom(net.networkconf, host),
    internal_ips: internalIpsFrom(net.networks),
    vlans: vlansFrom(net.networks, net.wifi),
    firewall_rules: rulesFrom({ policies: net.policies, zones: net.zones, networks: net.networks, legacy: net.legacy, forwards: net.forwards }),
    vpns: vpnsFrom(net.networkconf, net.vpn_users),
  } : {};
  // The WAN/VLAN/rules belong on the gateway — the console itself when it's the gateway.
  const gatewayKey = (gear.find(d => d.kind === 'gateway' && d.console) ?? gear.find(d => d.kind === 'gateway'))?.key;

  const claimed = new Set();
  const devices = gear.map(dev => {
    const fields = deviceFields(dev, dev.key === gatewayKey ? extras : {});
    const match = findDeviceMatch(dev, portal.devices, claimed);
    let preview = { action: 'create', device: null, reason: null, changes: [] };
    if (match.device) {
      claimed.add(match.device.id);
      preview = matched('device', { id: match.device.id, name: deviceName(match.device), location_id: match.device.location_id }, match.reason, planDevice(match.device, fields));
    } else if (match.ambiguous) {
      preview = { action: 'ambiguous', device: null, reason: null, changes: [], candidates: match.ambiguous.map(d => ({ id: d.id, name: deviceName(d) })) };
    }
    return { ...dev, fields, preview, gateway: dev.key === gatewayKey };
  });

  // Clients — printers, servers, other gear plugged into the network. Bloat (phones, TVs,
  // smart gadgets, cameras) and UniFi's own devices come back flagged hidden and can't be
  // imported; the rest share the devices' claimed set so nothing is matched twice.
  // One machine's wired and Wi-Fi entries are folded into one row first (groupClients),
  // and merged like everything else: blanks filled, MACs and a notes line added.
  const unifiMacs = new Set(all.map(d => d.serial));
  const clients = net ? groupClients(clientsFrom(net.clients_online, net.clients_known, net.networks)
    .filter(c => c.key && !unifiMacs.has(c.key)), portal.devices)
    .map(c => {
      if (!c.portal_type) return { ...c, preview: null };
      const fields = clientFields(c);
      const match = findDeviceMatch({ key: c.key, mac: c.mac, macs: c.macs, names: c.names }, portal.devices, claimed);
      let preview = { action: 'create', device: null, reason: null, changes: [] };
      if (match.device) {
        claimed.add(match.device.id);
        preview = matched('device', { id: match.device.id, name: deviceName(match.device), location_id: match.device.location_id }, match.reason, planDevice(match.device, fields));
      } else if (match.ambiguous) {
        preview = { action: 'ambiguous', device: null, reason: null, changes: [], candidates: match.ambiguous.map(d => ({ id: d.id, name: deviceName(d) })) };
      }
      return { ...c, fields, preview };
    }) : null;

  // Protect cameras → the Cameras tab, under one camera system for this console.
  const cams = all.filter(d => d.kind === 'camera');
  let cameras = null;
  if (cams.length) {
    const consoleDev = all.find(d => d.console);
    const sysFields = systemFields(host, consoleDev);
    let target = null;
    let reason = null;
    if (cameraSystemId && cameraSystemId !== 'new') {
      target = portal.systems.find(s => s.id === cameraSystemId) ?? null;
      reason = target ? 'chosen' : null;
    } else if (!cameraSystemId) {
      ({ system: target, reason } = findSystemMatch(host, portal.systems));
    }
    const sysPlan = target ? planSystem(target, sysFields) : { updates: {}, changes: [], newer: {}, differs: [] };
    const existing = target ? portal.cameras.filter(c => c.camera_system_id === target.id) : [];
    const camClaimed = new Set();
    const items = cams.map(dev => {
      const fields = cameraFields(dev);
      const match = findCameraMatch(dev, existing, camClaimed);
      let preview = { action: 'create', camera: null, reason: null, changes: [] };
      if (match.camera) {
        camClaimed.add(match.camera.id);
        preview = matched('camera', { id: match.camera.id, name: match.camera.name || 'Camera' }, match.reason, planCamera(match.camera, fields));
      } else if (match.ambiguous) {
        preview = { action: 'ambiguous', camera: null, reason: null, changes: [], candidates: match.ambiguous.map(c => ({ id: c.id, name: c.name })) };
      }
      return { ...dev, fields, preview };
    });
    cameras = {
      system: {
        target: target ? { id: target.id, label: target.label || target.model || 'Camera system' } : null,
        reason,
        action: target ? (sysPlan.changes.length ? 'update' : 'unchanged') : 'create',
        changes: sysPlan.changes,
        differs: sysPlan.differs,
        updates: sysPlan.updates,
        newer: sysPlan.newer,
        fields: sysFields,
      },
      candidates: portal.systems.map(s => ({ id: s.id, label: s.label || s.model || 'Camera system' })),
      items,
    };
  }

  // WiFi networks and site-to-site VPN keys → Credentials, with their secrets. Read fresh
  // (never cached) and only ever held in `secret` below, which never leaves this server.
  let wifi = null;
  const notes = [...(net?.notes ?? [])];        // a copy: net is cached
  if (net?.site) {
    try {
      const wlans = await unifi.wifiWithPasswords(hostId, net.site.ref);
      let vpnKeys = [];
      try { vpnKeys = vpnCredentials(await unifi.vpnSecrets(hostId, net.site.ref)); }
      catch (e) { if (!(e instanceof unifi.UnifiError)) throw e; notes.push(`VPN keys: ${e.message}`); }
      const wifiClaimed = new Set();
      const secrets = [...wlans.map(w => ({ ...wifiCredential(w, net.networkconf), section: WIFI_SECTION })), ...vpnKeys];
      wifi = secrets.filter(w => w.key && w.label).map(w => {
        const { password, ppsk, ...shown } = w;
        const match = findWifiMatch(w, portal.credentials, wifiClaimed);
        let preview = { action: 'create', credential: null, reason: null, changes: [] };
        if (match.credential) {
          wifiClaimed.add(match.credential.id);
          const passwordMatches = !password || decrypt(match.credential.password_enc) === password;
          preview = matched('credential', { id: match.credential.id, name: match.credential.label, location_id: match.credential.location_id }, match.reason, planWifi(match.credential, w, { passwordMatches }));
        } else if (match.ambiguous) {
          preview = { action: 'ambiguous', credential: null, reason: null, changes: [], candidates: match.ambiguous.map(c => ({ id: c.id, name: `${c.label} (${c.category || 'General'})` })) };
        }
        return { ...shown, has_password: Boolean(password), ppsk_count: ppsk.length, preview, secret: { password, ppsk } };
      });
    } catch (e) {
      if (!(e instanceof unifi.UnifiError)) throw e;
      notes.push(`WiFi / VPN keys: ${e.message}`);
    }
  }

  return {
    host, net, limited, notes, devices, clients, cameras, wifi,
    skipped: all.filter(d => d.kind === 'protect_other').map(d => `${d.name} (${d.model})`),
    wan: extras.wans ?? [],
  };
}

// The preview without the internal `updates` maps (the client only needs the changes)
// and — for WiFi — without the passwords.
const publicRow = ({ preview, secret, ...row }) => {
  if (!preview) return { ...row, preview: null };            // a hidden client — nothing to import
  const { updates, newer, ...shown } = preview;
  return { ...row, preview: shown };
};

export const customerUnifiRouter = Router({ mergeParams: true });

customerUnifiRouter.get('/preview', requireAuth, async (req, res, next) => {
  if (!unifi.isUnifiConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { hostId, siteId, cameraSystemId } = req.query;
    if (!hostId) return res.status(400).json({ error: 'hostId is required.' });
    const plan = await buildPlan(req.params.customerId, { hostId, siteId, cameraSystemId, refresh: req.query.refresh === '1' });
    const { wans, ...consoleInfo } = plan.host;
    res.json({
      console: consoleInfo,
      sites: plan.net?.sites ?? [],
      site: plan.net?.site ?? null,
      limited: plan.limited,
      notes: plan.notes,
      wan: plan.wan,
      devices: plan.devices.map(publicRow),
      clients: plan.clients && plan.clients.map(publicRow),
      cameras: plan.cameras && {
        ...plan.cameras,
        system: (({ updates, newer, ...s }) => s)(plan.cameras.system),
        items: plan.cameras.items.map(publicRow),
      },
      wifi: plan.wifi && plan.wifi.map(publicRow),
      skipped: plan.skipped,
      links: await linksFor(req.params.customerId, 'unifi'),
    });
  } catch (err) { sendError(res, next, err); }
});

customerUnifiRouter.post('/import', requireAuth, async (req, res, next) => {
  if (!unifi.isUnifiConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { customerId } = req.params;
    const { hostId, siteId } = req.body ?? {};
    const deviceKeys = new Set(Array.isArray(req.body?.device_keys) ? req.body.device_keys.map(String) : []);
    const cameraKeys = new Set(Array.isArray(req.body?.camera_keys) ? req.body.camera_keys.map(String) : []);
    const cameraSystemId = req.body?.camera_system_id || null;       // null = automatic, 'new', or a system id
    const locationId = req.body?.location_id || null;
    // Also move records already on file into that office (otherwise only new ones go there).
    const moveExisting = req.body?.move_existing === true;
    // Also replace values UniFi reports differently (otherwise only blanks and new items).
    const takeNewer = req.body?.take_newer === true;
    if (!hostId) return res.status(400).json({ error: 'hostId is required.' });
    const wifiKeys = new Set(Array.isArray(req.body?.wifi_keys) ? req.body.wifi_keys.map(String) : []);
    const clientKeys = new Set(Array.isArray(req.body?.client_keys) ? req.body.client_keys.map(String) : []);
    if (!deviceKeys.size && !cameraKeys.size && !wifiKeys.size && !clientKeys.size) return res.status(400).json({ error: 'Pick at least one device, client, camera or WiFi network to import.' });

    const { rows: cust } = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!cust[0]) return res.status(404).json({ error: 'Customer not found.' });

    const plan = await buildPlan(customerId, { hostId, siteId, cameraSystemId });
    for (const r of [...plan.devices, ...(plan.clients ?? []), ...(plan.cameras?.items ?? []), ...(plan.wifi ?? [])]) settle(r.preview, takeNewer);
    if (plan.cameras) settle(plan.cameras.system, takeNewer);
    const result = {
      created: [], updated: [], unchanged: [], skipped: [], failed: [],
      cameras: { system: null, created: [], updated: [], unchanged: [], skipped: [], failed: [] },
      wifi: { created: [], updated: [], unchanged: [], skipped: [], failed: [] },
    };
    const audit = (action, entityType, entityId, entityName, changes) => logAudit({
      userId: req.user.sub, userName: req.user.fullName, action, entityType, entityId, entityName, changes, ipAddress: getClientIp(req) });
    const link = { unifi_host_id: hostId, unifi_synced_at: new Date() };
    // Moving a matched record into the chosen office, when asked — recorded as a change like any other.
    const officeMove = (current) => (moveExisting && (current ?? null) !== locationId
      ? { set: { location_id: locationId }, change: { field: 'location_id', from: current ?? 'main office', to: locationId ?? 'main office', mode: 'update' } }
      : null);

    // ── Devices, then the clients picked (both become Devices-tab records) ──
    const rows = [
      ...plan.devices.filter(r => deviceKeys.has(r.key)),
      ...(plan.clients ?? []).filter(r => clientKeys.has(r.key) && r.portal_type && r.preview),
    ];
    for (const row of rows) {
      const p = row.preview;
      try {
        if (p.action === 'ambiguous') {
          result.skipped.push({ key: row.key, name: row.name, reason: `${p.candidates.length} devices here are named "${row.name}" — rename one, or add its MAC, then try again` });
          continue;
        }
        if (p.device) {
          const move = officeMove(p.device.location_id);
          const set = { ...p.updates, ...link, unifi_device_id: row.key, ...(move?.set ?? {}) };
          if (move) p.changes = [...p.changes, move.change];
          if (p.changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          await query(
            `UPDATE customer_devices SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND customer_id = $2`,
            [p.device.id, customerId, ...cols.map(c => toDb(set[c]))]
          );
          if (p.changes.length) {
            await audit('UPDATE', 'device', p.device.id, `${p.device.name} — updated from UniFi (${p.reason})`,
              Object.fromEntries(p.changes.map(c => [c.field, { from: c.from, to: c.to }])));
            result.updated.push({ key: row.key, name: row.name, device: p.device.name, changes: p.changes });
          } else {
            result.unchanged.push({ key: row.key, name: row.name, device: p.device.name });
          }
          continue;
        }
        // New device. Lists go through the same merge an update would, so VLANs get IDs.
        const f = row.macs ? clientInsertFields(row.fields) : { ...row.fields };
        if (f.vlans) f.vlans = mergeVlans([], f.vlans).vlans;
        if (f.firewall_rules) f.firewall_rules = mergeRules([], f.firewall_rules);
        const insert = Object.fromEntries(Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : v != null && v !== '')));
        Object.assign(insert, link, {
          customer_id: customerId, location_id: locationId, created_by: req.user.sub, unifi_device_id: row.key,
        });
        await ensureDeviceType(customerId, insert.device_type);
        const { rows: max } = await query(
          'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_devices WHERE customer_id = $1 AND device_type = $2',
          [customerId, insert.device_type]);
        insert.sort_order = max[0].next;
        const cols = Object.keys(insert);
        const { rows: ins } = await query(
          `INSERT INTO customer_devices (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, label, model, device_type`,
          cols.map(c => toDb(insert[c])));
        await audit('CREATE', 'device', ins[0].id, `${deviceName(ins[0])} — imported from UniFi`);
        result.created.push({ key: row.key, name: row.name, device: deviceName(ins[0]), device_type: ins[0].device_type });
      } catch (e) {
        result.failed.push({ key: row.key, name: row.name, error: e.message });
      }
    }

    // ── Cameras ──
    const picked = plan.cameras ? plan.cameras.items.filter(c => cameraKeys.has(c.key)) : [];
    if (picked.length) {
      const sys = plan.cameras.system;
      let systemId = sys.target?.id ?? null;
      try {
        if (!systemId) {
          const f = sys.fields;
          const { rows } = await query(
            `INSERT INTO customer_camera_systems (customer_id, label, system_type, model, serial_number, ip_address, location_id, unifi_host_id, unifi_synced_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id, label`,
            [customerId, f.label, f.system_type, f.model || null, f.serial_number || null, f.ip_address || null, locationId, hostId]);
          systemId = rows[0].id;
          await audit('CREATE', 'camera_system', systemId, `${rows[0].label} — imported from UniFi Protect`);
          result.cameras.system = { action: 'created', label: rows[0].label };
        } else {
          const set = { ...sys.updates, ...link };
          if (sys.changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          await query(
            `UPDATE customer_camera_systems SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND customer_id = $2`,
            [systemId, customerId, ...cols.map(c => set[c])]);
          if (sys.changes.length) {
            await audit('UPDATE', 'camera_system', systemId, `${sys.target.label} — updated from UniFi Protect`,
              Object.fromEntries(sys.changes.map(c => [c.field, { from: c.from, to: c.to }])));
          }
          result.cameras.system = { action: sys.changes.length ? 'updated' : 'unchanged', label: sys.target.label };
        }
      } catch (e) {
        result.cameras.failed.push({ name: 'Camera system', error: e.message });
        systemId = null;
      }

      for (const cam of systemId ? picked : []) {
        const p = cam.preview;
        try {
          if (p.action === 'ambiguous') {
            result.cameras.skipped.push({ key: cam.key, name: cam.name, reason: `${p.candidates.length} cameras on this system are named "${cam.name}"` });
            continue;
          }
          if (p.camera) {
            const set = { ...p.updates, unifi_device_id: cam.key, unifi_synced_at: new Date() };
            if (p.changes.length) set.updated_at = new Date();
            const cols = Object.keys(set);
            await query(
              `UPDATE customer_cameras SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND camera_system_id = $2`,
              [p.camera.id, systemId, ...cols.map(c => set[c])]);
            if (p.changes.length) {
              await audit('UPDATE', 'camera', p.camera.id, `${p.camera.name} — updated from UniFi Protect`,
                Object.fromEntries(p.changes.map(c => [c.field, { from: c.from, to: c.to }])));
              result.cameras.updated.push({ key: cam.key, name: cam.name, changes: p.changes });
            } else {
              result.cameras.unchanged.push({ key: cam.key, name: cam.name });
            }
            continue;
          }
          const insert = Object.fromEntries(Object.entries(cam.fields).filter(([, v]) => v != null && v !== ''));
          Object.assign(insert, { camera_system_id: systemId, unifi_device_id: cam.key, unifi_synced_at: new Date() });
          const { rows: max } = await query('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_cameras WHERE camera_system_id = $1', [systemId]);
          insert.sort_order = max[0].next;
          const cols = Object.keys(insert);
          const { rows: ins } = await query(
            `INSERT INTO customer_cameras (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, name`,
            cols.map(c => insert[c]));
          await audit('CREATE', 'camera', ins[0].id, `${ins[0].name || 'Camera'} — imported from UniFi Protect`);
          result.cameras.created.push({ key: cam.key, name: cam.name });
        } catch (e) {
          result.cameras.failed.push({ key: cam.key, name: cam.name, error: e.message });
        }
      }
    }

    // ── WiFi networks + VPN keys → Credentials (secrets encrypted before they're stored) ──
    const pickedWifi = (plan.wifi ?? []).filter(w => wifiKeys.has(w.key));
    for (const section of new Set(pickedWifi.map(w => w.section || WIFI_SECTION))) await ensureSection(customerId, section);
    for (const w of pickedWifi) {
      const p = w.preview;
      const section = w.section || WIFI_SECTION;
      const what = section === WIFI_SECTION ? 'WiFi' : 'VPN key';
      try {
        if (p.action === 'ambiguous') {
          result.wifi.skipped.push({ key: w.key, name: w.label, reason: `${p.candidates.length} credentials are called "${w.label}" — rename one, then try again` });
          continue;
        }
        if (p.credential) {
          const u = p.updates;
          const set = { unifi_wifi_id: w.key };
          if (u.password) set.password_enc = encrypt(u.password);
          if (u.label) set.label = u.label;
          if (u.extra_notes) set.extra_notes = u.extra_notes;
          const move = officeMove(p.credential.location_id);
          if (move) { set.location_id = locationId; p.changes = [...p.changes, move.change]; }
          if (p.changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          await query(
            `UPDATE customer_credentials SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE id = $1 AND customer_id = $2`,
            [p.credential.id, customerId, ...cols.map(c => set[c])]);
          if (p.changes.length) {
            // The audit says the password changed — never what it is.
            await audit('UPDATE', 'credential', p.credential.id, `${p.credential.name} — ${what} updated from UniFi`,
              Object.fromEntries(p.changes.map(c => [c.field, c.field === 'password' ? { changed: true } : { from: c.from, to: c.to }])));
            result.wifi.updated.push({ key: w.key, name: w.label, changes: p.changes });
          } else {
            result.wifi.unchanged.push({ key: w.key, name: w.label });
          }
          continue;
        }
        const { rows: max } = await query(
          'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_credentials WHERE customer_id = $1 AND category = $2',
          [customerId, section]);
        const custom = w.secret.ppsk.map(k => ({ label: k.label, secret: true, value: encrypt(k.value) }));
        const { rows: ins } = await query(
          `INSERT INTO customer_credentials (customer_id, category, label, password_enc, extra_notes, custom_fields, location_id, sort_order, created_by, unifi_wifi_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [customerId, section, w.label, encrypt(w.secret.password), w.notes || null, JSON.stringify(custom), locationId, max[0].next, req.user.sub, w.key]);
        await audit('CREATE', 'credential', ins[0].id, `${w.label} — ${what} imported from UniFi`);
        result.wifi.created.push({ key: w.key, name: w.label });
      } catch (e) {
        result.wifi.failed.push({ key: w.key, name: w.label, error: e.message });
      }
    }

    await saveLink({ customerId, provider: 'unifi', externalId: hostId, externalName: plan.host.name, locationId, userId: req.user.sub });
    res.json(result);
  } catch (err) { sendError(res, next, err); }
});
