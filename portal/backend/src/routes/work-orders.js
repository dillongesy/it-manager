import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { fieldInventory, isFieldConfigured } from '../lib/field-client.js';
import { parsePaging, setTotalCount } from '../lib/pagination.js';
import { coerceDateFields } from '../lib/dates.js';
import { coerceIntervalCount } from '../lib/cadence.js';
import { findDefaultRateId } from '../lib/billing-rates.js';

const router = Router();

// --- Helpers ------------------------------------------------------------------

async function getFullWO(id) {
  const { rows } = await query(
    `SELECT wo.*,
            c.name AS customer_name, c.address AS customer_address,
            c.city AS customer_city, c.state AS customer_state, c.phone AS customer_phone,
            cbr.label AS billing_rate_label, cbr.rate AS billing_rate_value,
            u.full_name AS created_by_name,
            loc.label AS location_label, loc.business_name AS location_business_name,
            loc.address AS location_address, loc.city AS location_city,
            loc.state AS location_state, loc.zip AS location_zip, loc.phone AS location_phone
     FROM work_orders wo
     JOIN customers c ON c.id = wo.customer_id
     LEFT JOIN customer_billing_rates cbr ON cbr.id = wo.billing_rate_id
     LEFT JOIN users u ON u.id = wo.created_by
     LEFT JOIN customer_locations loc ON loc.id = wo.location_id
     WHERE wo.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const wo = rows[0];

  const [sectionRows, techRows, itemRows, rateRows, locationRows, serviceRows, proposalRows, woPropRows] = await Promise.all([
    query(`SELECT s.*, cbr.label AS rate_label, cbr.rate AS rate_value,
                  cf.original_name AS linked_proposal_name
           FROM work_order_sections s
           LEFT JOIN customer_billing_rates cbr ON cbr.id = s.billing_rate_id
           LEFT JOIN customer_files cf ON cf.id = s.linked_proposal_id
           WHERE s.work_order_id = $1 ORDER BY s.sort_order, s.created_at`, [id]),
    query(`SELECT wot.id AS row_id, wot.section_id, wot.user_id,
                  COALESCE(u.full_name, wot.name) AS full_name
           FROM work_order_technicians wot LEFT JOIN users u ON u.id = wot.user_id
           WHERE wot.work_order_id = $1 ORDER BY full_name`, [id]),
    query(`SELECT * FROM work_order_items WHERE work_order_id = $1 ORDER BY created_at`, [id]),
    query(`SELECT * FROM customer_billing_rates WHERE customer_id = $1 ORDER BY label`, [wo.customer_id]),
    query(`SELECT id, label, business_name, address, city, state, zip, phone
           FROM customer_locations WHERE customer_id = $1 ORDER BY label`, [wo.customer_id]),
    query(`SELECT * FROM work_order_services WHERE work_order_id = $1 ORDER BY created_at`, [id]),
    query(`SELECT id, original_name FROM customer_files WHERE customer_id = $1 AND kind = 'proposal' AND (proposal_status IS NULL OR proposal_status != 'rejected') ORDER BY original_name`, [wo.customer_id]),
    query(`SELECT wop.id, wop.price_excl_tax, wop.sort_order,
                  cf.id AS proposal_file_id, cf.original_name AS proposal_name,
                  cf.mime_type AS proposal_mime_type
           FROM work_order_proposals wop
           LEFT JOIN customer_files cf ON cf.id = wop.proposal_file_id
           WHERE wop.work_order_id = $1
           ORDER BY wop.sort_order, wop.created_at`, [id]),
  ]);

  // WO-level default rate, used when a section has no override.
  const defaultRate = wo.billing_rate_value != null ? parseFloat(wo.billing_rate_value) : null;

  const sections = sectionRows.rows.map(s => {
    const technicians = techRows.rows
      .filter(t => t.section_id === s.id)
      .map(t => ({ id: t.user_id ?? t.row_id, user_id: t.user_id, full_name: t.full_name }));
    const items = itemRows.rows.filter(i => i.section_id === s.id);
    const services = serviceRows.rows.filter(sv => sv.section_id === s.id);
    const effectiveRate = s.rate_value != null ? parseFloat(s.rate_value) : defaultRate;
    const hours = s.hours != null ? parseFloat(s.hours) : 0;
    // Proposal-linked sections: only bill overage hours beyond the estimate.
    // If no estimated hours are specified, all labor is considered covered.
    let billableHours = hours;
    if (s.linked_proposal_id) {
      const estHours = s.proposal_estimated_hours != null ? parseFloat(s.proposal_estimated_hours) : null;
      billableHours = estHours != null ? Math.max(0, hours - estHours) : 0;
    }
    const labor = effectiveRate != null ? billableHours * effectiveRate : 0;
    const parts = items.reduce((sum, i) => sum + parseFloat(i.total_price || 0), 0);
    // One-time services bill on this WO; recurring services are reported separately.
    const oneTimeServices = services
      .filter(sv => sv.billing_type !== 'recurring')
      .reduce((sum, sv) => sum + parseFloat(sv.total_price || 0), 0);
    return {
      ...s,
      technicians,
      items,
      services,
      effective_rate: effectiveRate,
      effective_rate_label: s.rate_label ?? wo.billing_rate_label ?? null,
      labor_total: labor,
      parts_total: parts,
      services_onetime_total: oneTimeServices,
    };
  });

  const laborTotal = sections.reduce((sum, sec) => sum + sec.labor_total, 0);
  const hardwareTotal = sections.reduce((sum, sec) => sum + sec.parts_total, 0);
  const servicesOneTimeTotal = sections.reduce((sum, sec) => sum + sec.services_onetime_total, 0);
  // Recurring services across the whole WO, grouped by name + cadence + unit price so
  // identical lines collapse into one row with a combined quantity (e.g. three
  // "ThreatLocker Complete @ $5/mo" entries → ×3 at $5.00/mo, not three separate lines).
  const recurringMap = new Map();
  for (const sv of serviceRows.rows.filter(s => s.billing_type === 'recurring')) {
    const qty = parseFloat(sv.quantity) || 1;
    const unit = sv.unit_price != null ? parseFloat(sv.unit_price)
               : sv.total_price != null ? parseFloat(sv.total_price) / qty
               : 0;
    // The cadence COUNT is part of the identity: "$60 annually" and "$60 every 3
    // years" are different charges and must never collapse into one row.
    const count = sv.recurrence_count ?? 1;
    const key = `${sv.description}||${sv.recurrence}||${count}||${unit.toFixed(4)}`;
    const existing = recurringMap.get(key);
    if (existing) existing.quantity += qty;
    else recurringMap.set(key, { description: sv.description, recurrence: sv.recurrence, recurrence_count: count, unit_price: unit, quantity: qty });
  }
  const recurringServices = [...recurringMap.values()].map((r, i) => ({
    id: `rec-${i}`,
    description: r.description,
    recurrence: r.recurrence,
    recurrence_count: r.recurrence_count,
    unit_price: r.unit_price,
    quantity: r.quantity,
    total_price: r.unit_price * r.quantity,
  }));

  return {
    ...wo,
    sections,
    billing_rates: rateRows.rows,
    locations: locationRows.rows,
    proposals: proposalRows.rows,
    wo_proposals: woPropRows.rows,
    labor_total: laborTotal,
    hardware_total: hardwareTotal,
    services_onetime_total: servicesOneTimeTotal,
    recurring_services: recurringServices,
    grand_total: laborTotal + hardwareTotal + servicesOneTimeTotal,
  };
}

// Gate writes: the WO must exist and be editable. Draft and pending_billing are
// both editable (techs can fix a WO after submitting it); once invoiced, paid or
// voided it's locked. The Billing Queue enforces read-only on its side via the UI.
const EDITABLE_STATUSES = ['draft', 'pending_billing'];
const LOCKED_REASON = {
  invoiced: 'already invoiced',
  paid:     'already paid',
  voided:   'voided',
};
async function requireDraft(client, woId, res) {
  const { rows } = await client.query('SELECT status FROM work_orders WHERE id = $1', [woId]);
  if (!rows[0]) { res.status(404).json({ error: 'Not found.' }); return false; }
  if (!EDITABLE_STATUSES.includes(rows[0].status)) {
    const why = LOCKED_REASON[rows[0].status] ?? 'locked';
    res.status(409).json({ error: `This work order is locked (${why}).` });
    return false;
  }
  return true;
}

// Apply a net shared-inventory change for one inventory item: positive `delta`
// consumes stock (checkout), negative returns it. Best-effort over the one-way
// bridge - returns a warning string on failure (never throws), since inventory
// lives in a separate DB and must not roll back the work-order write.
async function adjustInventory(itemId, delta, actor, note) {
  if (!itemId || !delta || !isFieldConfigured()) return null;
  try {
    if (delta > 0) await fieldInventory.checkout(itemId, { quantity: delta, actor, notes: note });
    else           await fieldInventory.return(itemId, { quantity: -delta, actor, notes: note });
    return null;
  } catch (e) {
    return e.message || 'Could not update shared inventory.';
  }
}

// Move EVERY inventory-linked part on a work order at once, in one direction:
//   'return'  - put the parts back on the shelf (voiding a WO whose parts weren't used)
//   'consume' - take them off the shelf again (un-voiding that same WO)
// Only lines actually linked to a shared-inventory item move; hand-typed parts were
// never tracked in inventory, so there's nothing to give back for them.
// Best-effort like every other bridge call: returns a single warning string (never
// throws) so a Field App outage can't block or roll back the status change.
async function moveWholeWOInventory(woId, direction, actor, note) {
  const { rows } = await query(
    `SELECT inventory_item_id, SUM(quantity) AS qty
       FROM work_order_items
      WHERE work_order_id = $1 AND inventory_item_id IS NOT NULL
      GROUP BY inventory_item_id`,
    [woId]
  );
  const sign = direction === 'consume' ? 1 : -1;
  const warnings = [];
  for (const r of rows) {
    const qty = parseFloat(r.qty) || 0;
    if (!qty) continue;
    const w = await adjustInventory(r.inventory_item_id, sign * qty, actor, note);
    if (w) warnings.push(w);
  }
  return warnings.length ? warnings.join('; ') : null;
}

// Audit a change to a work order's contents (sections/items). `detail` describes
// what changed; the WO number is resolved for a readable entity name.
async function auditWO(req, woId, detail) {
  const { rows } = await query('SELECT number FROM work_orders WHERE id = $1', [woId]);
  const num = rows[0] ? `WO-${String(rows[0].number).padStart(5, '0')}` : 'work order';
  await logAudit({
    userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
    entityType: 'work_order', entityId: woId, entityName: `${num} — ${detail}`,
    ipAddress: getClientIp(req),
  });
}

// --- Work order list ----------------------------------------------------------

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, customerId, search, technicianId, needsFollowup, dateFrom, dateTo, sortBy, sortDir } = req.query;
    const { limit, offset } = parsePaging(req.query);
    // labor_total = Σ(section hours × effective rate) where effective rate is the
    // section override or the WO default; hardware_total = Σ(item totals).
    // The inner query produces all aliases; the outer SELECT * wraps it so ORDER BY
    // can reference those aliases (including arithmetic like labor_total + hardware_total)
    // without ambiguity - PostgreSQL resolves aliases reliably in the outer scope.
    let inner = `
      SELECT wo.id, wo.number, wo.status, wo.work_date, wo.needs_followup, wo.created_at, wo.submitted_at,
             wo.printed_submitted,
             c.name AS customer_name,
             -- Branch office the WO bills to (NULL = main office), named the way the
             -- WO detail page names it. has_branches lets a list say "Main office"
             -- only for customers that actually have more than one office.
             COALESCE(NULLIF(loc.label, ''), NULLIF(loc.business_name, ''), NULLIF(loc.address, ''),
                      CASE WHEN loc.id IS NOT NULL THEN 'Branch' END) AS location_name,
             EXISTS (SELECT 1 FROM customer_locations cl WHERE cl.customer_id = wo.customer_id) AS customer_has_branches,
             STRING_AGG(DISTINCT COALESCE(u.full_name, wot.name), ', ') AS technicians,
             COALESCE((
               SELECT SUM(s.hours * COALESCE(sr.rate, dr.rate, 0))
               FROM work_order_sections s
               LEFT JOIN customer_billing_rates sr ON sr.id = s.billing_rate_id
               LEFT JOIN customer_billing_rates dr ON dr.id = wo.billing_rate_id
               WHERE s.work_order_id = wo.id
             ), 0) AS labor_total,
             COALESCE((
               SELECT SUM(i.total_price) FROM work_order_items i WHERE i.work_order_id = wo.id
             ), 0) AS hardware_total,
             COALESCE((
               SELECT SUM(wop.price_excl_tax) FROM work_order_proposals wop WHERE wop.work_order_id = wo.id
             ), 0) AS proposals_total,
             COALESCE((
               SELECT SUM(s.hours) FROM work_order_sections s WHERE s.work_order_id = wo.id
             ), 0) AS labor_hours
      FROM work_orders wo
      JOIN customers c ON c.id = wo.customer_id
      LEFT JOIN customer_locations loc ON loc.id = wo.location_id
      LEFT JOIN work_order_technicians wot ON wot.work_order_id = wo.id
      LEFT JOIN users u ON u.id = wot.user_id
      WHERE 1=1
    `;
    const params = [];
    if (status)     { params.push(status);        inner += ` AND wo.status = $${params.length}`; }
    if (customerId) { params.push(customerId);    inner += ` AND wo.customer_id = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      // Match WO #, customer, branch, work descriptions/notes, and parts (name or P/N).
      inner += ` AND (
        c.name ILIKE ${p}
        OR loc.label ILIKE ${p} OR loc.business_name ILIKE ${p}
        OR CAST(wo.number AS TEXT) ILIKE ${p}
        OR EXISTS (SELECT 1 FROM work_order_sections s WHERE s.work_order_id = wo.id AND (s.description ILIKE ${p} OR s.internal_notes ILIKE ${p}))
        OR EXISTS (SELECT 1 FROM work_order_items i WHERE i.work_order_id = wo.id AND (i.description ILIKE ${p} OR i.part_number ILIKE ${p}))
      )`;
    }
    if (technicianId) {
      params.push(technicianId);
      // Use EXISTS so the main STRING_AGG join (which lists all techs) is unaffected.
      inner += ` AND EXISTS (SELECT 1 FROM work_order_technicians wt2 WHERE wt2.work_order_id = wo.id AND wt2.user_id = $${params.length})`;
    }
    // Inclusive work_date range - used by the customer export's date filter (and its
    // quick ranges). Either bound may be supplied independently.
    if (dateFrom) { params.push(dateFrom); inner += ` AND wo.work_date >= $${params.length}`; }
    if (dateTo)   { params.push(dateTo);   inner += ` AND wo.work_date <= $${params.length}`; }
    if (needsFollowup === '1' || needsFollowup === 'true') {
      // A WO needs follow-up if any of its sections is flagged. A voided WO is dead
      // work - it must not keep nagging from the dashboard's follow-up list.
      inner += ` AND wo.status <> 'voided'
                 AND EXISTS (SELECT 1 FROM work_order_sections s WHERE s.work_order_id = wo.id AND s.needs_followup = true)`;
    }
    inner += ' GROUP BY wo.id, c.name, loc.id';

    const SORTABLE = {
      number:        'number',
      customer_name: 'customer_name',
      location:      'location_name',
      work_date:     'work_date',
      status:        'status',
      technicians:   'technicians',
      total:         'labor_total + hardware_total + proposals_total',
    };
    const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderExpr = (sortBy && SORTABLE[sortBy])
      ? `${SORTABLE[sortBy]} ${safeDir} NULLS LAST, number DESC`
      : 'work_date DESC, number DESC';
    // Total matching rows (ignoring the page window) so the client can page through
    // everything and show an honest "showing N of M" instead of a silent cut-off.
    // The inner query groups by wo.id, so counting its rows counts work orders.
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM (${inner}) AS sub`, params);
    setTotalCount(res, countRows[0].total);

    const sql = `SELECT * FROM (${inner}) AS sub ORDER BY ${orderExpr} LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('draft','submitted','pending_billing')) AS open_work_orders,
        COUNT(*) FILTER (WHERE status = 'pending_billing')                        AS pending_billing,
        (SELECT COUNT(*) FROM customers WHERE is_active = true)                   AS active_customers
      FROM work_orders
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/work-orders/queue-summary - count + dollar total per billing status,
// over EVERY matching work order. The Billing Queue's summary cards read these:
// summing the rows the page happens to have loaded would understate the queue as
// soon as it pages, and the money on that card has to be the real number.
router.get('/queue-summary', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT wo.status,
             COUNT(*)::int AS count,
             COALESCE(SUM(
               COALESCE((
                 SELECT SUM(s.hours * COALESCE(sr.rate, dr.rate, 0))
                 FROM work_order_sections s
                 LEFT JOIN customer_billing_rates sr ON sr.id = s.billing_rate_id
                 LEFT JOIN customer_billing_rates dr ON dr.id = wo.billing_rate_id
                 WHERE s.work_order_id = wo.id
               ), 0)
               + COALESCE((SELECT SUM(i.total_price)      FROM work_order_items i     WHERE i.work_order_id = wo.id), 0)
               + COALESCE((SELECT SUM(p.price_excl_tax)   FROM work_order_proposals p WHERE p.work_order_id = wo.id), 0)
             ), 0) AS total
      FROM work_orders wo
      WHERE wo.status IN ('pending_billing','invoiced','paid')
      GROUP BY wo.status
    `);
    const byStatus = Object.fromEntries(
      rows.map((r) => [r.status, { count: r.count, total: Number(r.total) }])
    );
    const empty = { count: 0, total: 0 };
    res.json({
      pending_billing: byStatus.pending_billing ?? empty,
      invoiced:        byStatus.invoiced        ?? empty,
      paid:            byStatus.paid            ?? empty,
    });
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const wo = await getFullWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Work order not found.' });
    res.json(wo);
  } catch (err) { next(err); }
});

// --- Create (seeds one section) ------------------------------------------------

router.post('/', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    const { customer_id, description, internal_notes, location_id } = req.body ?? {};
    // NB: no client.release() on these early returns - the `finally` below already
    // releases, and releasing twice throws "Release called on client which has already
    // been released to the pool" from inside the finally, after the response is sent.
    if (!customer_id) return res.status(400).json({ error: 'customer_id is required.' });
    const dates = coerceDateFields(req.body ?? {}, ['work_date']);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    const work_date = dates.values.work_date ?? null;

    await client.query('BEGIN');
    const defaultRateId = await findDefaultRateId(client, customer_id);

    const { rows } = await client.query(
      `INSERT INTO work_orders (customer_id, work_date, billing_rate_id, location_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, number`,
      [customer_id, work_date || new Date(), defaultRateId, location_id || null, req.user.sub]
    );
    const { rows: seedSection } = await client.query(
      `INSERT INTO work_order_sections (work_order_id, sort_order, work_date, description, internal_notes)
       VALUES ($1, 10, $2, $3, $4) RETURNING id`,
      [rows[0].id, work_date || new Date(), description || null, internal_notes || null]
    );
    // Pre-assign the creator as a technician on the first section (billers excluded).
    if (req.user.role !== 'biller') {
      await client.query(
        'INSERT INTO work_order_technicians (work_order_id, section_id, user_id) VALUES ($1, $2, $3)',
        [rows[0].id, seedSection[0].id, req.user.sub]
      );
    }
    await client.query('COMMIT');

    const wo = await getFullWO(rows[0].id);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'work_order', entityId: wo.id, entityName: `WO-${String(wo.number).padStart(5, '0')}`,
      ipAddress: getClientIp(req) });
    res.status(201).json(wo);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- Update WO-level fields (date, default rate) - draft only -------------------

router.patch('/:id', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }

    const fields = ['billing_rate_id', 'location_id'];
    const updates = { updated_at: new Date() };
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f] || null; }
    const dates = coerceDateFields(req.body, ['work_date']);
    if (!dates.ok) { await client.query('ROLLBACK'); return res.status(400).json({ error: dates.error }); }
    Object.assign(updates, dates.values);
    if (Object.keys(updates).length > 1) {
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE work_orders SET ${setClauses} WHERE id = $1`, [req.params.id, ...Object.values(updates)]);
    }
    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'details updated');
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- Sections -----------------------------------------------------------------

