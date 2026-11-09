import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import * as cw from '../lib/connectwise-client.js';
import {
  companyOf, siteOf, sortByName, normalizeEndpoint, flattenDevice, deviceTypeFor,
  deviceFieldsFromMachine, mergePlan, findMatch,
} from '../lib/connectwise.js';
import { columnsFor, changesFor } from '../lib/sync-merge.js';
import { ensureDeviceType } from './customer-devices.js';
import * as dell from '../lib/dell-client.js';
import { isDell, isValidServiceTag, normalizeTag, warrantyFromAsset } from '../lib/dell.js';
import { saveLink } from '../lib/integration-links.js';

// ConnectWise RMM → customer Devices tab import.
//
//   GET  /api/connectwise/status                                  — configured?
//   GET  /api/connectwise/companies                               — RMM companies
//   GET  /api/connectwise/companies/:companyId/sites              — a company's sites
//   GET  /api/customers/:customerId/connectwise/machines?companyId=&siteId=
//                                          — one site's devices + what an import would do
//   POST /api/customers/:customerId/connectwise/import             — create new / update matched
//
// Read-only against ConnectWise. See lib/connectwise.js for how a device maps onto
// Portal fields and how it's matched to a device that's already on file.
//
// Dell machines also get their warranty from Dell (when DELL_CLIENT_ID is set), so it
// shows in the preview and lands with the rest of the import.

const NOT_CONFIGURED = {
  error: 'ConnectWise RMM is not configured. An admin can set it up in Admin → Integrations.',
  configured: false,
};

const loadDevices = async (customerId) =>
  (await query('SELECT * FROM customer_devices WHERE customer_id = $1 ORDER BY sort_order, created_at', [customerId])).rows;

const deviceName = (d) => d.label || d.computer_name || d.model || 'Unnamed device';

// JSONB columns (storage_drives) go to Postgres as JSON text; node-pg would otherwise
// send a JS array as a Postgres array literal.
const toDb = (v) => (Array.isArray(v) ? JSON.stringify(v) : v);

