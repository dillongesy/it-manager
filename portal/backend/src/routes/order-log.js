import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync, createReadStream, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { coerceDateFields } from '../lib/dates.js';
import { fieldInventory, isFieldConfigured } from '../lib/field-client.js';
import { planInventoryAdd, receiveQty, receiveNote } from '../lib/order-inventory.js';

const ORDER_DATE_FIELDS = ['order_date', 'expected_date', 'received_date'];

const __dir = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dir, '..', '..', 'uploads');

function orderDir(orderId) {
  const dir = join(UPLOADS_ROOT, 'orders', orderId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, orderDir(req.params.id)),
  filename: (_req, file, cb) => {
    const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

const VALID_STATUSES   = ['placed', 'pending', 'backordered', 'complete'];
const SCALAR_SUGGEST   = ['vendor', 'purpose', 'customer_name'];
const JSONB_SUGGEST    = ['item_name', 'sku']; // live inside items[] JSONB
const INVENTORY_LINE_KEYS = ['inventory_item_id', 'inventory_sku', 'inventory_name', 'added_qty', 'added_at'];

// Normalise an incoming items array: compute total_cost when not provided.
function processItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map(item => {
      const qty = parseFloat(item.quantity) || 1;
      const up  = item.unit_cost  != null && item.unit_cost  !== '' ? parseFloat(item.unit_cost)  : null;
      const tp  = item.total_cost != null && item.total_cost !== '' ? parseFloat(item.total_cost)
                                                                    : (up != null ? up * qty : null);
      const obj = { item_name: item.item_name?.trim() ?? '', sku: item.sku || null, quantity: qty, unit_cost: up, total_cost: tp };
      if (item.status && VALID_STATUSES.includes(item.status)) obj.status = item.status;
      // Inventory link/receipt state rides along on the line (see migration 055). It must
      // survive an ordinary edit — dropping added_at would let the line be received twice.
      for (const k of INVENTORY_LINE_KEYS) {
        if (item[k] != null && item[k] !== '') obj[k] = item[k];
      }
      return obj;
    })
    .filter(item => item.item_name);
}

// ─── Suggestions (autocomplete) ───────────────────────────────────────────────

router.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    const { field, q = '' } = req.query;
    const like = `%${q}%`;
    let rows;
    if (JSONB_SUGGEST.includes(field)) {
      // Query within the items JSONB array. field is whitelisted — safe to interpolate.
      ({ rows } = await query(
        `SELECT DISTINCT item->>'${field}' AS value
         FROM order_log, jsonb_array_elements(items) AS item
         WHERE item->>'${field}' ILIKE $1
           AND item->>'${field}' IS NOT NULL
           AND item->>'${field}' <> ''
         ORDER BY value LIMIT 8`,
        [like]
      ));
    } else if (SCALAR_SUGGEST.includes(field)) {
      ({ rows } = await query(
        `SELECT DISTINCT ${field} AS value FROM order_log
         WHERE ${field} ILIKE $1 AND ${field} IS NOT NULL AND ${field} <> ''
         ORDER BY value LIMIT 8`,
        [like]
      ));
    } else {
      return res.json([]);
    }
    res.json(rows.map(r => r.value));
  } catch (err) { next(err); }
});