router.post('/:id/sections', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { rows: max } = await client.query(
      `SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM work_order_sections WHERE work_order_id = $1`,
      [req.params.id]
    );
    // Optional prefill (used when linking a backlog item / customer to-do into a WO):
    // description → Work Performed, internal_notes → Internal Notes.
    const description = req.body?.description?.trim() || null;
    const internalNotes = req.body?.internal_notes?.trim() || null;
    const { rows: newSection } = await client.query(
      `INSERT INTO work_order_sections (work_order_id, sort_order, work_date, description, internal_notes)
       VALUES ($1, $2, CURRENT_DATE, $3, $4) RETURNING id`,
      [req.params.id, max[0].next, description, internalNotes]
    );
    // Pre-assign the signed-in user as a technician on the new section (billers don't
    // appear in the tech picker, so they're skipped). Fully editable afterward.
    if (req.user.role !== 'biller') {
      await client.query(
        'INSERT INTO work_order_technicians (work_order_id, section_id, user_id) VALUES ($1, $2, $3)',
        [req.params.id, newSection[0].id, req.user.sub]
      );
    }
    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'work section added');
    res.status(201).json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.patch('/:id/sections/:sectionId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }

    const fields = ['description', 'hours', 'billing_rate_id',
                    'travel_minutes', 'is_remote', 'needs_followup', 'followup_notes', 'internal_notes',
                    'linked_proposal_id', 'proposal_estimated_hours', 'proposal_total'];
    const updates = { updated_at: new Date() };
    for (const f of fields) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    const dates = coerceDateFields(req.body, ['work_date']);
    if (!dates.ok) { await client.query('ROLLBACK'); return res.status(400).json({ error: dates.error }); }
    Object.assign(updates, dates.values);
    if (updates.billing_rate_id === '') updates.billing_rate_id = null;
    if (updates.hours === '') updates.hours = null;
    if (updates.linked_proposal_id === '') updates.linked_proposal_id = null;
    if (updates.proposal_estimated_hours === '') updates.proposal_estimated_hours = null;
    if (updates.proposal_total === '') updates.proposal_total = null;

    if (Object.keys(updates).length > 1) {
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
      const { rows } = await client.query(
        `UPDATE work_order_sections SET ${setClauses} WHERE id = $1 AND work_order_id = $2 RETURNING id`,
        [req.params.sectionId, req.params.id, ...Object.values(updates)]
      );
      if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Section not found.' }); }
    }

    // Linked (Portal user) and free-typed technicians are managed independently so
    // toggling one kind never wipes the other.
    if (Array.isArray(req.body.technician_ids)) {
      await client.query('DELETE FROM work_order_technicians WHERE section_id = $1 AND user_id IS NOT NULL', [req.params.sectionId]);
      for (const uid of req.body.technician_ids) {
        await client.query(
          'INSERT INTO work_order_technicians (work_order_id, section_id, user_id) VALUES ($1, $2, $3)',
          [req.params.id, req.params.sectionId, uid]
        );
      }
    }
    if (Array.isArray(req.body.free_technicians)) {
      await client.query('DELETE FROM work_order_technicians WHERE section_id = $1 AND user_id IS NULL', [req.params.sectionId]);
      for (const raw of req.body.free_technicians) {
        const name = (raw || '').trim();
        if (!name) continue;
        await client.query(
          'INSERT INTO work_order_technicians (work_order_id, section_id, user_id, name) VALUES ($1, $2, NULL, $3)',
          [req.params.id, req.params.sectionId, name]
        );
      }
    }

    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'work section edited');
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.delete('/:id/sections/:sectionId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { rows: count } = await client.query(
      'SELECT COUNT(*)::int AS n FROM work_order_sections WHERE work_order_id = $1', [req.params.id]
    );
    if (count[0].n <= 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A work order needs at least one section.' }); }
    await client.query('DELETE FROM work_order_sections WHERE id = $1 AND work_order_id = $2', [req.params.sectionId, req.params.id]);
    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'work section removed');
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- Status transitions -------------------------------------------------------

