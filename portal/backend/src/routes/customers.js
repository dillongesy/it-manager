import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { parsePaging, setTotalCount } from '../lib/pagination.js';

const router = Router();

// Billing rates seeded on every new customer: [label, hourly rate], in display order.
// Negotiated per-customer rates are edited on the customer's Overview tab afterwards.
const DEFAULT_RATES = [
  ['Standard', 90.00],
  ['Tech',     70.00],
];

// GET /api/customers — list with search
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { search, sortBy, sortDir } = req.query;
    const { limit, offset } = parsePaging(req.query);

    let inner = `
      SELECT c.id, c.name, c.address, c.city, c.state, c.phone, c.is_active, c.updated_at,
             COUNT(wo.id) FILTER (WHERE wo.status NOT IN ('invoiced','paid','voided')) AS open_work_orders
      FROM customers c
      LEFT JOIN work_orders wo ON wo.customer_id = c.id
      WHERE c.is_active = true
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      inner += ` AND (c.name ILIKE $${params.length} OR c.city ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }

    inner += ' GROUP BY c.id';

    const SORTABLE = {
      name:             'name',
      city:             'city',
      phone:            'phone',
      open_work_orders: 'open_work_orders',
    };
    const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderExpr = (sortBy && SORTABLE[sortBy])
      ? `${SORTABLE[sortBy]} ${safeDir} NULLS LAST`
      : 'name ASC';

    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM (${inner}) AS sub`, params);
    setTotalCount(res, countRows[0].total);

    const sql = `SELECT * FROM (${inner}) AS sub ORDER BY ${orderExpr} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id — full record
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [customerRes, contactsRes, locationsRes, ratesRes] = await Promise.all([
      query('SELECT * FROM customers WHERE id = $1', [req.params.id]),
      query('SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY sort_order, is_primary DESC, name', [req.params.id]),
      query('SELECT * FROM customer_locations WHERE customer_id = $1', [req.params.id]),
      query('SELECT * FROM customer_billing_rates WHERE customer_id = $1 ORDER BY sort_order, label', [req.params.id]),
    ]);

    if (!customerRes.rows[0]) return res.status(404).json({ error: 'Customer not found.' });

    res.json({
      ...customerRes.rows[0],
      contacts: contactsRes.rows,
      locations: locationsRes.rows,
      billing_rates: ratesRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/customers
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, address, city, state, zip, phone, notes, wan_ip, firewall_link } = req.body ?? {};

    if (!name?.trim()) return res.status(400).json({ error: 'Customer name is required.' });

    const { rows } = await query(
      `INSERT INTO customers (name, address, city, state, zip, phone, notes, wan_ip, firewall_link, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [name.trim(), address, city, state, zip, phone, notes, wan_ip, firewall_link, req.user.sub]
    );

    // Every new customer starts with the house rates, in this order. Either can be
    // renamed/re-priced per customer afterwards, and more can be added — this is just
    // the starting point so nobody has to type them for every new account.
    // "Standard" keeps its name deliberately: work-order creation looks up
    // LOWER(label) = 'standard' for a new WO's default rate.
    for (const [i, [label, rate]] of DEFAULT_RATES.entries()) {
      await query(
        `INSERT INTO customer_billing_rates (customer_id, label, rate, sort_order) VALUES ($1, $2, $3, $4)`,
        [rows[0].id, label, rate, (i + 1) * 10]
      );
    }

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'CREATE',
      entityType: 'customer',
      entityId: rows[0].id,
      entityName: rows[0].name,
      ipAddress: getClientIp(req),
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id
router.patch('/:id', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: before } = await client.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!before[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const fields = ['name', 'address', 'city', 'state', 'zip', 'phone', 'notes', 'wan_ip', 'firewall_link', 'is_active',
                     'billing_contact_name', 'billing_contact_email', 'billing_contact_phone'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (Object.keys(updates).length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    updates.updated_at = new Date();
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await client.query(
      `UPDATE customers SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...Object.values(updates)]
    );

    const changes = {};
    for (const key of Object.keys(updates)) {
      if (key === 'updated_at') continue;
      if (String(before[0][key]) !== String(updates[key])) {
        changes[key] = { old: before[0][key], new: updates[key] };
      }
    }

    await client.query('COMMIT');

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'UPDATE',
      entityType: 'customer',
      entityId: req.params.id,
      entityName: rows[0].name,
      changes,
      ipAddress: getClientIp(req),
    });

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/customers/:id — soft delete
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE customers SET is_active = false, updated_at = NOW()
       WHERE id = $1 RETURNING name`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Customer not found.' });

    await logAudit({
      userId: req.user.sub,
      userName: req.user.fullName,
      action: 'DELETE',
      entityType: 'customer',
      entityId: req.params.id,
      entityName: rows[0].name,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
