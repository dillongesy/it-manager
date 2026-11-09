import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/search?q=term
// Searches across customers, work orders, tasks, devices, credentials, and files.
// Credentials return only label/category - never passwords.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const raw = req.query.q?.trim() ?? '';
    if (raw.length < 2) {
      return res.json({ customers: [], work_orders: [], tasks: [], devices: [], credentials: [], files: [] });
    }
    const t = `%${raw}%`;

    const taskNumber = raw.match(/^(?:t-?)?0*(d{1,7})$/i);

    const [customers, workOrders, tasks, devices, credentials, files] = await Promise.all([

      query(`
        SELECT id, name, city, state, phone
        FROM customers
        WHERE is_active = true
          AND (name ILIKE $1 OR city ILIKE $1 OR phone ILIKE $1)
        ORDER BY name LIMIT 6
      `, [t]),

      query(`
        SELECT DISTINCT wo.id, wo.number, wo.status, wo.work_date,
               c.id AS customer_id, c.name AS customer_name
        FROM work_orders wo
        JOIN customers c ON c.id = wo.customer_id
        WHERE CAST(wo.number AS TEXT) ILIKE $1
           OR c.name ILIKE $1
           OR EXISTS (SELECT 1 FROM work_order_sections s
                      WHERE s.work_order_id = wo.id
                        AND (s.description ILIKE $1 OR s.internal_notes ILIKE $1))
           OR EXISTS (SELECT 1 FROM work_order_items i
                      WHERE i.work_order_id = wo.id
                        AND (i.description ILIKE $1 OR i.part_number ILIKE $1))
        ORDER BY wo.work_date DESC LIMIT 6
      `, [t]),

      // Tasks: title / caller / customer, or the task number ("T-00012", "12"). Open ones first.
      query(`
        SELECT tk.id, tk.number, tk.title, tk.status, tk.priority,
               c.id AS customer_id, c.name AS customer_name
        FROM tasks tk
        LEFT JOIN customers c ON c.id = tk.customer_id
        WHERE tk.title ILIKE $1 OR tk.requested_by ILIKE $1 OR c.name ILIKE $1
           OR ($2::int IS NOT NULL AND tk.number = $2::int)
        ORDER BY (tk.status = 'done'), tk.updated_at DESC LIMIT 6
      `, [t, taskNumber ? Number(taskNumber[1]) : null]),

      query(`
        SELECT cd.id, cd.device_type, cd.label, cd.model, cd.computer_name, cd.assigned_to,
               c.id AS customer_id, c.name AS customer_name
        FROM customer_devices cd
        JOIN customers c ON c.id = cd.customer_id
        WHERE cd.label ILIKE $1
           OR cd.model ILIKE $1
           OR cd.computer_name ILIKE $1
           OR cd.assigned_to ILIKE $1
           OR cd.service_tag ILIKE $1
        ORDER BY c.name, cd.label LIMIT 6
      `, [t]),

      query(`
        SELECT cc.id, cc.category, cc.label, cc.username,
               c.id AS customer_id, c.name AS customer_name
        FROM customer_credentials cc
        JOIN customers c ON c.id = cc.customer_id
        WHERE cc.label ILIKE $1
           OR cc.category ILIKE $1
           OR cc.username ILIKE $1
        ORDER BY c.name, cc.label LIMIT 6
      `, [t]),

      query(`
        SELECT cf.id, cf.original_name, cf.category, cf.created_at,
               c.id AS customer_id, c.name AS customer_name
        FROM customer_files cf
        JOIN customers c ON c.id = cf.customer_id
        WHERE cf.original_name ILIKE $1
        ORDER BY cf.created_at DESC LIMIT 6
      `, [t]),

    ]);

    res.json({
      customers:   customers.rows,
      work_orders: workOrders.rows,
      tasks:       tasks.rows,
      devices:     devices.rows,
      credentials: credentials.rows,
      files:       files.rows,
    });
  } catch (err) { next(err); }
});

export default router;