// Move a WO between billing statuses. `setField` stamps a timestamp (forward moves);
// `clearField` nulls one (reversals, so the work order is no longer marked invoiced or
// paid). Both are optional. The guard (WHERE status = from) makes double-clicks safe.
async function transition(req, res, next, { from, to, setField = null, clearField = null, verb }) {
  try {
    const update = { status: to, updated_at: new Date() };
    if (setField) update[setField] = new Date();
    let setClauses = Object.keys(update).map((k, i) => `${k} = $${i + 2}`).join(', ');
    if (clearField) setClauses += `, ${clearField} = NULL`;
    const { rows } = await query(
      `UPDATE work_orders SET ${setClauses} WHERE id = $1 AND status = $${Object.keys(update).length + 2} RETURNING number`,
      [req.params.id, ...Object.values(update), from]
    );
    if (!rows[0]) return res.status(409).json({ error: `Work order must be in '${from}' status.` });
    const wo = await getFullWO(req.params.id);
    // Billing actions are audited with an explicit verb so the biller can read the trail.
    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'UPDATE', entityType: 'work_order', entityId: req.params.id,
      entityName: `WO-${String(wo.number).padStart(5, '0')} — ${verb}`, ipAddress: getClientIp(req) });
    res.json(wo);
  } catch (err) { next(err); }
}

