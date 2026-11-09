import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { canTransitionCapture, normalizeDays, dayHours, totalHours, coerceIntervalCount } from '../lib/work-order-logic.js';

const router = Router();

const woName = (wo) => `Field Job #${wo.number}${wo.customer_name ? ` — ${wo.customer_name}` : ''}`;

// On open->ready we consume stock for each linked inventory line (the single
// decrement point); on ready->open we put it back. Editing is locked while
// 'ready', so the lines at reopen are exactly what was consumed at ready - no
// reconciliation needed. Items can go negative: a capture should never be blocked
// because the on-hand count is behind reality; the ledger records the truth and a
// later adjust can correct it.
async function applyCaptureStock(client, woId, sign, userId, woNumber) {
  const { rows: items } = await client.query(
    `SELECT inventory_item_id, quantity, description FROM field_work_order_items
     WHERE work_order_id=$1 AND inventory_item_id IS NOT NULL`,
    [woId]
  );
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const delta = sign * qty;
    const { rows: upd } = await client.query(
      `UPDATE inventory_items SET quantity=quantity+$1, updated_at=NOW()
       WHERE id=$2 AND is_active=true RETURNING quantity`,
      [delta, it.inventory_item_id]
    );
    if (!upd[0]) continue; // item deleted/inactive — skip silently
    await client.query(
      `INSERT INTO inventory_transactions
         (item_id, type, quantity_delta, quantity_after, reference_id, reference_type, user_id, notes)
       VALUES ($1,$2,$3,$4,$5,'field_job',$6,$7)`,
      [it.inventory_item_id, sign < 0 ? 'checkout' : 'return', delta, upd[0].quantity,
       woId, userId, `Field Job #${woNumber}${it.description ? ` — ${it.description}` : ''}`]
    );
  }
}

async function getFullWO(id) {
  const { rows } = await query('SELECT * FROM field_work_orders WHERE id=$1', [id]);
  if (!rows[0]) return null;

  const [days, techs, items, services, photos] = await Promise.all([
    query(
      `SELECT * FROM field_work_order_days WHERE work_order_id=$1 ORDER BY sort_order, work_date`,
      [id]
    ),
    query(
      // A technician is either a linked user account or free-typed initials, and
      // carries the hours THEY worked on THEIR day.
      `SELECT t.id, t.day_id, t.user_id, t.hours,
              COALESCE(u.full_name, t.name)     AS full_name,
              COALESCE(u.initials, t.initials)  AS initials
       FROM field_work_order_technicians t
       LEFT JOIN users u ON u.id=t.user_id
       WHERE t.work_order_id=$1
       ORDER BY initials`,
      [id]
    ),
    query(
      `SELECT wi.*, ii.name AS item_name, ii.sku, ii.cost_per_unit AS inventory_cost
       FROM field_work_order_items wi
       LEFT JOIN inventory_items ii ON ii.id=wi.inventory_item_id WHERE wi.work_order_id=$1
       ORDER BY wi.created_at`,
      [id]
    ),
    query(
      `SELECT * FROM field_work_order_services WHERE work_order_id=$1 ORDER BY created_at`,
      [id]
    ),
    query(
      `SELECT id, original_name, stored_name, notes, created_at FROM field_photos WHERE work_order_id=$1 ORDER BY created_at`,
      [id]
    ),
  ]);

  // One query per child table for the whole job, then grouped in memory - not one
  // query per day.
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
    // Always computed from the per-technician hours - never the legacy column.
    hours: totalHours(nested),
    // Flat roll-ups across every day, each row carrying its day_id. Kept so the
    // capture-stock pass, list views and older consumers stay simple.
    technicians: techs.rows,
    items: items.rows,
    services: services.rows,
    photos: photos.rows,
  };
}

const numOrNull = (v) => (v === '' || v == null || isNaN(parseFloat(v)) ? null : parseFloat(v));
const RECURRENCES = ['monthly', 'quarterly', 'semiannual', 'annual'];

/**
 * Replace a job's whole day structure (days + their technicians/parts/services).
 * A save is a clean full replace - the mobile form always posts the complete set,
 * which avoids per-row diffing on a flaky field connection.
 */