function sendError(res, next, err) {
  if (err instanceof cw.ConnectWiseError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

async function siteContext(companyId, siteId) {
  const [companies, sites] = await Promise.all([cw.companies(), cw.sites(companyId)]);
  const company = companies.map(companyOf).find(c => c.id === String(companyId));
  const site = sites.map(siteOf).find(s => s.id === String(siteId));
  return { companyId, siteId, companyName: company?.name ?? '', siteName: site?.name ?? '' };
}

// Dell warranty for the Dell machines in a list, written onto each machine record
// (warranty_expires / warranty_coverage). Best effort: a Dell failure leaves warranties
// alone and returns a note saying why, rather than failing the import.
async function addDellWarranty(machines) {
  if (!dell.isDellConfigured()) return null;
  const dells = machines.filter(m => isDell(m) && isValidServiceTag(m.serial));
  if (!dells.length) return null;
  try {
    const found = await dell.lookup(dells.map(m => m.serial));
    for (const m of dells) {
      const asset = found.get(normalizeTag(m.serial));
      const w = asset ? warrantyFromAsset(asset) : null;
      if (w?.expires) { m.warranty_expires = w.expires; m.warranty_coverage = w.coverage; }
    }
    return null;
  } catch (e) {
    if (e instanceof dell.DellError) return `Dell warranty lookup failed — warranties were left as they are. ${e.message}`;
    throw e;
  }
}

// ─── Global: status, companies, sites ─────────────────────────────────────────

export const connectWiseRouter = Router();

connectWiseRouter.get('/status', requireAuth, (req, res) => {
  res.json({ configured: cw.isConnectWiseConfigured() });
});

connectWiseRouter.get('/companies', requireAuth, async (req, res, next) => {
  if (!cw.isConnectWiseConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const list = (await cw.companies({ refresh: req.query.refresh === '1' })).map(companyOf).filter(c => c.id && c.name);
    res.json({ companies: sortByName(list) });
  } catch (err) { sendError(res, next, err); }
});

connectWiseRouter.get('/companies/:companyId/sites', requireAuth, async (req, res, next) => {
  if (!cw.isConnectWiseConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const list = (await cw.sites(req.params.companyId, { refresh: req.query.refresh === '1' })).map(siteOf).filter(s => s.id);
    res.json({ sites: sortByName(list) });
  } catch (err) { sendError(res, next, err); }
});

// ─── Per customer: preview + import ───────────────────────────────────────────

export const customerConnectWiseRouter = Router({ mergeParams: true });

customerConnectWiseRouter.get('/machines', requireAuth, async (req, res, next) => {
  if (!cw.isConnectWiseConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { companyId, siteId } = req.query;
    if (!companyId || !siteId) return res.status(400).json({ error: 'companyId and siteId are required.' });
    const [ctx, rows, devices] = await Promise.all([
      siteContext(companyId, siteId),
      cw.siteEndpoints(companyId, siteId, { refresh: req.query.refresh === '1' }),
      loadDevices(req.params.customerId),
    ]);
    const machines = rows.map(r => normalizeEndpoint(flattenDevice(r), ctx)).filter(m => m.endpoint_id);
    machines.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    const warrantyNote = await addDellWarranty(machines);

    // Preview in list order with a running "claimed" set — the same order the import
    // walks — so two machines can't both appear to update one device.
    const claimed = new Set();
    const out = machines.map(m => {
      const match = findMatch(m, devices, claimed);
      let preview = { action: 'create', device: null, reason: null, changes: [] };
      if (match.device) {
        claimed.add(match.device.id);
        // changes = what the import adds; differs = values it keeps that ConnectWise
        // reports differently (applied only with take_newer). See lib/sync-merge.js.
        const { changes, differs } = mergePlan(match.device, deviceFieldsFromMachine(m));
        preview = {
          action: changes.length ? 'update' : 'unchanged',
          device: { id: match.device.id, name: deviceName(match.device), location_id: match.device.location_id },
          reason: match.reason, changes, differs,
        };
      } else if (match.ambiguous) {
        preview = { action: 'ambiguous', device: null, reason: null, changes: [],
          candidates: match.ambiguous.map(d => ({ id: d.id, name: deviceName(d) })) };
      }
      // The Devices-tab type it will be filed under (printer, switch, …), for the preview.
      return { ...m, device_type: deviceTypeFor(m), preview };
    });
    res.json({
      machines: out, company: ctx.companyName, site: ctx.siteName,
      // Diagnostics: which device-list request this tenant accepted, and why hardware
      // or site details may be missing.
      list_shape: cw.deviceListShape(),
      hardware_note: cw.lastHardwareNote(),
      details_note: cw.lastDetailsNote(),
      warranty_note: warrantyNote,
    });
  } catch (err) { sendError(res, next, err); }
});

customerConnectWiseRouter.post('/import', requireAuth, async (req, res, next) => {
  if (!cw.isConnectWiseConfigured()) return res.status(503).json(NOT_CONFIGURED);
  try {
    const { customerId } = req.params;
    const { companyId, siteId } = req.body ?? {};
    const ids = Array.isArray(req.body?.endpoint_ids) ? req.body.endpoint_ids.map(String).slice(0, 1000) : [];
    if (!companyId || !siteId) return res.status(400).json({ error: 'companyId and siteId are required.' });
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one machine to import.' });
    const locationId = req.body?.location_id || null;
    // Also move devices already on file into that office (otherwise only new ones go there).
    const moveExisting = req.body?.move_existing === true;
    // Also replace values ConnectWise reports differently (otherwise only blanks and new items).
    const takeNewer = req.body?.take_newer === true;

    const { rows: cust } = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!cust[0]) return res.status(404).json({ error: 'Customer not found.' });

    const [ctx, rows] = await Promise.all([siteContext(companyId, siteId), cw.siteEndpoints(companyId, siteId)]);
    // Each row already carries its summary + details (see siteEndpoints).
    const byId = new Map(rows.map(r => normalizeEndpoint(flattenDevice(r), ctx)).map(m => [m.endpoint_id, m]));
    await addDellWarranty([...byId.values()]);
    const devices = await loadDevices(customerId);
    const claimed = new Set();
    const result = { created: [], updated: [], unchanged: [], skipped: [], failed: [] };

    for (const id of ids) {
      const m = byId.get(id);
      if (!m) { result.failed.push({ endpoint_id: id, error: 'No longer at this site in ConnectWise.' }); continue; }
      const fields = deviceFieldsFromMachine(m);

      try {
        const match = findMatch(m, devices, claimed);
        if (match.ambiguous) {
          result.skipped.push({ endpoint_id: id, name: m.name,
            reason: `${match.ambiguous.length} devices here are named "${m.machine_name || m.name}" — rename one, or add its serial / MAC, then try again` });
          continue;
        }

        if (match.device) {
          const dev = match.device;
          claimed.add(dev.id);
          const plan = mergePlan(dev, fields);
          const updates = columnsFor(plan, takeNewer);
          const changes = changesFor(plan, takeNewer);
          const set = { ...updates, rmm_endpoint_id: m.endpoint_id, rmm_synced_at: new Date() };
          if (moveExisting && (dev.location_id ?? null) !== locationId) {
            set.location_id = locationId;
            changes.push({ field: 'location_id', from: dev.location_id ?? 'main office', to: locationId ?? 'main office', mode: 'update' });
          }
          if (m.warranty_expires) set.warranty_checked_at = new Date();
          // Re-sorted into another type (see mergePlan): it joins the bottom of that group.
          if (set.device_type) {
            await ensureDeviceType(customerId, set.device_type);
            const { rows: max } = await query(
              'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_devices WHERE customer_id = $1 AND device_type = $2',
              [customerId, set.device_type]);
            set.sort_order = max[0].next;
          }
          for (const k of Object.keys(set)) set[k] = toDb(set[k]);
          if (changes.length) set.updated_at = new Date();
          const cols = Object.keys(set);
          const { rows: upd } = await query(
            `UPDATE customer_devices SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
             WHERE id = $1 AND customer_id = $2 RETURNING *`,
            [dev.id, customerId, ...Object.values(set)]
          );
          Object.assign(dev, upd[0]);
          if (changes.length) {
            await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
              entityType: 'device', entityId: dev.id,
              entityName: `${deviceName(dev)} — updated from ConnectWise RMM (${match.reason})`,
              changes: Object.fromEntries(changes.map(c => [c.field, { from: c.from, to: c.to }])),
              ipAddress: getClientIp(req) });
            result.updated.push({ endpoint_id: id, name: m.name, device: deviceName(dev), reason: match.reason, changes });
          } else {
            result.unchanged.push({ endpoint_id: id, name: m.name, device: deviceName(dev), reason: match.reason });
          }
          continue;
        }

        // New device.
        const insert = Object.fromEntries(Object.entries(fields)
          .filter(([, v]) => (Array.isArray(v) ? v.length : v))
          .map(([k, v]) => [k, toDb(v)]));
        insert.customer_id = customerId;
        insert.location_id = locationId;
        insert.created_by  = req.user.sub;
        insert.rmm_endpoint_id = m.endpoint_id;
        insert.rmm_synced_at   = new Date();
        if (m.warranty_expires) insert.warranty_checked_at = new Date();
        await ensureDeviceType(customerId, insert.device_type);
        const { rows: max } = await query(
          `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_devices WHERE customer_id = $1 AND device_type = $2`,
          [customerId, insert.device_type]
        );
        insert.sort_order = max[0].next;
        const cols = Object.keys(insert);
        const { rows: ins } = await query(
          `INSERT INTO customer_devices (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          Object.values(insert)
        );
        devices.push(ins[0]);
        claimed.add(ins[0].id);
        await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
          entityType: 'device', entityId: ins[0].id,
          entityName: `${deviceName(ins[0])} — imported from ConnectWise RMM`,
          ipAddress: getClientIp(req) });
        result.created.push({ endpoint_id: id, name: m.name, device: deviceName(ins[0]), device_type: ins[0].device_type });
      } catch (e) {
        result.failed.push({ endpoint_id: id, name: m.name, error: e.message });
      }
    }
    // Remember the site, so the next import opens straight on it for everyone.
    await saveLink({ customerId, provider: 'connectwise', externalId: `${companyId}/${siteId}`,
      externalName: [ctx.companyName, ctx.siteName].filter(Boolean).join(' › '), locationId, userId: req.user.sub });
    res.json(result);
  } catch (err) { sendError(res, next, err); }
});