// All staff manage billing the same way (per the unified-roles decision).
router.post('/:id/submit',  requireAuth, (req, res, next) => transition(req, res, next, { from: 'draft',           to: 'pending_billing', setField: 'submitted_at', verb: 'submitted to billing' }));
router.post('/:id/invoice', requireAuth, (req, res, next) => transition(req, res, next, { from: 'pending_billing', to: 'invoiced',        setField: 'invoiced_at',  verb: 'marked invoiced' }));
router.post('/:id/pay',     requireAuth, (req, res, next) => transition(req, res, next, { from: 'invoiced',        to: 'paid',            setField: 'paid_at',      verb: 'marked paid' }));

// Reverse transitions - undo an accidental/incorrect billing move. Each clears the
// timestamp it's undoing and is audited with an unmistakable verb.
router.post('/:id/revert-invoice', requireAuth, (req, res, next) => transition(req, res, next, { from: 'invoiced', to: 'pending_billing', clearField: 'invoiced_at', verb: 'reverted invoiced → pending billing' }));
router.post('/:id/revert-pay',     requireAuth, (req, res, next) => transition(req, res, next, { from: 'paid',     to: 'invoiced',        clearField: 'paid_at',     verb: 'reverted paid → invoiced' }));

// --- Void / un-void -----------------------------------------------------------
//
// Voiding takes a work order OUT of the Billing Queue without destroying it: the WO
// keeps its number, sections, parts and photos and stays on the Work Orders list as a
// record. Only a Pending Billing WO can be voided - an invoiced one has to be walked
// back with "Back to Pending" first, so a voided WO never carries a stale invoiced_at.
//
// The caller chooses what happens to the parts:
//   return_inventory = false → inventory is left exactly as-is (the parts really were
//                              used/consumed; only the billing is being cancelled)
//   return_inventory = true  → every inventory-linked part goes back on the shelf
//                              (the job never happened, the gear came back)
// `inventory_returned` records which way it went so un-void mirrors it exactly.
router.post('/:id/void', requireAuth, async (req, res, next) => {
  try {
    const returnInventory = req.body?.return_inventory === true || req.body?.return_inventory === 'true';
    const reason = req.body?.reason?.trim() || null;

    const { rows } = await query(
      `UPDATE work_orders
          SET status = 'voided', voided_at = NOW(), void_reason = $2,
              inventory_returned = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'pending_billing'
        RETURNING number`,
      [req.params.id, reason, returnInventory]
    );
    if (!rows[0]) return res.status(409).json({ error: "Only work orders in 'Pending Billing' can be voided." });
    const num = `WO-${String(rows[0].number).padStart(5, '0')}`;

    // Give the parts back only after the status change committed - the shared
    // inventory lives in the Field App's DB and can't participate in this transaction.
    const inventoryWarning = returnInventory
      ? await moveWholeWOInventory(req.params.id, 'return', req.user.fullName, `${num} voided — parts returned`)
      : null;

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id,
      entityName: `${num} — voided${returnInventory ? ' (parts returned to inventory)' : ' (inventory left as-is)'}`,
      changes: { status: { from: 'pending_billing', to: 'voided' },
                 return_inventory: returnInventory,
                 ...(reason ? { void_reason: reason } : {}) },
      ipAddress: getClientIp(req) });

    res.json({ ...(await getFullWO(req.params.id)), inventory_warning: inventoryWarning });
  } catch (err) { next(err); }
});