async function replaceDays(client, woId, dayList) {
  // A job always has at least one day - everything (the date, the crew, the hours)
  // hangs off one, so an empty list would leave an unusable record.
  const days = dayList.length ? dayList : [{
    work_date: null, description: null, notes: null,
    sort_order: 10, technicians: [], items: [], services: [],
  }];

  // Children cascade from their day, but rows written before migration 006 could
  // still be dangling with a NULL day_id - clear by work_order_id to be certain.
  await client.query('DELETE FROM field_work_order_days WHERE work_order_id=$1', [woId]);
  await client.query('DELETE FROM field_work_order_technicians WHERE work_order_id=$1', [woId]);
  await client.query('DELETE FROM field_work_order_items WHERE work_order_id=$1', [woId]);
  await client.query('DELETE FROM field_work_order_services WHERE work_order_id=$1', [woId]);

  for (const day of days) {
    const { rows } = await client.query(
      `INSERT INTO field_work_order_days (work_order_id, sort_order, work_date, description, notes)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5) RETURNING id`,
      [woId, day.sort_order, day.work_date, day.description, day.notes]
    );
    const dayId = rows[0].id;

    for (const t of day.technicians) {
      await client.query(
        `INSERT INTO field_work_order_technicians (work_order_id, day_id, user_id, initials, name, hours)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [woId, dayId, t.user_id, t.initials, t.name, t.hours]
      );
    }
    for (const it of day.items) {
      await client.query(
        `INSERT INTO field_work_order_items (work_order_id, day_id, inventory_item_id, description, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [woId, dayId, it.inventory_item_id || null, it.description.trim(), it.quantity || 1, numOrNull(it.unit_price)]
      );
    }
    for (const sv of day.services) {
      const billing = sv.billing_type === 'recurring' ? 'recurring' : 'one_time';
      const recurrence = billing === 'recurring'
        ? (RECURRENCES.includes(sv.recurrence) ? sv.recurrence : 'monthly')
        : null;
      // How many periods between bills - 3 for something sold three years at a time.
      // Only a yearly period may carry a count; the Portal enforces the same rule, so
      // the value survives the import unchanged.
      const recurrenceCount = billing === 'recurring' ? coerceIntervalCount(sv.recurrence_count, recurrence) : 1;
      await client.query(
        `INSERT INTO field_work_order_services (work_order_id, day_id, description, quantity, unit_price, billing_type, recurrence, recurrence_count, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [woId, dayId, sv.description.trim(), sv.quantity || 1, numOrNull(sv.unit_price), billing, recurrence, recurrenceCount, sv.notes?.trim() || null]
      );
    }
  }

  // The job's own work_date tracks its FIRST day, so existing list sorting and
  // idx_fwo_date keep working without a second date concept.
  await client.query(
    `UPDATE field_work_orders
        SET work_date = COALESCE((SELECT MIN(work_date) FROM field_work_order_days WHERE work_order_id=$1), work_date)
      WHERE id=$1`,
    [woId]
  );
}

/**
 * Read the day list out of a request body. The app always sends `days`. A flat
 * pre-006 body ({ work_date, technicians, items, services }) is still accepted and
 * becomes a single Day 1 - that shape is what older clients and the API tests use.
 * Returns null when the body says nothing about days, so a partial PATCH (e.g.
 * just renaming the customer) leaves the existing structure alone.
 */
function daysFromBody(body) {
  if (Array.isArray(body.days)) return normalizeDays(body.days);

  const flatKeys = ['technicians', 'items', 'services'].filter((k) => Array.isArray(body[k]));
  if (!flatKeys.length && body.work_date === undefined) return null;

  const days = normalizeDays([{
    work_date: body.work_date ?? null,
    description: body.description ?? null,
    technicians: body.technicians ?? [],
    items: body.items ?? [],
    services: body.services ?? [],
  }]);

  // A flat body's `hours` was one lump total for the crew. It only maps cleanly
  // when a single technician did the work; otherwise the split is unknowable, so
  // record the number in the day's notes rather than inventing a breakdown.
  const lump = numOrNull(body.hours);
  if (lump != null && days[0]) {
    if (days[0].technicians.length === 1) {
      days[0].technicians[0].hours = lump;
    } else {
      days[0].notes = [days[0].notes, `${lump} total hours (not split by technician).`]
        .filter(Boolean).join('\n');
    }
  }
  return days;
}

// GET /api/work-orders
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;
    // Hours, the date range and the crew are all derived from the job's days -
    // the card can show "Jul 20 – Jul 24 · 3 days · 17.5h" without a second fetch.
    let sql = `
      SELECT wo.id, wo.number, wo.customer_name, wo.customer_address, wo.notes,
             wo.capture_status, wo.imported_wo_number, wo.created_at, wo.updated_at,
             d.first_date AS work_date, d.last_date, d.day_count,
             COALESCE(h.total_hours, 0) AS hours,
             STRING_AGG(DISTINCT COALESCE(u.initials, t.initials), '/') AS tech_initials
      FROM field_work_orders wo
      LEFT JOIN LATERAL (
        SELECT MIN(work_date) AS first_date, MAX(work_date) AS last_date, COUNT(*) AS day_count
        FROM field_work_order_days WHERE work_order_id=wo.id
      ) d ON true
      LEFT JOIN LATERAL (
        SELECT SUM(hours) AS total_hours
        FROM field_work_order_technicians WHERE work_order_id=wo.id
      ) h ON true
      LEFT JOIN field_work_order_technicians t ON t.work_order_id=wo.id
      LEFT JOIN users u ON u.id=t.user_id
      WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); sql += ` AND wo.capture_status=$${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (wo.customer_name ILIKE $${params.length} OR wo.customer_address ILIKE $${params.length})`;
    }
    sql += ` GROUP BY wo.id, d.first_date, d.last_date, d.day_count, h.total_hours
             ORDER BY d.first_date DESC NULLS LAST, wo.number DESC
             LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE capture_status='open')  AS open,
        COUNT(*) FILTER (WHERE capture_status='ready') AS ready
      FROM field_work_orders
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const wo = await getFullWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Work order not found.' });
    res.json(wo);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    const body = req.body ?? {};
    const { customer_name, customer_address, notes } = body;
    if (!customer_name?.trim()) return res.status(400).json({ error: 'customer_name is required.' }); // finally releases

    // A brand-new job saved blank still gets its Day 1 (replaceDays guarantees it).
    const days = daysFromBody(body) ?? [];

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO field_work_orders (customer_name, customer_address, work_date, notes, created_by)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5) RETURNING id`,
      [customer_name.trim(), customer_address || null, days[0]?.work_date ?? body.work_date ?? null,
       notes || null, req.user.sub]
    );
    const woId = rows[0].id;
    await replaceDays(client, woId, days);
    await client.query('COMMIT');
    const wo = await getFullWO(woId);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'work_order', entityId: woId, entityName: woName(wo), ipAddress: getClientIp(req) });
    res.status(201).json(wo);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query('SELECT capture_status FROM field_work_orders WHERE id=$1', [req.params.id]);
    if (!cur[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    if (cur[0].capture_status !== 'open') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only open jobs can be edited. Reopen it first.' });
    }

    const fields = ['customer_name','customer_address','notes'];
    const updates = { updated_at: new Date() };
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }

    if (Object.keys(updates).length > 1) {
      const set = Object.keys(updates).map((k, i) => `${k}=$${i+2}`).join(', ');
      await client.query(`UPDATE field_work_orders SET ${set} WHERE id=$1`, [req.params.id, ...Object.values(updates)]);
    }

    const days = daysFromBody(req.body);
    if (days) {
      // The flat pre-006 fallback collapses a job to a single day, so only let it
      // run on a job that is still one day - it must never silently drop days off
      // a multi-day job. A body with an explicit `days` array is always honored.
      const { rows: dayCount } = await client.query(
        'SELECT COUNT(*)::int AS n FROM field_work_order_days WHERE work_order_id=$1', [req.params.id]
      );
      if (Array.isArray(req.body.days) || dayCount[0].n <= 1) {
        await replaceDays(client, req.params.id, days);
      }
    }

    await client.query('COMMIT');
    const wo = await getFullWO(req.params.id);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id, entityName: woName(wo), ipAddress: getClientIp(req) });
    res.json(wo);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// Capture transitions: open <-> ready. 'imported' is set only by the Portal
