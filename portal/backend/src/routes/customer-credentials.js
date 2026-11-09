import { Router } from 'express';
import { query, getClient } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';

const router = Router({ mergeParams: true });

// Custom fields: secret values are encrypted at rest. On the way out we never
// return a secret value - only its label, secret flag, and whether it's set.
// Non-secret values pass through as plain text.
function sanitizeCustomFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f, i) => ({
    id: i,
    label: f.label ?? '',
    secret: !!f.secret,
    value: f.secret ? undefined : (f.value ?? ''),
    has_value: f.secret ? hasValue(f.value) : (f.value != null && f.value !== ''),
  }));
}

// Encrypt secret values for storage; leave plain values as-is. Drops empty rows.
function encryptCustomFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter(f => (f.label ?? '').trim() !== '' || (f.value ?? '') !== '')
    .map(f => ({
      label: (f.label ?? '').trim(),
      secret: !!f.secret,
      value: f.secret ? encrypt(f.value) : (f.value ?? ''),
    }));
}

// Merge for edits. The client returns each field with its original index in
// `keep_id` when it wants to preserve a secret value it never saw. A secret field
// with a fresh `value` is re-encrypted; one with an empty value but a valid
// keep_id copies the existing encrypted blob; plain fields pass through.
function mergeCustomFields(incoming, existing) {
  if (!Array.isArray(incoming)) return Array.isArray(existing) ? existing : [];
  const prev = Array.isArray(existing) ? existing : [];
  return incoming
    .filter(f => (f.label ?? '').trim() !== '' || (f.value ?? '') !== '' || f.keep_id != null)
    .map(f => {
      const label = (f.label ?? '').trim();
      const secret = !!f.secret;
      if (!secret) return { label, secret: false, value: f.value ?? '' };
      if (f.value) return { label, secret: true, value: encrypt(f.value) };           // new secret
      const original = (typeof f.keep_id === 'number') ? prev[f.keep_id] : null;       // keep old secret
      return { label, secret: true, value: original?.value ?? null };
    });
}

function sanitize(row) {
  return {
    ...row,
    has_password: hasValue(row.password_enc),
    password_enc: undefined,
    custom_fields: sanitizeCustomFields(row.custom_fields),
  };
}

export async function ensureSection(customerId, category) {
  const cat = (category ?? '').trim() || 'General';
  const { rows } = await query(
    `SELECT 1 FROM customer_credential_sections WHERE customer_id = $1 AND category = $2`,
    [customerId, cat]
  );
  if (!rows.length) {
    const { rows: max } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_credential_sections WHERE customer_id = $1`,
      [customerId]
    );
    await query(
      `INSERT INTO customer_credential_sections (customer_id, category, sort_order)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [customerId, cat, max[0].next]
    );
  }
  return cat;
}

// GET - credentials ordered by their section's order, then within-section order.
// Section order comes from customer_credential_sections; returned alongside.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [credsRes, sectionsRes] = await Promise.all([
      query(
        `SELECT c.*, COALESCE(s.sort_order, 9999) AS section_order
         FROM customer_credentials c
         LEFT JOIN customer_credential_sections s
           ON s.customer_id = c.customer_id AND s.category = COALESCE(c.category, 'General')
         WHERE c.customer_id = $1
         ORDER BY section_order, c.sort_order, c.label`,
        [req.params.customerId]
      ),
      query(
        `SELECT category, sort_order FROM customer_credential_sections
         WHERE customer_id = $1 ORDER BY sort_order, category`,
        [req.params.customerId]
      ),
    ]);
    res.json({ credentials: credsRes.rows.map(sanitize), sections: sectionsRes.rows });
  } catch (err) { next(err); }
});