// Undo a void - back to Pending Billing, the status it must have come from. If the
// void put parts back on the shelf, this takes exactly those quantities off again, so
// the two moves always net to zero. The `inventory_returned` flag is what keeps that
// honest: it's cleared here, so a second un-void can't double-consume.
router.post('/:id/unvoid', requireAuth, async (req, res, next) => {
  try {
    // RETURNING yields the NEW row, but what matters here is the OLD
    // inventory_returned - did the void hand the parts back? Joining the pre-update
    // row in via FROM reads it without a separate round trip losing atomicity.
    const { rows } = await query(
      `UPDATE work_orders wo
          SET status = 'pending_billing', voided_at = NULL, void_reason = NULL,
              inventory_returned = false, updated_at = NOW()
         FROM (SELECT id, inventory_returned FROM work_orders WHERE id = $1) prev
        WHERE wo.id = prev.id AND wo.status = 'voided'
        RETURNING wo.number, prev.inventory_returned AS was_returned`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'This work order is not voided.' });
    const num = `WO-${String(rows[0].number).padStart(5, '0')}`;

    const inventoryWarning = rows[0].was_returned
      ? await moveWholeWOInventory(req.params.id, 'consume', req.user.fullName, `${num} un-voided — parts taken back out`)
      : null;

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id,
      entityName: `${num} — un-voided → pending billing${rows[0].was_returned ? ' (parts re-consumed)' : ''}`,
      changes: { status: { from: 'voided', to: 'pending_billing' } },
      ipAddress: getClientIp(req) });

    res.json({ ...(await getFullWO(req.params.id)), inventory_warning: inventoryWarning });
  } catch (err) { next(err); }
});

