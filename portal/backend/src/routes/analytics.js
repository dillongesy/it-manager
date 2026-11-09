import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// Last 8 ISO weeks (Postgres date_trunc('week') = Monday).
const SINCE = `date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks'`;
const wkKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// GET /api/analytics - weekly trends + a status snapshot, each with a `company` and a
// `personal` (logged-in user) series so the dashboard's scope toggle is instant.
//  - hours:        Σ section hours by section work_date week (personal = sections the user is a tech on)
//  - woSubmitted:  count of WOs entering billing (submitted_at) per week (personal = user is a tech)
//  - orders:       order-log entries placed per week (personal = created_by user)
//  - spend:        Σ order line-item total_cost per week (personal = orders the user created)
//  - status:       current WO counts by status (snapshot)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const uid = req.user.sub;

    const weeksRes = await query(
      `SELECT generate_series(${SINCE}, date_trunc('week', CURRENT_DATE), INTERVAL '1 week')::date AS wk`
    );
    const weeks = weeksRes.rows.map(r => wkKey(r.wk));

    // Per-WO grand total (labor + parts + proposals + one-time services), with a flag
    // for whether the logged-in user is a tech on it. Reused for billed & collected.
    const woTotalsCTE = `
      WITH t AS (
        SELECT wo.id, wo.invoiced_at, wo.paid_at,
               EXISTS (SELECT 1 FROM work_order_technicians wt WHERE wt.work_order_id = wo.id AND wt.user_id = $1) AS mine,
               ( COALESCE((SELECT SUM(s.hours * COALESCE(sr.rate, dr.rate, 0))
                           FROM work_order_sections s
                           LEFT JOIN customer_billing_rates sr ON sr.id = s.billing_rate_id
                           LEFT JOIN customer_billing_rates dr ON dr.id = wo.billing_rate_id
                           WHERE s.work_order_id = wo.id), 0)
                 + COALESCE((SELECT SUM(i.total_price) FROM work_order_items i WHERE i.work_order_id = wo.id), 0)
                 + COALESCE((SELECT SUM(wp.price_excl_tax) FROM work_order_proposals wp WHERE wp.work_order_id = wo.id), 0)
                 + COALESCE((SELECT SUM(sv.total_price) FROM work_order_services sv WHERE sv.work_order_id = wo.id AND sv.billing_type = 'one_time'), 0)
               ) AS total
        FROM work_orders wo
      )`;

    const [hoursRes, woRes, ordersRes, statusRes, billedRes, collectedRes] = await Promise.all([
      query(
        `SELECT date_trunc('week', s.work_date)::date AS wk,
                COALESCE(SUM(s.hours),0) AS company,
                COALESCE(SUM(s.hours) FILTER (
                  WHERE EXISTS (SELECT 1 FROM work_order_technicians wt WHERE wt.section_id = s.id AND wt.user_id = $1)
                ),0) AS personal
         FROM work_order_sections s
         WHERE s.work_date >= ${SINCE} AND s.work_date IS NOT NULL
         GROUP BY wk`, [uid]
      ),
      query(
        `SELECT date_trunc('week', wo.submitted_at)::date AS wk,
                COUNT(*) AS company,
                COUNT(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM work_order_technicians wt WHERE wt.work_order_id = wo.id AND wt.user_id = $1)
                ) AS personal
         FROM work_orders wo
         WHERE wo.submitted_at >= ${SINCE}
         GROUP BY wk`, [uid]
      ),
      query(
        // "mine" = the user placed the order (ordered_by), falling back to who entered it.
        `SELECT date_trunc('week', d)::date AS wk,
                COUNT(*) AS company_orders,
                COUNT(*) FILTER (WHERE orderer = $1) AS personal_orders,
                COALESCE(SUM(spend),0) AS company_spend,
                COALESCE(SUM(spend) FILTER (WHERE orderer = $1),0) AS personal_spend
         FROM (
           SELECT o.id, COALESCE(o.ordered_by, o.created_by) AS orderer,
                  COALESCE(o.order_date, o.created_at::date) AS d,
                  COALESCE((SELECT SUM((it->>'total_cost')::numeric)
                            FROM jsonb_array_elements(COALESCE(o.items,'[]'::jsonb)) it
                            WHERE NULLIF(it->>'total_cost','') IS NOT NULL),0) AS spend
           FROM order_log o
         ) sub
         WHERE d >= ${SINCE}
         GROUP BY wk`, [uid]
      ),
      query(
        `SELECT status,
                COUNT(*) AS company,
                COUNT(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM work_order_technicians wt WHERE wt.work_order_id = wo.id AND wt.user_id = $1)
                ) AS personal
         FROM work_orders wo GROUP BY status`, [uid]
      ),
      query(
        `${woTotalsCTE}
         SELECT date_trunc('week', invoiced_at)::date AS wk,
                COALESCE(SUM(total),0) AS company,
                COALESCE(SUM(total) FILTER (WHERE mine),0) AS personal
         FROM t WHERE invoiced_at >= ${SINCE} GROUP BY wk`, [uid]
      ),
      query(
        `${woTotalsCTE}
         SELECT date_trunc('week', paid_at)::date AS wk,
                COALESCE(SUM(total),0) AS company,
                COALESCE(SUM(total) FILTER (WHERE mine),0) AS personal
         FROM t WHERE paid_at >= ${SINCE} GROUP BY wk`, [uid]
      ),
    ]);

    const seriesFrom = (rows, field) => {
      const m = {};
      rows.forEach(r => { m[wkKey(r.wk)] = Number(r[field]) || 0; });
      return weeks.map(w => m[w] ?? 0);
    };

    // Voided is counted too - leaving it out would make the breakdown quietly
    // disagree with the Work Orders list, which still shows those work orders.
    const status = {
      personal: { draft: 0, pending_billing: 0, invoiced: 0, paid: 0, voided: 0 },
      company:  { draft: 0, pending_billing: 0, invoiced: 0, paid: 0, voided: 0 },
    };
    statusRes.rows.forEach(r => {
      if (status.company[r.status] !== undefined) {
        status.company[r.status]  = Number(r.company)  || 0;
        status.personal[r.status] = Number(r.personal) || 0;
      }
    });

    res.json({
      weeks,
      hours:       { company: seriesFrom(hoursRes.rows, 'company'),         personal: seriesFrom(hoursRes.rows, 'personal') },
      woSubmitted: { company: seriesFrom(woRes.rows, 'company'),            personal: seriesFrom(woRes.rows, 'personal') },
      orders:      { company: seriesFrom(ordersRes.rows, 'company_orders'), personal: seriesFrom(ordersRes.rows, 'personal_orders') },
      spend:       { company: seriesFrom(ordersRes.rows, 'company_spend'),  personal: seriesFrom(ordersRes.rows, 'personal_spend') },
      billed:      { company: seriesFrom(billedRes.rows, 'company'),        personal: seriesFrom(billedRes.rows, 'personal') },
      collected:   { company: seriesFrom(collectedRes.rows, 'company'),     personal: seriesFrom(collectedRes.rows, 'personal') },
      status,
    });
  } catch (err) { next(err); }
});

export default router;
