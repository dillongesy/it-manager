import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';
import { assertDateFields } from '../lib/dates.js';
import { cleanOtherMacs } from '../lib/device-macs.js';

const router = Router({ mergeParams: true });

export function sanitize(row) {
  // Redact the scan-to-email password inside printer_options - expose only a flag.
  let printer = row.printer_options;
  if (printer && typeof printer === 'object') {
    const { email_password_enc, ...rest } = printer;
    printer = { ...rest, email_password_set: hasValue(email_password_enc) };
  }
  return {
    ...row,
    has_password:       hasValue(row.password_enc),
    has_admin_password: hasValue(row.admin_password_enc),
    has_ssl_vpn_psk:    hasValue(row.ssl_vpn_psk_enc),
    password_enc:       undefined,
    admin_password_enc: undefined,
    ssl_vpn_psk_enc:    undefined,
    printer_options:    printer,
  };
}

// Columns where the same value recurs across customers and a typo/casing slip is a
// real risk - these get autocomplete suggestions. Unique-per-device fields
// (service_tag, serial_number, ip_address, computer_name, label, assigned_to) are
// deliberately excluded: suggesting them would be noise or just wrong.
const SUGGESTABLE_COLUMNS = new Set([
  'manufacturer', 'model', 'processor', 'ram', 'operating_system',
  'managed_by', 'manager_email', 'poe_type',
]);

// GET /suggestions?field=manufacturer&type=firewall&q=soni
// Distinct prior values for one device field across ALL customers (case-insensitive
// prefix match), so techs can pick a consistent existing value instead of retyping.
router.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    const field = String(req.query.field || '');
    if (!SUGGESTABLE_COLUMNS.has(field)) return res.json([]);  // whitelist guards against SQL injection
    const params = [];
    let sql = `SELECT DISTINCT ${field} AS v FROM customer_devices WHERE ${field} IS NOT NULL AND ${field} <> ''`;
    if (req.query.type) { params.push(req.query.type); sql += ` AND device_type = $${params.length}`; }
    if (req.query.q)    { params.push(`${req.query.q}%`); sql += ` AND ${field} ILIKE $${params.length}`; }
    sql += ` ORDER BY v LIMIT 10`;
    const { rows } = await query(sql, params);
    res.json(rows.map(r => r.v));
  } catch (err) { next(err); }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [devicesRes, orderRes] = await Promise.all([
      query(
        `SELECT d.*, COALESCE(t.sort_order, 9999) AS type_order
         FROM customer_devices d
         LEFT JOIN customer_device_type_order t
           ON t.customer_id = d.customer_id AND t.device_type = d.device_type
         WHERE d.customer_id = $1
         ORDER BY type_order, d.device_type, d.sort_order, d.label`,
        [req.params.customerId]
      ),
      query(
        `SELECT device_type, sort_order FROM customer_device_type_order
         WHERE customer_id = $1 ORDER BY sort_order, device_type`,
        [req.params.customerId]
      ),
    ]);
    res.json({ devices: devicesRes.rows.map(sanitize), typeOrder: orderRes.rows });
  } catch (err) { next(err); }
});

// Make sure a device type has a row in the per-customer ordering table.
export async function ensureDeviceType(customerId, deviceType) {
  const { rows } = await query(
    `SELECT 1 FROM customer_device_type_order WHERE customer_id = $1 AND device_type = $2`,
    [customerId, deviceType]
  );
  if (!rows.length) {
    const { rows: max } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_device_type_order WHERE customer_id = $1`,
      [customerId]
    );
    await query(
      `INSERT INTO customer_device_type_order (customer_id, device_type, sort_order)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [customerId, deviceType, max[0].next]
    );
  }
}

// Plain scalar columns settable on create/update.
const SCALAR_FIELDS = [
  'device_type','label','assigned_to','computer_name','model','service_tag',
  'processor','ram','storage','operating_system','username','admin_username',
  'warranty_expires','apps_installed','notes','mac_address',
  'ip_address','driver_url','managed_by','manager_email',
  'manufacturer','firmware_version','serial_number','poe_type','managed_switch','port_count','license_expires',
  'wan_subnet_mask','wan_gateway','wan_dns','ip_assignment',
  'sort_order','location_id',
];
const DATE_FIELDS = ['warranty_expires', 'license_expires'];
const JSONB_FIELDS = ['storage_drives', 'share_paths', 'internal_ips', 'external_ips', 'vlans', 'firewall_rules', 'vpns'];

