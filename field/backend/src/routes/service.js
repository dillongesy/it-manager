import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { existsSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from '../db/index.js';
import { requireService } from '../middleware/requireService.js';
import { logAudit } from '../middleware/audit.js';
import { serviceLedgerNote, parseQuantity, nextSku, SKU_PREFIX, buildSearchClause } from '../lib/inventory-logic.js';
import { dayHours, totalHours } from '../lib/work-order-logic.js';

// Columns matched by the free-text inventory search (token-AND across these).
const SEARCH_COLUMNS = ['name', 'sku', 'manufacturer_barcode', 'description', 'category'];

const __dir = dirname(fileURLToPath(import.meta.url));
const PHOTO_UPLOAD = join(__dir, '..', '..', 'uploads', 'photos');

const router = Router();
router.use(requireService);

// Bridge actions are attributed in the audit log to the service user, but the
// acting IT tech's name (sent as `actor`) is stamped into user_name for traceability.
function bridgeAuditName(actor) {
  return actor ? `IT Portal: ${actor}` : 'IT Portal';
}

async function nextSKU() {
  const { rows } = await query(
    `SELECT sku FROM inventory_items WHERE sku LIKE $1 ORDER BY sku DESC LIMIT 1`,
    [`${SKU_PREFIX}-%`]
  );
  return nextSku(rows[0]?.sku);
}

// All actions taken through the bridge are attributed to a single, non-login
// service account so the inventory ledger clearly shows "consumed by the IT side".
// Created lazily on first use; is_active=false so it can never be logged into.
let cachedServiceUserId = null;
async function getServiceUserId() {
  if (cachedServiceUserId) return cachedServiceUserId;
  const { rows } = await query(`SELECT id FROM users WHERE username = 'it-portal-service'`);
  if (rows[0]) {
    cachedServiceUserId = rows[0].id;
    return cachedServiceUserId;
  }
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const { rows: created } = await query(
    `INSERT INTO users (username, full_name, initials, password_hash, role, is_active)
     VALUES ('it-portal-service', 'IT Portal', 'IT', $1, 'admin', false)
     RETURNING id`,
    [hash]
  );
  cachedServiceUserId = created[0].id;
  return cachedServiceUserId;
}

// GET /api/service/inventory - list (read-only)
router.get('/inventory', async (req, res, next) => {
  try {
    const { search, category, lowStock, limit = 200, offset = 0 } = req.query;
    let sql = `SELECT * FROM inventory_items WHERE is_active = true`;
    const params = [];
    const { clause, params: searchParams } = buildSearchClause(search, SEARCH_COLUMNS, params.length + 1);
    if (clause) { sql += ` AND (${clause})`; params.push(...searchParams); }
    if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
    if (lowStock === 'true') { sql += ` AND quantity <= low_stock_threshold`; }
    sql += ` ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/service/inventory/categories
router.get('/inventory/categories', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT category FROM inventory_items WHERE is_active=true AND category IS NOT NULL ORDER BY category`
    );
    res.json(rows.map(r => r.category));
  } catch (err) { next(err); }
});

// GET /api/service/inventory/:id - one item + recent ledger
router.get('/inventory/:id', async (req, res, next) => {
  try {
    const [itemRes, txRes] = await Promise.all([
      query('SELECT * FROM inventory_items WHERE id=$1', [req.params.id]),
      query(
        `SELECT it.*, u.full_name AS user_name
         FROM inventory_transactions it
         LEFT JOIN users u ON u.id = it.user_id
         WHERE it.item_id=$1 ORDER BY it.created_at DESC LIMIT 30`,
        [req.params.id]
      ),
    ]);
    if (!itemRes.rows[0]) return res.status(404).json({ error: 'Item not found.' });
    res.json({ ...itemRes.rows[0], transactions: txRes.rows });
  } catch (err) { next(err); }
});

