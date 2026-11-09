import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { nextSku, SKU_PREFIX, buildSearchClause } from '../lib/inventory-logic.js';

// Columns matched by the free-text search box (token-AND across these).
const SEARCH_COLUMNS = ['name', 'sku', 'manufacturer_barcode', 'description', 'category'];

const router = Router();

// ─── Auto-generate SKU ────────────────────────────────────────────────────

async function nextSKU() {
  const { rows } = await query(
    `SELECT sku FROM inventory_items WHERE sku LIKE $1 ORDER BY sku DESC LIMIT 1`,
    [`${SKU_PREFIX}-%`]
  );
  return nextSku(rows[0]?.sku);
}

// ─── List ──────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { search, category, lowStock, limit = 100, offset = 0 } = req.query;
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

// Distinct categories for filter chips
router.get('/categories', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT category FROM inventory_items WHERE is_active=true AND category IS NOT NULL ORDER BY category`
    );
    res.json(rows.map(r => r.category));
  } catch (err) { next(err); }
});

// Lookup by any barcode (SKU or manufacturer)
router.get('/barcode/:code', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM inventory_items WHERE is_active=true AND (sku=$1 OR manufacturer_barcode=$1) LIMIT 1`,
      [req.params.code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found for barcode.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [itemRes, txRes, usageRes] = await Promise.all([
      query('SELECT * FROM inventory_items WHERE id=$1', [req.params.id]),
      query(
        `SELECT it.*, u.full_name AS user_name
         FROM inventory_transactions it
         LEFT JOIN users u ON u.id = it.user_id
         WHERE it.item_id=$1 ORDER BY it.created_at DESC LIMIT 30`,
        [req.params.id]
      ),
      // Where this item is being used — the jobs that consumed it (#1: visibility).
      query(
        `SELECT wo.id AS job_id, wo.number, wo.customer_name, wo.customer_address,
                wo.work_date, wo.capture_status, wi.quantity
         FROM field_work_order_items wi
         JOIN field_work_orders wo ON wo.id = wi.work_order_id
         WHERE wi.inventory_item_id = $1
         ORDER BY wo.work_date DESC NULLS LAST, wo.number DESC
         LIMIT 20`,
        [req.params.id]
      ),
    ]);
    if (!itemRes.rows[0]) return res.status(404).json({ error: 'Item not found.' });
    res.json({ ...itemRes.rows[0], transactions: txRes.rows, usage: usageRes.rows });
  } catch (err) { next(err); }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, category, manufacturer_barcode, unit, low_stock_threshold, cost_per_unit, notes } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });

    const sku = await nextSKU();
    const { rows } = await query(
      `INSERT INTO inventory_items
         (name, description, category, sku, manufacturer_barcode, unit, low_stock_threshold, cost_per_unit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name.trim(), description, category, sku, manufacturer_barcode, unit ?? 'ea',
       low_stock_threshold ?? 5, cost_per_unit, notes, req.user.sub]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'inventory', entityId: rows[0].id, entityName: `${rows[0].name} (${rows[0].sku})`,
      ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
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
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: rows[0].id, entityName: `${rows[0].name} (${rows[0].sku})`,
      changes: { fields: changed }, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Transactions (receive / checkout / adjust) ───────────────────────────────

router.post('/:id/receive', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { quantity, location, notes } = req.body ?? {};
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'quantity must be > 0.' }); }

    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=quantity+$1, updated_at=NOW() WHERE id=$2 RETURNING quantity',
      [qty, req.params.id]
    );
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, location, user_id, notes)
       VALUES ($1,'receive',$2,$3,$4,$5,$6)`,
      [req.params.id, qty, item[0].quantity, location, req.user.sub, notes]
    );
    await client.query('COMMIT');
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Received ${qty} (now ${item[0].quantity})`, ipAddress: getClientIp(req) });
    res.json({ quantity: item[0].quantity });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.post('/:id/checkout', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { quantity, location, notes, work_order_id } = req.body ?? {};
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'quantity must be > 0.' }); }

    const { rows: item } = await client.query(
      'UPDATE inventory_items SET quantity=quantity-$1, updated_at=NOW() WHERE id=$2 RETURNING quantity',
      [qty, req.params.id]
    );
    if (!item[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }
    if (item[0].quantity < 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Insufficient stock.' }); }

    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, location, reference_id, reference_type, user_id, notes)
       VALUES ($1,'checkout',$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, -qty, item[0].quantity, location, work_order_id || null, work_order_id ? 'work_order' : null, req.user.sub, notes]
    );
    await client.query('COMMIT');
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Checked out ${qty} (now ${item[0].quantity})`, ipAddress: getClientIp(req) });
    res.json({ quantity: item[0].quantity });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.post('/:id/adjust', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { new_quantity, notes } = req.body ?? {};
    const newQty = parseFloat(new_quantity);
    if (isNaN(newQty) || newQty < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'new_quantity must be >= 0.' }); }

    const { rows: before } = await client.query('SELECT quantity FROM inventory_items WHERE id=$1', [req.params.id]);
    if (!before[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    const delta = newQty - parseFloat(before[0].quantity);
    await client.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2', [newQty, req.params.id]);
    await client.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity_delta, quantity_after, user_id, notes)
       VALUES ($1,'adjust',$2,$3,$4,$5)`,
      [req.params.id, delta, newQty, req.user.sub, notes]
    );
    await client.query('COMMIT');
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `Adjusted to ${newQty} (${delta >= 0 ? '+' : ''}${delta})`, ipAddress: getClientIp(req) });
    res.json({ quantity: newQty });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ─── Delete ─────────────────────────────────────────────────────────────────
// Remove an item from the system. To protect the immutable transactions ledger, an
// item that has ANY ledger history is soft-deleted (is_active=false → hidden from all
// lists/search/barcode/checkout); an item with no history (a genuine mistake) is hard-
// deleted. Either way it's gone from the active system. Returns { mode } so the caller
// can message accurately.
router.delete('/:id', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
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
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'inventory', entityId: req.params.id,
      entityName: `${item[0].name} (${item[0].sku}) — ${mode}`, ipAddress: getClientIp(req) });
    res.json({ ok: true, mode, name: item[0].name, sku: item[0].sku });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

export default router;