// Normalize printer_options, encrypting the scan-to-email password at rest. On
// edit, an empty email_password with `email_password_set` keeps the stored one.
function normalizePrinterOptions(po, prev) {
  if (!po || typeof po !== 'object') return {};
  const out = {
    scan_to_folder: !!po.scan_to_folder,
    scan_paths: Array.isArray(po.scan_paths)
      ? po.scan_paths.filter(s => s && (s.path || s.note)).map(s => ({ path: s.path ?? '', note: s.note ?? '' }))
      : [],
    scan_to_email: !!po.scan_to_email,
    email_server: po.email_server ?? '',
    email_account: po.email_account ?? '',
    email_notes: po.email_notes ?? '',
    has_fax: !!po.has_fax,
    fax_number: po.fax_number ?? '',
  };
  if (po.email_password) out.email_password_enc = encrypt(po.email_password);
  else if (prev?.email_password_enc) out.email_password_enc = prev.email_password_enc; // keep
  return out;
}

// Build the column→value map shared by create and update, applying date/JSONB/
// password coercion. Only includes keys present in req.body. `prevPrinter` is the
// existing printer_options (for keep-password-on-edit).
function buildDeviceUpdates(body, prevPrinter) {
  const updates = {};
  for (const f of SCALAR_FIELDS) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  // Dates are validated, not passed through: a six-digit year typed into a date input
  // stores fine in Postgres but makes the record un-editable afterwards. See lib/dates.js.
  // Throws a 400 rather than returning, so a bad date can never reach the SET clause.
  Object.assign(updates, assertDateFields(body, DATE_FIELDS));
  if (updates.location_id === '') updates.location_id = null; // UUID column rejects ''
  // How the IP is assigned: one of three words, or nothing.
  if (updates.ip_assignment !== undefined && !['dhcp', 'reservation', 'static'].includes(updates.ip_assignment)) updates.ip_assignment = null;
  for (const f of JSONB_FIELDS) {
    if (body[f] !== undefined) {
      updates[f] = JSON.stringify(Array.isArray(body[f]) ? body[f] : []);
    }
  }
  // Other MACs: valid addresses only, one entry each, never repeating mac_address.
  if (body.other_macs !== undefined) updates.other_macs = JSON.stringify(cleanOtherMacs(body.other_macs, body.mac_address));
  if (body.printer_options !== undefined) {
    updates.printer_options = JSON.stringify(normalizePrinterOptions(body.printer_options, prevPrinter));
  }
  if (body.password !== undefined) updates.password_enc = encrypt(body.password);
  if (body.admin_password !== undefined) updates.admin_password_enc = encrypt(body.admin_password);
  if (body.ssl_vpn_psk !== undefined) updates.ssl_vpn_psk_enc = encrypt(body.ssl_vpn_psk);
  return updates;
}