// bridge. Marking ready consumes stock for the job's inventory lines; reopening
// returns it (see applyCaptureStock).
const captureTransition = (to, verb) => async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT number, capture_status FROM field_work_orders WHERE id=$1', [req.params.id]
    );
    if (!cur[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }

    const check = canTransitionCapture(cur[0].capture_status, to);
    if (!check.ok) { await client.query('ROLLBACK'); return res.status(409).json({ error: check.error }); }

    // -1 consumes stock (going ready), +1 returns it (going back to open).
    await applyCaptureStock(client, req.params.id, to === 'ready' ? -1 : 1, req.user.sub, cur[0].number);
    await client.query(
      `UPDATE field_work_orders SET capture_status=$2, updated_at=NOW() WHERE id=$1`,
      [req.params.id, to]
    );
    await client.query('COMMIT');

    const wo = await getFullWO(req.params.id);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id, entityName: `${woName(wo)} — ${verb}`, ipAddress: getClientIp(req) });
    res.json(wo);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
};

router.post('/:id/ready',  requireAuth, captureTransition('ready', 'marked ready to bill'));
router.post('/:id/reopen', requireAuth, captureTransition('open',  'reopened'));

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM field_work_orders WHERE id=$1 AND capture_status='open' RETURNING number, customer_name`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Only open jobs can be deleted. Reopen it first to return stock.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'work_order', entityId: req.params.id, entityName: woName(rows[0]), ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
