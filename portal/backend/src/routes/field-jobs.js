import { Router } from 'express';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { fieldJobs, isFieldConfigured } from '../lib/field-client.js';
import { sumDayHours, buildSectionNotes, splitTechnicians, jobDays } from '../lib/field-import.js';
import { coerceIntervalCount } from '../lib/cadence.js';
import { findDefaultRateId } from '../lib/billing-rates.js';

const router = Router();

const __dir = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dir, '..', '..', 'uploads');
function customerDir(customerId) {
  const dir = join(UPLOADS_ROOT, 'customers', customerId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// GET /api/field-jobs/status - is the bridge wired up?
router.get('/status', requireAuth, (req, res) => {
  res.json({ configured: isFieldConfigured() });
});

// GET /api/field-jobs - pull "ready" captures from the Field App over the bridge.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status || 'ready';
    res.json(await fieldJobs.list({ status }));
  } catch (err) { next(err); }
});

// GET /api/field-jobs/:id - one full capture
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    res.json(await fieldJobs.get(req.params.id));
  } catch (err) { next(err); }
});

// GET /api/field-jobs/:id/photos/:photoId - pipe the photo bytes through to the
// browser (Portal fetches from Field over the LAN; client is auth'd via JWT).
router.get('/:id/photos/:photoId', requireAuth, async (req, res, next) => {
  try {
    const upstream = await fieldJobs.photo(req.params.id, req.params.photoId);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) { next(err); }
});