// Mirror a device's "License Expires" date into the customer's Licensing tab as an
// auto-managed license linked back via source_device_id. Set → upsert; cleared → remove.
// Program name = "<office> - <device name>"; renewal date = the device's license_expires.
// Best-effort: a failure here never blocks the device save.
async function syncDeviceLicense(customerId, device, userId) {
  try {
    const { rows: existing } = await query(
      'SELECT id FROM customer_licenses WHERE source_device_id = $1', [device.id]
    );
    const expires = device.license_expires;
    if (!expires) {
      if (existing[0]) await query('DELETE FROM customer_licenses WHERE id = $1', [existing[0].id]);
      return;
    }
    // Office label (also scopes the license to the same branch as the device).
    let officeName;
    if (device.location_id) {
      const { rows } = await query(
        'SELECT label, business_name, address FROM customer_locations WHERE id = $1', [device.location_id]);
      const loc = rows[0];
      officeName = (loc && (loc.label || loc.business_name || loc.address)) || 'Branch';
    } else {
      const { rows } = await query('SELECT name FROM customers WHERE id = $1', [customerId]);
      officeName = rows[0]?.name || 'Main Office';
    }
    const deviceName = device.label || device.model || 'Device';
    const programName = `${officeName} - ${deviceName}`;

    if (existing[0]) {
      // Keep manually-added vendor/keys/notes; only the name, date, and office mirror the device.
      await query(
        `UPDATE customer_licenses
           SET program_name = $1, renewal_date = $2, location_id = $3, updated_at = NOW()
         WHERE id = $4`,
        [programName, expires, device.location_id || null, existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO customer_licenses
           (customer_id, program_name, renewal_date, location_id, source_device_id, license_keys, created_by)
         VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6)`,
        [customerId, programName, expires, device.location_id || null, device.id, userId]
      );
    }
  } catch (e) {
    console.error('Device license sync failed:', e.message);
  }
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const updates = buildDeviceUpdates(req.body ?? {});
    updates.customer_id = req.params.customerId;
    updates.device_type = updates.device_type ?? 'workstation';
    updates.created_by = req.user.sub;

    await ensureDeviceType(req.params.customerId, updates.device_type);
    // New device goes to the bottom of its type group.
    const { rows: max } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_devices
       WHERE customer_id = $1 AND device_type = $2`,
      [req.params.customerId, updates.device_type]
    );
    updates.sort_order = max[0].next;

    const cols = Object.keys(updates);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await query(
      `INSERT INTO customer_devices (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(updates)
    );

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'device', entityId: rows[0].id, entityName: rows[0].label ?? rows[0].model,
      ipAddress: getClientIp(req) });

    await syncDeviceLicense(req.params.customerId, rows[0], req.user.sub);
    res.status(201).json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:deviceId', requireAuth, async (req, res, next) => {
  try {
    // Snapshot before - needed both for the audit diff and to keep the printer
    // email password when the form leaves it blank.
    const { rows: before } = await query(
      'SELECT * FROM customer_devices WHERE id = $1 AND customer_id = $2',
      [req.params.deviceId, req.params.customerId]
    );
    if (!before[0]) return res.status(404).json({ error: 'Device not found.' });

    const updates = buildDeviceUpdates(req.body ?? {}, before[0].printer_options);
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_devices SET ${setClauses}
       WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.deviceId, req.params.customerId, ...Object.values(updates)]
    );

    const changes = diffChanges(before[0], rows[0], Object.keys(updates).filter(k => k !== 'updated_at'));
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'device', entityId: rows[0].id, entityName: rows[0].label ?? rows[0].model,
      changes, ipAddress: getClientIp(req) });

    await syncDeviceLicense(req.params.customerId, rows[0], req.user.sub);
    res.json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

// Reveal a single password field - audit logged
router.post('/:deviceId/reveal', requireAuth, async (req, res, next) => {
  try {
    const { field } = req.body ?? {};
    if (!['password', 'admin_password', 'printer_email_password', 'ssl_vpn_psk'].includes(field)) {
      return res.status(400).json({ error: 'invalid field' });
    }
    const { rows } = await query(
      `SELECT password_enc, admin_password_enc, ssl_vpn_psk_enc, printer_options, label, model
       FROM customer_devices WHERE id = $1 AND customer_id = $2`,
      [req.params.deviceId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Device not found.' });

    let cipher;
    if (field === 'password') cipher = rows[0].password_enc;
    else if (field === 'admin_password') cipher = rows[0].admin_password_enc;
    else if (field === 'ssl_vpn_psk') cipher = rows[0].ssl_vpn_psk_enc;
    else cipher = rows[0].printer_options?.email_password_enc;  // scan-to-email password

    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'device', entityId: req.params.deviceId,
      entityName: `${rows[0].label ?? rows[0].model} — ${field}`, ipAddress: getClientIp(req) });

    res.json({ value: decrypt(cipher) });
  } catch (err) { next(err); }
});

router.delete('/:deviceId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_devices WHERE id = $1 AND customer_id = $2 RETURNING label, model`,
      [req.params.deviceId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Device not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'device', entityId: req.params.deviceId,
      entityName: rows[0].label ?? rows[0].model, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Reorder devices within a type - body { ids: [deviceId, …] } in the new order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE customer_devices SET sort_order = $3 WHERE id = $1 AND customer_id = $2`,
        [ids[i], req.params.customerId, (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'device', entityId: req.params.customerId, entityName: 'Devices reordered',
      changes: { order: ids }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Reorder device-type groups - body { types: [device_type, …] } in the new order.
router.post('/types/reorder', requireAuth, async (req, res, next) => {
  try {
    const types = Array.isArray(req.body?.types) ? req.body.types : [];
    for (let i = 0; i < types.length; i++) {
      await query(
        `INSERT INTO customer_device_type_order (customer_id, device_type, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_id, device_type) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [req.params.customerId, types[i], (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'device', entityId: req.params.customerId, entityName: 'Device types reordered',
      changes: { order: types }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