// Toggle the "printed & submitted" flag. Allowed in ANY status (a WO may be printed and
// submitted whether it's pending, invoiced, or paid), so it lives outside the status
// transitions. Audit-logged either way.
router.post('/:id/printed-submitted', requireAuth, async (req, res, next) => {
  try {
    const value = !!req.body?.printed_submitted;
    const { rows } = await query(
      `UPDATE work_orders SET printed_submitted = $2, updated_at = NOW() WHERE id = $1 RETURNING number`,
      [req.params.id, value]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Work order not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id,
      entityName: `WO-${String(rows[0].number).padStart(5, '0')} — ${value ? 'marked' : 'unmarked'} printed & submitted`,
      ipAddress: getClientIp(req) });
    res.json(await getFullWO(req.params.id));
  } catch (err) { next(err); }
});

// Clear the follow-up flag on every section of a WO. Unlike section edits this is
// allowed in ANY status - a follow-up can be completed long after the WO is invoiced
// or paid, so the flag must be clearable then too (otherwise it sticks forever).
router.post('/:id/resolve-followup', requireAuth, async (req, res, next) => {
  try {
    const { rows: wo } = await query('SELECT number FROM work_orders WHERE id = $1', [req.params.id]);
    if (!wo[0]) return res.status(404).json({ error: 'Work order not found.' });
    await query(
      `UPDATE work_order_sections SET needs_followup = false, updated_at = NOW()
       WHERE work_order_id = $1 AND needs_followup = true`,
      [req.params.id]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'work_order', entityId: req.params.id,
      entityName: `WO-${String(wo[0].number).padStart(5, '0')} — follow-up resolved`, ipAddress: getClientIp(req) });
    res.json(await getFullWO(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM work_orders WHERE id = $1 AND status = 'draft' RETURNING number`, [req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: 'Only draft work orders can be deleted.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'work_order', entityId: req.params.id,
      entityName: `WO-${String(rows[0].number).padStart(5, '0')}`, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --- Line items (scoped to a section) ------------------------------------------

router.post('/:id/sections/:sectionId/items', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { description, quantity = 1, unit_price, total_price, part_number, inventory_item_id } = req.body ?? {};
    if (!description?.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'description is required.' }); }
    const qty = parseFloat(quantity) || 1;
    const up  = unit_price  != null && unit_price  !== '' ? parseFloat(unit_price)  : null;
    const tp  = total_price != null && total_price !== '' ? parseFloat(total_price) : (up != null ? up * qty : null);
    await client.query(
      `INSERT INTO work_order_items (work_order_id, section_id, description, quantity, unit_price, total_price, part_number, inventory_item_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, req.params.sectionId, description.trim(), qty, up, tp, part_number || null, inventory_item_id ?? null]
    );
    await client.query('COMMIT');

    // Linked line → consume that quantity from shared inventory (after commit;
    // inventory is a separate DB and a bridge failure must not undo the WO line).
    const inventoryWarning = await adjustInventory(
      inventory_item_id, qty, req.user.fullName, `WO part added: ${description.trim()}`
    );
    await auditWO(req, req.params.id, `part added: ${description.trim()} ×${qty}`);

    const wo = await getFullWO(req.params.id);
    res.status(201).json({ ...wo, inventory_warning: inventoryWarning });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.patch('/:id/items/:itemId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }

    // Snapshot the line before editing so we can reconcile shared inventory.
    const { rows: before } = await client.query(
      'SELECT inventory_item_id, quantity, description FROM work_order_items WHERE id = $1 AND work_order_id = $2',
      [req.params.itemId, req.params.id]
    );
    if (!before[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }

    // NB: work_order_items has no updated_at column (unlike work_order_sections),
    // so don't seed one here - referencing it made every part edit fail.
    const updates = {};
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.quantity    !== undefined) updates.quantity    = parseFloat(req.body.quantity) || 1;
    if (req.body.unit_price   !== undefined) updates.unit_price  = (req.body.unit_price === '' || req.body.unit_price == null) ? null : parseFloat(req.body.unit_price);
    if (req.body.total_price  !== undefined) updates.total_price = (req.body.total_price === '' || req.body.total_price == null) ? null : parseFloat(req.body.total_price);
    if (req.body.part_number  !== undefined) updates.part_number = req.body.part_number || null;
    if (req.body.inventory_item_id !== undefined) updates.inventory_item_id = req.body.inventory_item_id || null;

    let rows;
    if (Object.keys(updates).length) {
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
      ({ rows } = await client.query(
        `UPDATE work_order_items SET ${setClauses} WHERE id = $1 AND work_order_id = $2 RETURNING *`,
        [req.params.itemId, req.params.id, ...Object.values(updates)]
      ));
    } else {
      ({ rows } = await client.query(
        'SELECT * FROM work_order_items WHERE id = $1 AND work_order_id = $2',
        [req.params.itemId, req.params.id]
      ));
    }
    await client.query('COMMIT');

    // Reconcile shared inventory: return what the old linked item consumed, then
    // consume what the new one does. If the item link is unchanged, this nets to
    // the qty difference. Two separate calls when the linked item itself changed.
    const oldId = before[0].inventory_item_id;
    const oldQty = parseFloat(before[0].quantity) || 0;
    const newId = rows[0].inventory_item_id;
    const newQty = parseFloat(rows[0].quantity) || 0;
    const actor = req.user.fullName;
    const label = rows[0].description || before[0].description || 'WO part';
    let inventoryWarning = null;
    if (oldId && oldId === newId) {
      inventoryWarning = await adjustInventory(newId, newQty - oldQty, actor, `WO part edited: ${label}`);
    } else {
      const w1 = await adjustInventory(oldId, -oldQty, actor, `WO part changed (returned): ${label}`);
      const w2 = await adjustInventory(newId,  newQty, actor, `WO part changed (added): ${label}`);
      inventoryWarning = w1 || w2;
    }
    await auditWO(req, req.params.id, `part edited: ${label}`);

    res.json({ ...(await getFullWO(req.params.id)), inventory_warning: inventoryWarning });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.delete('/:id/items/:itemId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { rows: deleted } = await client.query(
      'DELETE FROM work_order_items WHERE id = $1 AND work_order_id = $2 RETURNING inventory_item_id, quantity, description',
      [req.params.itemId, req.params.id]
    );
    await client.query('COMMIT');

    // Deleting a linked line returns its quantity to shared inventory.
    let inventoryWarning = null;
    if (deleted[0]) {
      inventoryWarning = await adjustInventory(
        deleted[0].inventory_item_id, -(parseFloat(deleted[0].quantity) || 0),
        req.user.fullName, `WO part removed: ${deleted[0].description || 'part'}`
      );
      await auditWO(req, req.params.id, `part removed: ${deleted[0].description || 'part'}`);
    }
    res.json({ ...(await getFullWO(req.params.id)), inventory_warning: inventoryWarning });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- Services (scoped to a section) ---------------------------------------------
// Sibling to line items. One-time fees and recurring charges (365, backups, etc.).

const RECURRENCES = ['monthly', 'quarterly', 'semiannual', 'annual'];

function normalizeService(body) {
  const billing_type = body.billing_type === 'recurring' ? 'recurring' : 'one_time';
  let recurrence = null;
  if (billing_type === 'recurring') {
    recurrence = RECURRENCES.includes(body.recurrence) ? body.recurrence : 'monthly';
  }
  // How many periods between bills - 3 for something sold three years at a time.
  // Forced back to 1 for one-time services and any non-annual period.
  const recurrence_count = billing_type === 'recurring'
    ? coerceIntervalCount(body.recurrence_count, recurrence)
    : 1;
  const qty = parseFloat(body.quantity) || 1;
  const up  = body.unit_price  != null && body.unit_price  !== '' ? parseFloat(body.unit_price)  : null;
  const tp  = body.total_price != null && body.total_price !== '' ? parseFloat(body.total_price) : (up != null ? up * qty : null);
  return { billing_type, recurrence, recurrence_count, qty, up, tp };
}

router.post('/:id/sections/:sectionId/services', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { description, notes } = req.body ?? {};
    if (!description?.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'description is required.' }); }
    const { billing_type, recurrence, recurrence_count, qty, up, tp } = normalizeService(req.body ?? {});
    await client.query(
      `INSERT INTO work_order_services (work_order_id, section_id, description, quantity, unit_price, total_price, billing_type, recurrence, recurrence_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [req.params.id, req.params.sectionId, description.trim(), qty, up, tp, billing_type, recurrence, recurrence_count, notes || null]
    );
    await client.query('COMMIT');
    await auditWO(req, req.params.id, `service added: ${description.trim()}`);
    res.status(201).json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.patch('/:id/services/:serviceId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }

    const updates = {};
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.notes       !== undefined) updates.notes = req.body.notes || null;
    if (req.body.billing_type !== undefined || req.body.recurrence !== undefined
        || req.body.recurrence_count !== undefined
        || req.body.quantity !== undefined || req.body.unit_price !== undefined || req.body.total_price !== undefined) {
      const { billing_type, recurrence, recurrence_count, qty, up, tp } = normalizeService(req.body ?? {});
      updates.billing_type     = billing_type;
      updates.recurrence       = recurrence;
      updates.recurrence_count = recurrence_count;
      updates.quantity         = qty;
      updates.unit_price       = up;
      updates.total_price      = tp;
    }
    if (!Object.keys(updates).length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nothing to update.' }); }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await client.query(
      `UPDATE work_order_services SET ${setClauses} WHERE id = $1 AND work_order_id = $2 RETURNING description`,
      [req.params.serviceId, req.params.id, ...Object.values(updates)]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Service not found.' }); }
    await client.query('COMMIT');
    await auditWO(req, req.params.id, `service edited: ${rows[0].description}`);
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.delete('/:id/services/:serviceId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { rows } = await client.query(
      'DELETE FROM work_order_services WHERE id = $1 AND work_order_id = $2 RETURNING description',
      [req.params.serviceId, req.params.id]
    );
    await client.query('COMMIT');
    if (rows[0]) await auditWO(req, req.params.id, `service removed: ${rows[0].description}`);
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// --- WO-level proposals ---------------------------------------------------------

router.post('/:id/wo-proposals', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { proposal_file_id, price_excl_tax } = req.body ?? {};
    const { rows: max } = await client.query(
      `SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM work_order_proposals WHERE work_order_id = $1`,
      [req.params.id]
    );
    await client.query(
      `INSERT INTO work_order_proposals (work_order_id, proposal_file_id, price_excl_tax, sort_order)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, proposal_file_id || null,
       price_excl_tax != null && price_excl_tax !== '' ? parseFloat(price_excl_tax) : null,
       max[0].next]
    );
    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'proposal linked');
    res.status(201).json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.patch('/:id/wo-proposals/:propId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    const { price_excl_tax } = req.body ?? {};
    const price = price_excl_tax === '' || price_excl_tax == null ? null : parseFloat(price_excl_tax);
    const { rows } = await client.query(
      `UPDATE work_order_proposals SET price_excl_tax = $1 WHERE id = $2 AND work_order_id = $3 RETURNING id`,
      [price, req.params.propId, req.params.id]
    );
    await client.query('COMMIT');
    if (!rows[0]) return res.status(404).json({ error: 'Proposal link not found.' });
    await auditWO(req, req.params.id, 'proposal price updated');
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.delete('/:id/wo-proposals/:propId', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await requireDraft(client, req.params.id, res))) { await client.query('ROLLBACK'); return; }
    await client.query(
      `DELETE FROM work_order_proposals WHERE id = $1 AND work_order_id = $2`,
      [req.params.propId, req.params.id]
    );
    await client.query('COMMIT');
    await auditWO(req, req.params.id, 'proposal unlinked');
    res.json(await getFullWO(req.params.id));
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

export default router;
