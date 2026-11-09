import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/recurring-charges/active - every active recurring charge across active
// customers, joined with the customer name. The dashboard aggregates these client-side
// (per-customer totals + upcoming-in-N-months) reusing utils/recurring.js, so the
// next-due month logic isn't duplicated server-side. The dataset is small (internal
// MSP), so returning them all in one shot is fine.
router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT rc.id, rc.customer_id, rc.description, rc.category, rc.amount,
              rc.quantity, rc.unit_price, rc.unit_label, rc.frequency, rc.interval_count,
              rc.billing_month, rc.billing_year,
              c.name AS customer_name
       FROM customer_recurring_charges rc
       JOIN customers c ON c.id = rc.customer_id AND c.is_active = true
       WHERE rc.is_active = true
       ORDER BY c.name, rc.description`,
      []
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