// POST /api/field-jobs/:id/promote - turn a captured field job into a real Portal
// work order, copy its photos into the customer's files, then mark the source
// capture imported on the Field side. Body: { customer_id, location_id? }.
router.post('/:id/promote', requireAuth, async (req, res, next) => {
  const { customer_id, location_id } = req.body ?? {};
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required.' });

  let job;
  try {
    job = await fieldJobs.get(req.params.id);
  } catch (err) { return next(err); }
  if (!job) return res.status(404).json({ error: 'Field job not found.' });
  if (job.capture_status !== 'ready') {
    return res.status(409).json({ error: 'Only jobs marked ready to bill can be imported.' });
  }

  const client = await getClient();
  let woId, woNumber;
  try {
    // Confirm the customer exists (and the branch belongs to it, if given).
    const { rows: cust } = await client.query('SELECT id FROM customers WHERE id = $1 AND is_active = true', [customer_id]);
    if (!cust[0]) { client.release(); return res.status(404).json({ error: 'Customer not found.' }); }

    await client.query('BEGIN');
    // The customer's default rate becomes the work order's rate and every imported
    // section inherits it. Field jobs carry no rates; the biller adjusts them per section.
    const defaultRateId = await findDefaultRateId(client, customer_id);

    const days = jobDays(job);

    // The Portal roster, used to recognize field crew who also have a Portal login.
    // Loaded once for the whole import, not per day.
    const { rows: portalUsers } = await client.query(
      'SELECT id, full_name FROM users WHERE is_active = true'
    );

    const { rows: woRows } = await client.query(
      `INSERT INTO work_orders (customer_id, work_date, billing_rate_id, location_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, number`,
      [customer_id, days[0].work_date || job.work_date || new Date(), defaultRateId, location_id || null, req.user.sub]
    );
    woId = woRows[0].id;
    woNumber = woRows[0].number;

    // One field day → one Portal work section. A section already carries its own
    // date, hours and description, so the multi-day record survives the import
    // intact instead of collapsing into a single lump. billing_rate_id is left NULL
    // so each section inherits the work order's default until the biller says
    // otherwise.
    const RECUR = ['monthly', 'quarterly', 'semiannual', 'annual'];
    for (const [i, day] of days.entries()) {
      // The Portal stores one hours figure per section; the per-technician split
      // is preserved as text in the internal notes (see buildSectionNotes).
      const hours = day.legacy_hours != null ? Number(day.legacy_hours) : sumDayHours(day);
      const workPerformed = (day.description || job.description || job.notes || `Field Job #${job.number}`).trim();

      const { rows: sec } = await client.query(
        `INSERT INTO work_order_sections (work_order_id, sort_order, work_date, hours, description, internal_notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [woId, (i + 1) * 10, day.work_date || job.work_date || new Date(), hours || null, workPerformed,
         buildSectionNotes({ job, day, isFirst: i === 0 })]
      );
      const sectionId = sec[0].id;

      // Carry the day's crew onto the section. Anyone who resolves to a Portal user is
      // attached as that LINKED user (so they show as a selected technician rather than
      // a duplicate free-text chip beside their own account); everyone else - subs, crew
      // without a Portal login - stays free text. The importer is NOT auto-added; the
      // actual field crew is who did the work.
      const { userIds, freeNames } = splitTechnicians(day, portalUsers);
      for (const userId of userIds) {
        await client.query(
          'INSERT INTO work_order_technicians (work_order_id, section_id, user_id) VALUES ($1, $2, $3)',
          [woId, sectionId, userId]
        );
      }
      for (const name of freeNames) {
        await client.query(
          'INSERT INTO work_order_technicians (work_order_id, section_id, user_id, name) VALUES ($1, $2, NULL, $3)',
          [woId, sectionId, name]
        );
      }

      // Parts → real WO line items, LINKED to shared inventory and carrying the unit
      // price (field-entered, else the inventory cost). Stock was already decremented
      // on the Field side at "ready", so we do NOT check out again here; later Portal
      // edits/deletes reconcile inventory normally.
      for (const it of day.items || []) {
        const qty = Number(it.quantity) || 1;
        const label = it.item_name || it.description || 'Part';
        const desc = it.sku ? `${label} (${it.sku})` : label;
        const unit = it.unit_price != null ? Number(it.unit_price)
                   : (it.inventory_cost != null ? Number(it.inventory_cost) : null);
        const total = unit != null ? unit * qty : null;
        await client.query(
          `INSERT INTO work_order_items (work_order_id, section_id, description, quantity, unit_price, total_price, inventory_item_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [woId, sectionId, desc, qty, unit, total, it.inventory_item_id || null]
        );
      }

      // Services → real WO services (one-time + recurring), carrying price + cadence.
      for (const sv of day.services || []) {
        const desc = (sv.description || '').trim();
        if (!desc) continue;
        const qty = Number(sv.quantity) || 1;
        const unit = sv.unit_price != null && sv.unit_price !== '' ? Number(sv.unit_price) : null;
        const total = unit != null ? unit * qty : null;
        const billing = sv.billing_type === 'recurring' ? 'recurring' : 'one_time';
        const recurrence = billing === 'recurring' ? (RECUR.includes(sv.recurrence) ? sv.recurrence : 'monthly') : null;
        // A multi-year cadence captured in the field ("every 3 years") carries over
        // intact - otherwise it would silently land as plain "Annually" and print that
        // way in the recurring summary on the customer's invoice.
        const recurrenceCount = billing === 'recurring' ? coerceIntervalCount(sv.recurrence_count, recurrence) : 1;
        await client.query(
          `INSERT INTO work_order_services (work_order_id, section_id, description, quantity, unit_price, total_price, billing_type, recurrence, recurrence_count, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [woId, sectionId, desc, qty, unit, total, billing, recurrence, recurrenceCount, sv.notes?.trim() || null]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    return next(err);
  }
  client.release();

  // -- Best-effort after the WO is committed: copy photos, then mark imported. --
  const warnings = [];

  for (const photo of job.photos || []) {
    try {
      const upstream = await fieldJobs.photo(job.id, photo.id);
      const ext = photo.original_name?.includes('.') ? '.' + photo.original_name.split('.').pop() : '.jpg';
      const stored = `${randomUUID()}${ext}`;
      const dest = join(customerDir(customer_id), stored);
      await pipeline(Readable.fromWeb(upstream.body), createWriteStream(dest));
      try {
        await query(
          `INSERT INTO customer_files
             (customer_id, stored_name, original_name, mime_type, size_bytes, category, kind, notes, location_id, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,'file',$7,$8,$9)`,
          [customer_id, stored, photo.original_name || stored, photo.mime_type || 'image/jpeg',
           photo.size_bytes || null, `Field Job #${job.number}`, photo.notes || null, location_id || null, req.user.sub]
        );
      } catch (dbErr) {
        try { unlinkSync(dest); } catch {}
        throw dbErr;
      }
    } catch {
      warnings.push(`Photo "${photo.original_name || photo.id}" could not be imported.`);
    }
  }

  try {
    await fieldJobs.markImported(job.id, { wo_number: woNumber, actor: req.user.fullName });
  } catch {
    warnings.push('The work order was created, but the field job could not be marked imported — it may still appear in the inbox.');
  }

  await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
    entityType: 'work_order', entityId: woId,
    entityName: `WO-${String(woNumber).padStart(5, '0')} — imported from Field Job #${job.number}`,
    ipAddress: getClientIp(req) });

  res.status(201).json({ id: woId, number: woNumber, warnings });
});

export default router;