// ─── Orders CRUD ─────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const conditions = [];
    const values = [];
    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      conditions.push(`status = $${values.length + 1}`);
      values.push(req.query.status);
    }
    // Dashboard: everything not fully received yet.
    if (req.query.incomplete === '1' || req.query.incomplete === 'true') {
      conditions.push(`status <> 'complete'`);
    }
    // Inventory orders whose stock hasn't been confirmed as added yet.
    if (req.query.needsInventory === '1' || req.query.needsInventory === 'true') {
      conditions.push(`o.is_inventory_order AND NOT o.inventory_added`);
    }
    if (req.query.search) {
      // items::text casts the whole JSONB to string for a simple substring match.
      conditions.push(
        `(vendor ILIKE $${values.length + 1} OR items::text ILIKE $${values.length + 1}` +
        ` OR po_number ILIKE $${values.length + 1} OR customer_name ILIKE $${values.length + 1})`
      );
      values.push(`%${req.query.search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT o.*,
              u.full_name  AS created_by_name,
              ob.full_name AS ordered_by_name,
              ib.full_name AS inventory_added_by_name,
              COUNT(a.id)::int AS attachment_count
       FROM order_log o
       LEFT JOIN users u  ON u.id  = o.created_by
       LEFT JOIN users ob ON ob.id = o.ordered_by
       LEFT JOIN users ib ON ib.id = o.inventory_added_by
       LEFT JOIN order_log_attachments a ON a.order_id = o.id
       ${where}
       GROUP BY o.id, u.full_name, ob.full_name, ib.full_name
       ORDER BY o.created_at DESC`,
      values
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.*, u.full_name AS created_by_name
       FROM order_log o LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found.' });
    const { rows: attachments } = await query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM order_log_attachments WHERE order_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json({ ...rows[0], attachments });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      vendor, items: rawItems, po_number, purpose, customer_name, for_stock,
      status, notes, ordered_by, is_inventory_order,
    } = req.body ?? {};
    if (!vendor?.trim()) return res.status(400).json({ error: 'vendor is required.' });
    const dates = coerceDateFields(req.body ?? {}, ORDER_DATE_FIELDS);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    const stat  = VALID_STATUSES.includes(status) ? status : 'placed';
    const items = processItems(rawItems);
    const { rows } = await query(
      `INSERT INTO order_log
         (vendor, items, po_number, purpose, customer_name, for_stock,
          status, order_date, expected_date, received_date, notes, ordered_by, created_by,
          is_inventory_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        vendor.trim(), JSON.stringify(items),
        po_number || null, purpose || null,
        for_stock ? null : (customer_name || null), !!for_stock,
        stat, dates.values.order_date ?? null, dates.values.expected_date ?? null, dates.values.received_date ?? null,
        notes || null, ordered_by || null, req.user.sub,
        !!is_inventory_order,
      ]
    );
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'order', entityId: rows[0].id, entityName: rows[0].vendor,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT * FROM order_log WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Order not found.' });

    const scalars = ['vendor', 'po_number', 'purpose', 'customer_name', 'notes', 'ordered_by'];
    const updates = {};
    for (const f of scalars) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    const dates = coerceDateFields(req.body, ORDER_DATE_FIELDS);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    Object.assign(updates, dates.values);
    if (req.body.for_stock !== undefined) {
      updates.for_stock = !!req.body.for_stock;
      if (updates.for_stock) updates.customer_name = null;
    }
    if (req.body.status !== undefined && VALID_STATUSES.includes(req.body.status)) {
      updates.status = req.body.status;
    }
    if (req.body.is_inventory_order !== undefined) {
      updates.is_inventory_order = !!req.body.is_inventory_order;
    }
    // "Added to inventory" ticked by hand (e.g. it was received straight into the Field
    // App). Stamps who/when; unticking clears them so the order shows as outstanding.
    if (req.body.inventory_added !== undefined) {
      updates.inventory_added = !!req.body.inventory_added;
      updates.inventory_added_at = updates.inventory_added ? new Date() : null;
      updates.inventory_added_by = updates.inventory_added ? req.user.sub : null;
      if (updates.inventory_added) updates.is_inventory_order = true;
    }
    if (req.body.items !== undefined) {
      updates.items = JSON.stringify(processItems(req.body.items));
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE order_log SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...Object.values(updates)]
    );
    const verb = updates.inventory_added === true ? ' — marked added to inventory'
      : updates.inventory_added === false ? ' — unmarked added to inventory' : '';
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'order', entityId: rows[0].id, entityName: rows[0].vendor + verb,
      ipAddress: getClientIp(req),
    });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM order_log WHERE id = $1 RETURNING vendor', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found.' });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'order', entityId: req.params.id, entityName: rows[0].vendor,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Add to inventory ─────────────────────────────────────────────────────────
//
// Receive an order's lines into shared (Field App) inventory — but only the lines
// that MATCH an existing inventory item (see lib/order-inventory.js). Two steps so
// nothing moves stock by surprise: GET the plan (preview), then POST to run it with
// any manual links/skips the user chose in the preview.

const BRIDGE_OFF = 'The Field App bridge is not configured.';

// Every active item — matching against a partial page would miss real matches.
const loadInventory = () => fieldInventory.list({ limit: 10000 });

// GET /:id/inventory-plan
router.get('/:id/inventory-plan', requireAuth, async (req, res, next) => {
  try {
    if (!isFieldConfigured()) return res.status(503).json({ error: BRIDGE_OFF });
    const { rows } = await query('SELECT * FROM order_log WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found.' });
    const inventory = await loadInventory();
    res.json({ order_id: rows[0].id, plan: planInventoryAdd(rows[0].items, inventory) });
  } catch (err) { next(err); }
});

// POST /:id/add-to-inventory  body { links?: { [lineIndex]: inventoryItemId | 'skip' } }
router.post('/:id/add-to-inventory', requireAuth, async (req, res, next) => {
  if (!isFieldConfigured()) return res.status(503).json({ error: BRIDGE_OFF });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Row lock: two people clicking "Add to inventory" at once must not both receive.
    const { rows } = await client.query('SELECT * FROM order_log WHERE id = $1 FOR UPDATE', [req.params.id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }

    const inventory = await loadInventory();
    const plan  = planInventoryAdd(order.items, inventory, req.body?.links ?? {});
    const items = (order.items ?? []).map(it => ({ ...it }));
    const received = [];
    const failed   = [];
    const note = receiveNote(order);

    for (const line of plan) {
      if (line.state !== 'receive') continue;
      const qty = receiveQty(line.quantity);
      try {
        const updated = await fieldInventory.receive(line.match.id, { quantity: qty, actor: req.user.fullName, notes: note });
        // Record the receipt on the line straight away, so a failure later in the loop
        // can't lose track of what already moved.
        Object.assign(items[line.index], {
          inventory_item_id: line.match.id,
          inventory_sku:     line.match.sku,
          inventory_name:    line.match.name,
          added_qty:         qty,
          added_at:          new Date().toISOString(),
        });
        received.push({
          index: line.index, item_name: line.item_name, qty,
          inventory_name: line.match.name, inventory_sku: line.match.sku,
          on_hand: updated?.quantity != null ? Number(updated.quantity) : null,
        });
        await logAudit({
          userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
          entityType: 'inventory', entityId: line.match.id,
          entityName: `${line.match.name} — received ${qty} (${note})`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        failed.push({ index: line.index, item_name: line.item_name, error: e.message });
      }
    }

    // Accounted for = nothing that matched is still waiting to go in. Unmatched lines are
    // non-inventory purchases by definition; ambiguous ones still need a decision.
    const receivedIdx = new Set(received.map(r => r.index));
    const pending = plan.filter(l => (l.state === 'receive' && !receivedIdx.has(l.index))
      || l.state === 'ambiguous' || l.state === 'bad_qty');
    const complete = items.some(it => it.added_at) && pending.length === 0;

    await client.query(
      `UPDATE order_log
          SET items = $2, is_inventory_order = true,
              inventory_added = $3,
              inventory_added_at = CASE WHEN $3 THEN COALESCE(inventory_added_at, NOW()) ELSE inventory_added_at END,
              inventory_added_by = CASE WHEN $3 THEN COALESCE(inventory_added_by, $4::uuid) ELSE inventory_added_by END,
              updated_at = NOW()
        WHERE id = $1`,
      [order.id, JSON.stringify(items), complete, req.user.sub]
    );
    await client.query('COMMIT');

    if (received.length) {
      await logAudit({
        userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
        entityType: 'order', entityId: order.id,
        entityName: `${order.vendor} — added ${received.length} line(s) to inventory`,
        changes: { received: received.map(r => `${r.qty} × ${r.inventory_name}`) },
        ipAddress: getClientIp(req),
      });
    }
    res.json({
      received, failed,
      skipped: plan.filter(l => l.state === 'unmatched' || l.state === 'skipped')
        .map(l => ({ index: l.index, item_name: l.item_name, state: l.state })),
      pending: pending.map(l => ({ index: l.index, item_name: l.item_name, state: l.state })),
      inventory_added: complete,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── Attachments ──────────────────────────────────────────────────────────────

router.get('/:id/attachments', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, original_name, mime_type, size_bytes, created_at FROM order_log_attachments WHERE order_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/attachments', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const { rows: order } = await query('SELECT id FROM order_log WHERE id = $1', [req.params.id]);
    if (!order[0]) { try { unlinkSync(req.file.path); } catch {} return res.status(404).json({ error: 'Order not found.' }); }
    const { rows } = await query(
      `INSERT INTO order_log_attachments (order_id, stored_name, original_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.sub]
    );
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'order_attachment', entityId: rows[0].id, entityName: req.file.originalname,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    try { unlinkSync(req.file.path); } catch {}
    next(err);
  }
});

router.get('/:id/attachments/:attachId/download', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM order_log_attachments WHERE id = $1 AND order_id = $2',
      [req.params.attachId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found.' });
    const filePath = join(orderDir(req.params.id), rows[0].stored_name);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk.' });
    const inline = !!req.query.inline;
    const mimeType = rows[0].mime_type || 'application/octet-stream';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${rows[0].original_name}"`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', statSync(filePath).size);
    createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

router.delete('/:id/attachments/:attachId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM order_log_attachments WHERE id = $1 AND order_id = $2 RETURNING *',
      [req.params.attachId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found.' });
    try { unlinkSync(join(orderDir(req.params.id), rows[0].stored_name)); } catch {}
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'order_attachment', entityId: req.params.attachId,
      entityName: rows[0].original_name, ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
