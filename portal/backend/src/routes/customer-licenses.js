import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { encrypt, decrypt, hasValue } from '../lib/encrypt.js';
import { coerceDateFields } from '../lib/dates.js';
import { coerceIntervalCount } from '../lib/cadence.js';

const router = Router({ mergeParams: true });

const DATE_FIELDS = ['renewal_date'];

// Strip key_enc from each key pair; expose id, title, has_key.
function sanitize(row) {
  const keys = (row.license_keys ?? []).map(k => ({
    id:      k.id,
    title:   k.title ?? '',
    has_key: hasValue(k.key_enc),
  }));
  return { ...row, license_keys: keys };
}

// Build encrypted key pairs for INSERT. Each pair gets a fresh UUID.
function encryptKeys(rawKeys) {
  return (rawKeys ?? []).map(k => ({
    id:      randomUUID(),
    title:   k.title ?? '',
    key_enc: encrypt(k.key),
  }));
}

// Merge incoming key pairs with existing ones during PATCH.
// - Existing pairs (have an id that matches): keep key_enc unless a new key provided.
// - New pairs (no matching id): generate id and encrypt new key.
function mergeKeys(rawKeys, currentKeys) {
  const existing = Object.fromEntries((currentKeys ?? []).map(k => [k.id, k]));
  return (rawKeys ?? []).map(k => {
    const prev = k.id ? existing[k.id] : null;
    return {
      id:      k.id ?? randomUUID(),
      title:   k.title ?? '',
      key_enc: k.key ? encrypt(k.key) : (prev?.key_enc ?? ''),
    };
  });
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM customer_licenses WHERE customer_id = $1 ORDER BY program_name',
      [req.params.customerId]
    );
    res.json(rows.map(sanitize));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { program_name, vendor, vendor_contact, version, license_keys, renewal_date, notes, location_id,
            auto_renew, renewal_interval, renewal_interval_count, payment_method } = req.body ?? {};
    if (!program_name?.trim()) return res.status(400).json({ error: 'program_name is required.' });
    const dates = coerceDateFields(req.body ?? {}, DATE_FIELDS);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    const keysEnc = encryptKeys(license_keys);
    const autoRenew = !!auto_renew;
    const interval = autoRenew ? (renewal_interval || 'monthly') : null;
    // How many intervals between renewals - 3 for a domain bought three years at a
    // time. Forced to 1 for anything but an annual interval (see lib/cadence.js).
    const intervalCount = autoRenew ? coerceIntervalCount(renewal_interval_count, interval) : 1;
    const { rows } = await query(
      `INSERT INTO customer_licenses
         (customer_id, program_name, vendor, vendor_contact, version, license_keys, renewal_date, notes, location_id,
          auto_renew, renewal_interval, renewal_interval_count, payment_method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.params.customerId,
        program_name.trim(),
        vendor || null,
        vendor_contact || null,
        version || null,
        JSON.stringify(keysEnc),
        dates.values.renewal_date ?? null,
        notes || null,
        location_id || null,
        autoRenew,
        interval,
        intervalCount,
        payment_method || null,
        req.user.sub,
      ]
    );
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'CREATE',
      entityType: 'license', entityId: rows[0].id, entityName: rows[0].program_name,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:licenseId', requireAuth, async (req, res, next) => {
  try {
    const { rows: before } = await query(
      'SELECT * FROM customer_licenses WHERE id = $1 AND customer_id = $2',
      [req.params.licenseId, req.params.customerId]
    );
    if (!before[0]) return res.status(404).json({ error: 'License not found.' });

    const scalar = ['program_name', 'vendor', 'vendor_contact', 'version', 'notes', 'location_id', 'payment_method'];
    const updates = {};
    for (const f of scalar) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    // Validate dates here so an out-of-range year returns a 400 instead of failing the
    // whole update in Postgres.
    const dates = coerceDateFields(req.body, DATE_FIELDS);
    if (!dates.ok) return res.status(400).json({ error: dates.error });
    Object.assign(updates, dates.values);
    // auto_renew, the interval, and how many intervals apart the renewals sit all move
    // together: the interval only means anything while auto-renewing, and the count only
    // on an annual interval. So whenever any of the three is sent, all three are resolved
    // from body-or-stored values - otherwise turning auto-renew off could leave an
    // orphaned 'every 3 years' behind it.
    if (req.body.auto_renew !== undefined || req.body.renewal_interval !== undefined
        || req.body.renewal_interval_count !== undefined) {
      const autoRenew = req.body.auto_renew !== undefined ? !!req.body.auto_renew : before[0].auto_renew;
      updates.auto_renew = autoRenew;
      const interval = autoRenew
        ? (req.body.renewal_interval !== undefined
            ? (req.body.renewal_interval || 'monthly')
            : (before[0].renewal_interval || 'monthly'))
        : null;
      updates.renewal_interval = interval;
      const rawCount = req.body.renewal_interval_count !== undefined
        ? req.body.renewal_interval_count
        : before[0].renewal_interval_count;
      updates.renewal_interval_count = autoRenew ? coerceIntervalCount(rawCount, interval) : 1;
    }
    if (req.body.license_keys !== undefined) {
      updates.license_keys = JSON.stringify(mergeKeys(req.body.license_keys, before[0].license_keys));
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    if (updates.program_name !== undefined && !updates.program_name?.trim()) {
      return res.status(400).json({ error: 'program_name is required.' });
    }
    updates.updated_at = new Date();

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE customer_licenses SET ${setClauses} WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.licenseId, req.params.customerId, ...Object.values(updates)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'License not found.' });

    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE',
      entityType: 'license', entityId: rows[0].id, entityName: rows[0].program_name,
      ipAddress: getClientIp(req),
    });
    res.json(sanitize(rows[0]));
  } catch (err) { next(err); }
});

// Reveal one specific key by its stable id.
router.post('/:licenseId/keys/:keyId/reveal', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT license_keys, program_name FROM customer_licenses WHERE id = $1 AND customer_id = $2',
      [req.params.licenseId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'License not found.' });
    const entry = (rows[0].license_keys ?? []).find(k => k.id === req.params.keyId);
    if (!entry) return res.status(404).json({ error: 'Key not found.' });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName,
      action: 'VIEW_CREDENTIALS', entityType: 'license', entityId: req.params.licenseId,
      entityName: `${rows[0].program_name}${entry.title ? ` — ${entry.title}` : ''}`,
      ipAddress: getClientIp(req),
    });
    res.json({ value: decrypt(entry.key_enc) });
  } catch (err) { next(err); }
});

router.delete('/:licenseId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM customer_licenses WHERE id = $1 AND customer_id = $2 RETURNING program_name',
      [req.params.licenseId, req.params.customerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'License not found.' });
    await logAudit({
      userId: req.user.sub, userName: req.user.fullName, action: 'DELETE',
      entityType: 'license', entityId: req.params.licenseId, entityName: rows[0].program_name,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
