import { Router } from 'express';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { decrypt } from '../lib/encrypt.js';
import { cadenceLabel } from '../lib/cadence.js';
import { otherMacsText } from '../lib/device-macs.js';
import { getBranding } from '../lib/settings.js';

const router = Router({ mergeParams: true });

// --- Formatting helpers ---------------------------------------------------------

const money = (v) => (v == null || v === '' ? '' : `$${parseFloat(v).toFixed(2)}`);

function fmtDate(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(d);
}

const yn = (v) => (v ? 'Yes' : 'No');

// Render a JSONB value (array of objects, object, or scalar) into a readable,
// multi-line cell for the handoff sheet. Skips empty/secret-ish blobs.
function fmtJson(v) {
  if (v == null) return '';
  const one = (item) => {
    if (item == null) return '';
    if (typeof item === 'object') {
      return Object.entries(item)
        .filter(([k, val]) => val != null && val !== '' && !/_enc$/.test(k) && k !== 'id')
        .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
        .join(', ');
    }
    return String(item);
  };
  if (Array.isArray(v)) return v.map(one).filter(Boolean).join('\n');
  if (typeof v === 'object') return one(v);
  return String(v);
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// --- Sheet builders -------------------------------------------------------------

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

// Style a row as a table header (red band, white bold text).
function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

// A titled block of "Field | Value" pairs written into a sheet at the current cursor.
function writeKeyValues(sheet, title, pairs) {
  const t = sheet.addRow([title]);
  t.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFCC0000' } };
  for (const [k, v] of pairs) sheet.addRow([k, v ?? '']);
  sheet.addRow([]);
}

function buildOverviewSheet(wb, customer, contacts, locations, rates) {
  const sheet = wb.addWorksheet('Overview');
  sheet.columns = [{ width: 26 }, { width: 60 }];

  writeKeyValues(sheet, 'Company', [
    ['Business Name', customer.name],
    ['Street Address', customer.address],
    ['City', customer.city],
    ['State', customer.state],
    ['ZIP', customer.zip],
    ['Main Phone', customer.phone],
    ['Static WAN IP', customer.wan_ip],
    ['Firewall Mgmt Link', customer.firewall_link],
    ['Notes', customer.notes],
    ['Billing Contact — Name', customer.billing_contact_name],
    ['Billing Contact — Email', customer.billing_contact_email],
    ['Billing Contact — Phone', customer.billing_contact_phone],
  ]);

  if (locations.length) {
    const h = sheet.addRow(['Branch Offices']);
    h.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFCC0000' } };
    const head = sheet.addRow(['Label', 'Business Name', 'Address', 'Phone', 'WAN IP', 'Firewall / Notes']);
    styleHeader(head);
    for (const b of locations) {
      sheet.addRow([
        b.label, b.business_name,
        [b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter(Boolean).join(', '),
        b.phone, b.wan_ip,
        [b.firewall_link, b.notes].filter(Boolean).join(' — '),
      ]);
    }
    sheet.addRow([]);
  }

  if (contacts.length) {
    const h = sheet.addRow(['Contacts']);
    h.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFCC0000' } };
    const head = sheet.addRow(['Name', 'Title', 'Phone', 'Email', 'Primary', 'Notes']);
    styleHeader(head);
    for (const c of contacts) {
      sheet.addRow([c.name, c.title, c.phone, c.email, yn(c.is_primary), c.notes]);
    }
    sheet.addRow([]);
  }

  if (rates.length) {
    const h = sheet.addRow(['Billing Rates']);
    h.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFCC0000' } };
    const head = sheet.addRow(['Label', 'Rate', 'Notes']);
    styleHeader(head);
    for (const r of rates) sheet.addRow([r.label, money(r.rate), r.notes]);
  }
}

function buildDevicesSheet(wb, devices) {
  const sheet = wb.addWorksheet('Devices');
  const cols = [
    ['Type', 'device_type'], ['Label', 'label'], ['Assigned To', 'assigned_to'],
    ['Computer Name', 'computer_name'], ['Manufacturer', 'manufacturer'], ['Model', 'model'],
    ['Service Tag', 'service_tag'], ['Serial #', 'serial_number'], ['Processor', 'processor'],
    ['RAM', 'ram'], ['Storage', 'storage'], ['Storage Drives', 'storage_drives'],
    ['Operating System', 'operating_system'], ['IP Address', 'ip_address'], ['MAC Address', 'mac_address'], ['Other MACs', 'other_macs'],
    ['Username', 'username'], ['Password', '_password'],
    ['Admin Username', 'admin_username'], ['Admin Password', '_admin_password'],
    ['Firmware', 'firmware_version'], ['Internal IPs', 'internal_ips'], ['External IPs', 'external_ips'],
    ['WAN Subnet', 'wan_subnet_mask'], ['WAN Gateway', 'wan_gateway'], ['WAN DNS', 'wan_dns'],
    ['VLANs', 'vlans'], ['Firewall Rules', 'firewall_rules'], ['SSL VPN PSK', '_ssl_vpn_psk'],
    ['Share Paths', 'share_paths'], ['PoE Type', 'poe_type'], ['Port Count', 'port_count'],
    ['Managed By', 'managed_by'], ['Manager Email', 'manager_email'],
    ['Warranty Expires', 'warranty_expires'], ['License Expires', 'license_expires'],
    ['Printer Options', 'printer_options'], ['Apps Installed', 'apps_installed'], ['Notes', 'notes'],
  ];
  sheet.columns = cols.map(() => ({ width: 22 }));
  styleHeader(sheet.addRow(cols.map(([label]) => label)));

  for (const d of devices) {
    let printer = d.printer_options;
    if (printer && typeof printer === 'object') {
      const { email_password_enc, ...rest } = printer;
      printer = { ...rest };
      if (email_password_enc) printer.email_password = decrypt(email_password_enc);
    }
    sheet.addRow(cols.map(([, key]) => {
      switch (key) {
        case '_password':      return decrypt(d.password_enc) ?? '';
        case '_admin_password':return decrypt(d.admin_password_enc) ?? '';
        case '_ssl_vpn_psk':   return decrypt(d.ssl_vpn_psk_enc) ?? '';
        case 'printer_options':return fmtJson(printer);
        case 'other_macs':     return otherMacsText(d.other_macs);
        case 'warranty_expires':
        case 'license_expires': return fmtDate(d[key]);
        case 'storage_drives': case 'share_paths': case 'internal_ips':
        case 'external_ips':   case 'vlans': case 'firewall_rules':
          return fmtJson(d[key]);
        default: return d[key] ?? '';
      }
    }));
  }
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
}

function buildCredentialsSheet(wb, creds) {
  const sheet = wb.addWorksheet('Credentials');
  sheet.columns = [
    { width: 20 }, { width: 26 }, { width: 22 }, { width: 24 },
    { width: 30 }, { width: 30 }, { width: 40 }, { width: 40 },
  ];
  styleHeader(sheet.addRow(['Section', 'Label', 'Username', 'Password', 'URL', '2FA Note', 'Custom Fields', 'Notes']));
  for (const c of creds) {
    const custom = (c.custom_fields ?? [])
      .map((f) => {
        const val = f.secret ? decrypt(f.value) : f.value;
        return `${f.label}: ${val ?? ''}`;
      })
      .join('\n');
    sheet.addRow([
      c.category, c.label, c.username, decrypt(c.password_enc) ?? '',
      c.url, c.two_fa_note, custom, c.extra_notes,
    ]);
  }
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
}

function buildCamerasSheet(wb, cameras, sharedByCam) {
  const sheet = wb.addWorksheet('Cameras');
  sheet.columns = [
    { width: 22 }, { width: 10 }, { width: 12 }, { width: 22 }, { width: 18 },
    { width: 18 }, { width: 16 }, { width: 20 }, { width: 40 }, { width: 30 },
  ];
  styleHeader(sheet.addRow([
    'Label', 'Type', 'Channels', 'Model', 'Serial #', 'IP Address',
    'Username', 'Password', 'Shared Access', 'Notes',
  ]));
  for (const cam of cameras) {
    const shared = (sharedByCam.get(cam.id) ?? [])
      .map((s) => `${s.label}: ${s.username ?? ''} / ${decrypt(s.password_enc) ?? ''}${s.notes ? ` (${s.notes})` : ''}`)
      .join('\n');
    sheet.addRow([
      cam.label, cam.system_type, cam.channel_count, cam.model, cam.serial_number,
      cam.ip_address, cam.username, decrypt(cam.password_enc) ?? '', shared, cam.notes,
    ]);
  }
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
}

const TASK_STATUS_LABEL = { open: 'Open', scheduled: 'Scheduled', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };

function buildTodosSheet(wb, tasks) {
  const sheet = wb.addWorksheet('Tasks');
  sheet.columns = [{ width: 70 }, { width: 16 }];
  styleHeader(sheet.addRow(['Title', 'Status']));
  for (const t of tasks) sheet.addRow([t.title, TASK_STATUS_LABEL[t.status] ?? (t.is_done ? 'Done' : 'Open')]);
}

function buildLicensingSheet(wb, licenses) {
  const sheet = wb.addWorksheet('Licensing');
  sheet.columns = [
    { width: 28 }, { width: 20 }, { width: 24 }, { width: 14 }, { width: 44 },
    { width: 16 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 30 },
  ];
  styleHeader(sheet.addRow([
    'Program', 'Vendor', 'Vendor Contact', 'Version', 'License Keys',
    'Renewal / Expiration', 'Auto-Renew', 'Interval', 'Payment Method', 'Notes',
  ]));
  for (const l of licenses) {
    const keys = (l.license_keys ?? [])
      .map((k) => `${k.title ? `${k.title}: ` : ''}${decrypt(k.key_enc) ?? ''}`)
      .join('\n');
    sheet.addRow([
      l.program_name, l.vendor, l.vendor_contact, l.version, keys,
      fmtDate(l.renewal_date), yn(l.auto_renew),
      l.auto_renew ? cadenceLabel(l.renewal_interval, l.renewal_interval_count) : '',
      l.payment_method, l.notes,
    ]);
  }
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
}

function buildBillingSheet(wb, charges) {
  const sheet = wb.addWorksheet('Billing');
  sheet.columns = [
    { width: 34 }, { width: 20 }, { width: 10 }, { width: 14 }, { width: 14 },
    { width: 16 }, { width: 16 }, { width: 10 }, { width: 30 },
  ];
  styleHeader(sheet.addRow([
    'Description', 'Category', 'Qty', 'Unit Price', 'Amount',
    'Frequency', 'Billing Month', 'Active', 'Notes',
  ]));
  for (const c of charges) {
    sheet.addRow([
      c.description, c.category, c.quantity, money(c.unit_price), money(c.amount),
      cadenceLabel(c.frequency, c.interval_count),
      // A multi-year charge anchors to a year too, so the sheet says "November 2027"
      // rather than a month that could mean any of three years.
      c.billing_month ? MONTHS[c.billing_month] + (c.billing_year ? ' ' + c.billing_year : '') : '',
      yn(c.is_active), c.notes,
    ]);
  }
}

// --- Provider export ------------------------------------------------------------
// Full handoff workbook for another IT firm - includes DECRYPTED passwords for
// devices, credentials, cameras, and licenses. Admin-only, and the caller must
// re-enter their password immediately before export. The whole action is audited.
router.post('/provider', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    if (!password) return res.status(400).json({ error: 'Password is required to export.' });

    // Re-authenticate the acting admin against their own account.
    const { rows: userRows } = await query(
      'SELECT password_hash FROM users WHERE id = $1 AND is_active = true',
      [req.user.sub]
    );
    const ok = userRows[0] && await bcrypt.compare(password, userRows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });

    const customerId = req.params.customerId;
    const { rows: custRows } = await query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const customer = custRows[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const [contacts, locations, rates, devices, creds, cameras, shared, todos, licenses, charges] = await Promise.all([
      query('SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY sort_order, name', [customerId]),
      query('SELECT * FROM customer_locations WHERE customer_id = $1 ORDER BY label', [customerId]),
      query('SELECT * FROM customer_billing_rates WHERE customer_id = $1 ORDER BY sort_order, label', [customerId]),
      query(`SELECT d.* FROM customer_devices d
             LEFT JOIN customer_device_type_order t ON t.customer_id = d.customer_id AND t.device_type = d.device_type
             WHERE d.customer_id = $1 ORDER BY COALESCE(t.sort_order, 9999), d.device_type, d.sort_order, d.label`, [customerId]),
      query(`SELECT c.* FROM customer_credentials c
             LEFT JOIN customer_credential_sections s ON s.customer_id = c.customer_id AND s.category = COALESCE(c.category, 'General')
             WHERE c.customer_id = $1 ORDER BY COALESCE(s.sort_order, 9999), c.sort_order, c.label`, [customerId]),
      query('SELECT * FROM customer_camera_systems WHERE customer_id = $1 ORDER BY label', [customerId]),
      query(`SELECT sa.* FROM customer_camera_shared_access sa
             JOIN customer_camera_systems cs ON cs.id = sa.camera_system_id
             WHERE cs.customer_id = $1`, [customerId]),
      query(`SELECT title, status, (status = 'done') AS is_done FROM tasks WHERE customer_id = $1 ORDER BY (status = 'done'), rank, created_at`, [customerId]),
      query('SELECT * FROM customer_licenses WHERE customer_id = $1 ORDER BY program_name', [customerId]),
      query('SELECT * FROM customer_recurring_charges WHERE customer_id = $1 ORDER BY description', [customerId]),
    ]);

    const sharedByCam = new Map();
    for (const s of shared.rows) {
      if (!sharedByCam.has(s.camera_system_id)) sharedByCam.set(s.camera_system_id, []);
      sharedByCam.get(s.camera_system_id).push(s);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = (await getBranding()).productName;
    wb.created = new Date();
    buildOverviewSheet(wb, customer, contacts.rows, locations.rows, rates.rows);
    buildDevicesSheet(wb, devices.rows);
    buildCredentialsSheet(wb, creds.rows);
    buildCamerasSheet(wb, cameras.rows, sharedByCam);
    buildTodosSheet(wb, todos.rows);
    buildLicensingSheet(wb, licenses.rows);
    buildBillingSheet(wb, charges.rows);

    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'EXPORT',
      entityType: 'customer', entityId: customerId,
      entityName: `Provider export (all credentials) — ${customer.name}`,
      ipAddress: getClientIp(req),
    });

    const buffer = await wb.xlsx.writeBuffer();
    const safeName = (customer.name || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-provider-export-${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

export default router;