// POST /api/service/inventory/:id/checkout - IT side consumes shared stock.
// Body: { quantity, actor?, notes? }. `actor` is the IT tech's name, stamped
// into the ledger note so usage is traceable to a person.
router.post('/inventory/:id/checkout', async (req, res, next) => {
  const client = await getClient();
  try {
    const { quantity, actor, notes } = req.body ?? {};
    const parsed = parseQuantity(quantity);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error }); // finally releases
    const qty = parsed.value;

    await client.query('BEGIN');
    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=quantity-$1, updated_at=NOW() WHERE id=$2 AND is_active=true RETURNING *',
      [qty, req.params.id]
    );
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }
    if (Number(item[0].quantity) < 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Insufficient stock.' }); }

    const ledgerNote = serviceLedgerNote(actor, notes);
    const serviceUserId = await getServiceUserId();
    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, reference_type, user_id, notes)
       VALUES ($1,'checkout',$2,$3,'it_portal',$4,$5)`,
      [req.params.id, -qty, item[0].quantity, serviceUserId, ledgerNote]
    );
    await client.query('COMMIT');
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Checked out ${qty} (now ${item[0].quantity})` });
    res.json(item[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/service/inventory/:id/return - IT side puts shared stock BACK (the
// reverse of checkout, used when a work-order part is reduced or removed).
router.post('/inventory/:id/return', async (req, res, next) => {
  const client = await getClient();
  try {
    const { quantity, actor, notes } = req.body ?? {};
    const parsed = parseQuantity(quantity);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const qty = parsed.value;

    await client.query('BEGIN');
    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2 AND is_active=true RETURNING *',
      [qty, req.params.id]
    );
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    const ledgerNote = serviceLedgerNote(actor, notes);
    const serviceUserId = await getServiceUserId();
    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, reference_type, user_id, notes)
       VALUES ($1,'return',$2,$3,'it_portal',$4,$5)`,
      [req.params.id, qty, item[0].quantity, serviceUserId, ledgerNote]
    );
    await client.query('COMMIT');
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Returned ${qty} (now ${item[0].quantity})` });
    res.json(item[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/service/inventory - IT Portal creates a new inventory item.
// Body: { name, description, category, manufacturer_barcode, unit,
//         low_stock_threshold, cost_per_unit, notes, actor? }
router.post('/inventory', async (req, res, next) => {
  try {
    const { name, description, category, manufacturer_barcode, unit,
            low_stock_threshold, cost_per_unit, notes, actor } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });

    const sku = await nextSKU();
    const serviceUserId = await getServiceUserId();
    const { rows } = await query(
      `INSERT INTO inventory_items
         (name, description, category, sku, manufacturer_barcode, unit, low_stock_threshold, cost_per_unit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name.trim(), description, category, sku, manufacturer_barcode, unit ?? 'ea',
       low_stock_threshold ?? 5, cost_per_unit, notes, serviceUserId]
    );
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'CREATE',
      entityType: 'inventory', entityId: rows[0].id, entityName: `${rows[0].name} (${rows[0].sku})` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/service/inventory/:id - IT Portal edits item metadata (not quantity).
router.patch('/inventory/:id', async (req, res, next) => {
  try {
    const { actor } = req.body ?? {};
    const fields = ['name','description','category','manufacturer_barcode','unit','low_stock_threshold','cost_per_unit','notes'];
    const updates = { updated_at: new Date() };
    const changed = [];
    for (const f of fields) { if (req.body[f] !== undefined) { updates[f] = req.body[f]; changed.push(f); } }
    if (changed.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE inventory_items SET ${setClauses} WHERE id=$1 RETURNING *`,
      [req.params.id, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found.' });
    const serviceUserId = await getServiceUserId();
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'inventory', entityId: rows[0].id, entityName: `${rows[0].name} (${rows[0].sku})`,
      changes: { fields: changed } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/service/inventory/:id/receive - IT Portal adds stock on delivery.
router.post('/inventory/:id/receive', async (req, res, next) => {
  const client = await getClient();
  try {
    const { quantity, actor, notes } = req.body ?? {};
    const parsed = parseQuantity(quantity);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const qty = parsed.value;

    await client.query('BEGIN');
    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2 AND is_active=true RETURNING *',
      [qty, req.params.id]
    );
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    const ledgerNote = serviceLedgerNote(actor, notes);
    const serviceUserId = await getServiceUserId();
    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, reference_type, user_id, notes)
       VALUES ($1,'receive',$2,$3,'it_portal',$4,$5)`,
      [req.params.id, qty, item[0].quantity, serviceUserId, ledgerNote]
    );
    await client.query('COMMIT');
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Received ${qty} (now ${item[0].quantity})` });
    res.json(item[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/service/inventory/:id/adjust - IT Portal corrects the on-hand count.
router.post('/inventory/:id/adjust', async (req, res, next) => {
  const client = await getClient();
  try {
    const { new_quantity, actor, notes } = req.body ?? {};
    const newQty = parseFloat(new_quantity);
    if (isNaN(newQty) || newQty < 0) return res.status(400).json({ error: 'new_quantity must be >= 0.' });

    await client.query('BEGIN');
    const { rows: before } = await client.query('SELECT quantity FROM inventory_items WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!before[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    const delta = newQty - parseFloat(before[0].quantity);
    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [newQty, req.params.id]
    );
    const ledgerNote = serviceLedgerNote(actor, notes);
    const serviceUserId = await getServiceUserId();
    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, reference_type, user_id, notes)
       VALUES ($1,'adjust',$2,$3,'it_portal',$4,$5)`,
      [req.params.id, delta, newQty, serviceUserId, ledgerNote]
    );
    await client.query('COMMIT');
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Adjusted to ${newQty} (${delta >= 0 ? '+' : ''}${delta})` });
    res.json(item[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// DELETE /api/service/inventory/:id - IT Portal removes an item. Mirrors the Field-side
// rule: soft-delete (archive) if it has ledger history, hard-delete if it's a clean
// mistake. Body: { actor? }.
router.delete('/inventory/:id', async (req, res, next) => {
  const client = await getClient();
  try {
    const { actor } = req.body ?? {};
    await client.query('BEGIN');
    const { rows: item } = await client.query('SELECT id, name, sku FROM inventory_items WHERE id=$1', [req.params.id]);
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    const { rows: hist } = await client.query('SELECT 1 FROM inventory_transactions WHERE item_id=$1 LIMIT 1', [req.params.id]);
    let mode;
    if (hist.length) {
      await client.query('UPDATE inventory_items SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
      mode = 'archived';
    } else {
      await client.query('DELETE FROM inventory_items WHERE id=$1', [req.params.id]);
      mode = 'deleted';
    }
    await client.query('COMMIT');
    const serviceUserId = await getServiceUserId();
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'DELETE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item[0].name} (${item[0].sku}) — ${mode}` });
    res.json({ ok: true, mode, name: item[0].name, sku: item[0].sku });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- Field job captures (Portal pulls these to promote into real work orders) ---
// The Portal reaches in over the LAN to read "ready" captures + their photos and
// to mark a capture imported once it becomes a Portal WO. The Field App never
// initiates any of this - it only answers the Portal's authenticated calls.

// A capture is a list of DAYS (migration 006), each with its own date, crew +
// per-technician hours, parts and services. The Portal turns each day into one
// work_order_section on import, so the whole structure has to cross the bridge -
// not just a flattened total. Rates aren't captured here; the biller sets them
// per section in the Portal.
async function getFullJob(id) {
  const { rows } = await query('SELECT * FROM field_work_orders WHERE id=$1', [id]);
  if (!rows[0]) return null;
  const [days, techs, items, services, photos] = await Promise.all([
    query(
      `SELECT id, sort_order, work_date, description, notes
       FROM field_work_order_days WHERE work_order_id=$1 ORDER BY sort_order, work_date`,
      [id]
    ),
    query(
      `SELECT t.day_id, t.hours,
              COALESCE(u.full_name, t.name) AS full_name,
              COALESCE(u.initials, t.initials) AS initials
       FROM field_work_order_technicians t
       LEFT JOIN users u ON u.id=t.user_id
       WHERE t.work_order_id=$1 ORDER BY initials`,
      [id]
    ),
    query(
      `SELECT wi.id, wi.day_id, wi.inventory_item_id, wi.description, wi.quantity, wi.unit_price,
              ii.name AS item_name, ii.sku, ii.cost_per_unit AS inventory_cost
       FROM field_work_order_items wi
       LEFT JOIN inventory_items ii ON ii.id=wi.inventory_item_id
       WHERE wi.work_order_id=$1 ORDER BY wi.created_at`,
      [id]
    ),
    query(
      `SELECT id, day_id, description, quantity, unit_price, billing_type, recurrence, recurrence_count, notes
       FROM field_work_order_services WHERE work_order_id=$1 ORDER BY created_at`,
      [id]
    ),
    query(
      `SELECT id, original_name, mime_type, size_bytes, notes, created_at
       FROM field_photos WHERE work_order_id=$1 ORDER BY created_at`,
      [id]
    ),
  ]);

  const forDay = (rowsIn, dayId) => rowsIn.filter((r) => r.day_id === dayId);
  const nested = days.rows.map((d) => {
    const day = {
      ...d,
      technicians: forDay(techs.rows, d.id),
      items: forDay(items.rows, d.id),
      services: forDay(services.rows, d.id),
    };
    return { ...day, hours: dayHours(day) };
  });

  return {
    ...rows[0],
    days: nested,
    hours: totalHours(nested),
    // Flat roll-ups (each row tagged with its day_id) for the Portal's preview.
    technicians: techs.rows,
    items: items.rows,
    services: services.rows,
    photos: photos.rows,
  };
}

// GET /api/service/field-jobs?status=ready - list captures (default: ready)
router.get('/field-jobs', async (req, res, next) => {
  try {
    const { status = 'ready', limit = 200, offset = 0 } = req.query;
    const { rows } = await query(
      // Date range, day count and hours are derived from the job's days, so an
      // inbox card reads "Jul 20 – Jul 24 · 3 days · 17.5h" without a second fetch.
      `SELECT wo.id, wo.number, wo.customer_name, wo.customer_address, wo.notes,
              wo.capture_status, wo.created_at,
              d.first_date AS work_date, d.last_date, d.day_count,
              COALESCE(h.total_hours, 0) AS hours,
              d.summary AS description,
              STRING_AGG(DISTINCT COALESCE(u.initials, t.initials), '/') AS tech_initials,
              (SELECT COUNT(*) FROM field_photos p WHERE p.work_order_id=wo.id)        AS photo_count,
              (SELECT COUNT(*) FROM field_work_order_items wi WHERE wi.work_order_id=wo.id) AS item_count,
              (SELECT COUNT(*) FROM field_work_order_services sv WHERE sv.work_order_id=wo.id) AS service_count
       FROM field_work_orders wo
       LEFT JOIN LATERAL (
         SELECT MIN(work_date) AS first_date, MAX(work_date) AS last_date, COUNT(*) AS day_count,
                STRING_AGG(description, E'\n' ORDER BY sort_order, work_date) AS summary
         FROM field_work_order_days WHERE work_order_id=wo.id
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT SUM(hours) AS total_hours
         FROM field_work_order_technicians WHERE work_order_id=wo.id
       ) h ON true
       LEFT JOIN field_work_order_technicians t ON t.work_order_id=wo.id
       LEFT JOIN users u ON u.id=t.user_id
       WHERE wo.capture_status=$1
       GROUP BY wo.id, d.first_date, d.last_date, d.day_count, d.summary, h.total_hours
       ORDER BY d.first_date DESC NULLS LAST, wo.number DESC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/service/field-jobs/:id - one full capture
router.get('/field-jobs/:id', async (req, res, next) => {
  try {
    const job = await getFullJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    res.json(job);
  } catch (err) { next(err); }
});

// GET /api/service/field-jobs/:id/photos/:photoId - stream a photo's bytes so the
// Portal can copy it into the customer's files at promotion.
router.get('/field-jobs/:id/photos/:photoId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT stored_name, mime_type FROM field_photos WHERE id=$1 AND work_order_id=$2',
      [req.params.photoId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Photo not found.' });
    const path = join(PHOTO_UPLOAD, rows[0].stored_name);
    if (!existsSync(path)) return res.status(404).json({ error: 'File missing.' });
    res.setHeader('Content-Type', rows[0].mime_type ?? 'image/jpeg');
    createReadStream(path).pipe(res);
  } catch (err) { next(err); }
});

// POST /api/service/field-jobs/:id/imported - Portal marks a capture imported once
// it has become a real Portal WO. Body: { wo_number, actor? }.
router.post('/field-jobs/:id/imported', async (req, res, next) => {
  try {
    const { wo_number, actor } = req.body ?? {};
    const { rows } = await query(
      `UPDATE field_work_orders
         SET capture_status='imported', imported_at=NOW(), imported_wo_number=$2, updated_at=NOW()
       WHERE id=$1 AND capture_status='ready'
       RETURNING id, number, customer_name`,
      [req.params.id, wo_number || null]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Job not found or not in ready status.' });
    const serviceUserId = await getServiceUserId();
    await logAudit({ userId: serviceUserId, userName: bridgeAuditName(actor), action: 'UPDATE',
      entityType: 'work_order', entityId: rows[0].id,
      entityName: `Field Job #${rows[0].number} imported${wo_number ? ` as WO-${String(wo_number).padStart(5, '0')}` : ''}` });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

export default router;