// Distinct section names across ALL customers - autocomplete so a section like "NAS"
// created for one customer is suggested when adding credentials for another (keeps
// section naming consistent and avoids casing/typo drift).
router.get('/sections/suggestions', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT category AS v FROM customer_credential_sections
       WHERE category IS NOT NULL AND category <> ''
       ORDER BY v LIMIT 200`
    );
    res.json(rows.map(r => r.v));
  } catch (err) { next(err); }
});

// Drag-reorder credential rows - body { ids: [credId, …] } in the new order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE customer_credentials SET sort_order = $3 WHERE id = $1 AND customer_id = $2`,
        [ids[i], req.params.customerId, (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: req.params.customerId, entityName: 'Credentials reordered',
      changes: { order: ids }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Drag-reorder sections - body { categories: [category, …] } in the new order.
router.post('/sections/reorder', requireAuth, async (req, res, next) => {
  try {
    const cats = Array.isArray(req.body?.categories) ? req.body.categories : [];
    for (let i = 0; i < cats.length; i++) {
      await query(
        `INSERT INTO customer_credential_sections (customer_id, category, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_id, category) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [req.params.customerId, cats[i], (i + 1) * 10]
      );
    }
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: req.params.customerId, entityName: 'Credential sections reordered',
      changes: { order: cats }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Move a section up/down relative to its neighbour (swap sort_order).
router.post('/sections/move', requireAuth, async (req, res, next) => {
  try {
    const { category, direction } = req.body ?? {};
    const cat = (category ?? '').trim() || 'General';
    const { rows: all } = await query(
      `SELECT category, sort_order FROM customer_credential_sections
       WHERE customer_id = $1 ORDER BY sort_order, category`,
      [req.params.customerId]
    );
    const i = all.findIndex(s => s.category === cat);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= all.length) return res.json({ ok: true }); // nothing to do
    await query(
      `UPDATE customer_credential_sections SET sort_order = $3 WHERE customer_id = $1 AND category = $2`,
      [req.params.customerId, all[i].category, all[j].sort_order]
    );
    await query(
      `UPDATE customer_credential_sections SET sort_order = $3 WHERE customer_id = $1 AND category = $2`,
      [req.params.customerId, all[j].category, all[i].sort_order]
    );
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: req.params.customerId,
      entityName: `Section "${cat}" moved ${direction}`, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Rename a section - body { from, to }. Every credential in it moves with it. If
// this customer already has a section called `to`, the two are merged: the
// renamed section's credentials go to the bottom of the existing one, in order.
router.post('/sections/rename', requireAuth, async (req, res, next) => {
  const from = (req.body?.from ?? '').trim() || 'General';
  const to   = (req.body?.to ?? '').trim();
  if (!to) return res.status(400).json({ error: 'Section name is required.' });
  if (to.length > 255) return res.status(400).json({ error: 'Section name is too long (255 characters max).' });
  if (from === to) return res.json({ ok: true, merged: false });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: src } = await client.query(
      `SELECT sort_order FROM customer_credential_sections
       WHERE customer_id = $1 AND category = $2 FOR UPDATE`,
      [req.params.customerId, from]
    );
    const { rows: credCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM customer_credentials
       WHERE customer_id = $1 AND COALESCE(category,'General') = $2`,
      [req.params.customerId, from]
    );
    if (!src[0] && !credCount[0].n) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Section not found.' });
    }
    const { rows: target } = await client.query(
      `SELECT 1 FROM customer_credential_sections
       WHERE customer_id = $1 AND category = $2 FOR UPDATE`,
      [req.params.customerId, to]
    );
    const merged = !!target[0];

    if (merged) {
      // Keep the target's rows first; the moved ones follow in their own order.
      const { rows: max } = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM customer_credentials
         WHERE customer_id = $1 AND COALESCE(category,'General') = $2`,
        [req.params.customerId, to]
      );
      await client.query(
        `UPDATE customer_credentials SET category = $3, sort_order = sort_order + $4, updated_at = NOW()
         WHERE customer_id = $1 AND COALESCE(category,'General') = $2`,
        [req.params.customerId, from, to, max[0].m + 10]
      );
      await client.query(
        `DELETE FROM customer_credential_sections WHERE customer_id = $1 AND category = $2`,
        [req.params.customerId, from]
      );
    } else {
      await client.query(
        `UPDATE customer_credentials SET category = $3, updated_at = NOW()
         WHERE customer_id = $1 AND COALESCE(category,'General') = $2`,
        [req.params.customerId, from, to]
      );
      if (src[0]) {
        await client.query(
          `UPDATE customer_credential_sections SET category = $3 WHERE customer_id = $1 AND category = $2`,
          [req.params.customerId, from, to]
        );
      } else {
        await client.query(
          `INSERT INTO customer_credential_sections (customer_id, category, sort_order)
           SELECT $1, $2, COALESCE(MAX(sort_order), 0) + 10 FROM customer_credential_sections WHERE customer_id = $1`,
          [req.params.customerId, to]
        );
      }
    }
    await client.query('COMMIT');

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: req.params.customerId,
      entityName: merged ? `Section "${from}" merged into "${to}"` : `Section "${from}" renamed to "${to}"`,
      changes: { section: { from, to }, credentials_moved: credCount[0].n, merged },
      ipAddress: getClientIp(req) });
    res.json({ ok: true, merged });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Move a credential up/down within its section (swap sort_order with neighbour).
router.post('/:credId/move', requireAuth, async (req, res, next) => {
  try {
    const { direction } = req.body ?? {};
    const { rows: cur } = await query(
      `SELECT id, category, sort_order FROM customer_credentials WHERE id = $1 AND customer_id = $2`,
      [req.params.credId, req.params.customerId]
    );
    if (!cur[0]) return res.status(404).json({ error: 'Credential not found.' });

    const { rows: peers } = await query(
      `SELECT id, sort_order FROM customer_credentials
       WHERE customer_id = $1 AND COALESCE(category,'General') = COALESCE($2,'General')
       ORDER BY sort_order, label`,
      [req.params.customerId, cur[0].category]
    );
    const i = peers.findIndex(p => p.id === cur[0].id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= peers.length) return res.json({ ok: true });

    // Swap, normalising in case two rows share a sort_order.
    await query(`UPDATE customer_credentials SET sort_order = $2 WHERE id = $1`, [peers[i].id, j * 10]);
    await query(`UPDATE customer_credentials SET sort_order = $2 WHERE id = $1`, [peers[j].id, i * 10]);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: req.params.credId,
      entityName: `Credential moved ${direction}`, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { category, label, username, password, url, two_fa_note, extra_notes, custom_fields, location_id } = req.body ?? {};
    if (!label?.trim()) return res.status(400).json({ error: 'label is required.' });

    const cat = await ensureSection(req.params.customerId, category);
    // New row goes to the bottom of its section.
    const { rows: max } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM customer_credentials
       WHERE customer_id = $1 AND COALESCE(category,'General') = $2`,
      [req.params.customerId, cat]
    );

    const { rows } = await query(
      `INSERT INTO customer_credentials
         (customer_id, category, label, username, password_enc, url, two_fa_note, extra_notes, sort_order, custom_fields, location_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.params.customerId, cat, label.trim(),
        username, encrypt(password), url, two_fa_note, extra_notes,
        max[0].next, JSON.stringify(encryptCustomFields(custom_fields)), location_id || null, req.user.sub,
      ]
    );

    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'credential', entityId: rows[0].id, entityName: rows[0].label,
      ipAddress: getClientIp(req) });

    res.status(201).json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:credId', requireAuth, async (req, res, next) => {
  try {
    const fields = ['category', 'label', 'username', 'url', 'two_fa_note', 'extra_notes', 'sort_order', 'location_id'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.location_id === '') updates.location_id = null;
    if (updates.category !== undefined) updates.category = await ensureSection(req.params.customerId, updates.category);
    if (req.body.password !== undefined) updates.password_enc = encrypt(req.body.password);
    // Snapshot the row before - used for the custom-fields merge and the audit diff.
    const { rows: existingRows } = await query(
      `SELECT * FROM customer_credentials WHERE id = $1 AND customer_id = $2`,
      [req.params.credId, req.params.customerId]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Credential not found.' });
    if (req.body.custom_fields !== undefined) {
      updates.custom_fields = JSON.stringify(mergeCustomFields(req.body.custom_fields, existingRows[0].custom_fields));
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_credentials SET ${setClauses}
       WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.credId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Credential not found.' });

    // password_enc auto-redacted by the *_enc rule; custom_fields can hold secret
    // values, so mark it secret (recorded as changed-only, never its contents).
    const changes = diffChanges(existingRows[0], rows[0],
      Object.keys(updates).filter(k => k !== 'updated_at'), ['custom_fields']);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'credential', entityId: rows[0].id, entityName: rows[0].label,
      changes, ipAddress: getClientIp(req) });

    res.json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

// Reveal password - always audit logged
router.post('/:credId/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT password_enc, label FROM customer_credentials
       WHERE id = $1 AND customer_id = $2`,
      [req.params.credId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Credential not found.' });

    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'credential', entityId: req.params.credId,
      entityName: rows[0].label, ipAddress: getClientIp(req) });

    res.json({ value: decrypt(rows[0].password_enc) });
  } catch (err) { next(err); }
});

// Reveal a secret custom field by its index - always audit logged
router.post('/:credId/custom/:index/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT custom_fields, label FROM customer_credentials WHERE id = $1 AND customer_id = $2`,
      [req.params.credId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Credential not found.' });

    const field = (rows[0].custom_fields ?? [])[parseInt(req.params.index, 10)];
    if (!field || !field.secret) return res.status(404).json({ error: 'Field not found.' });

    await logAudit({ userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'credential', entityId: req.params.credId,
      entityName: `${rows[0].label} — ${field.label}`, ipAddress: getClientIp(req) });

    res.json({ value: decrypt(field.value) });
  } catch (err) { next(err); }
});

router.delete('/:credId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM customer_credentials WHERE id = $1 AND customer_id = $2 RETURNING label`,
      [req.params.credId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Credential not found.' });
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'credential', entityId: req.params.credId, entityName: rows[0].label,
      ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
