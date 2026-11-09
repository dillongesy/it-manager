import { query } from '../db/index.js';

export async function logAudit({
  userId,
  userName,
  action,
  entityType,
  entityId,
  entityName,
  changes,
  ipAddress,
}) {
  try {
    await query(
      `INSERT INTO audit_log
         (user_id, user_name, action, entity_type, entity_id, entity_name, changes, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId ?? null,
        userName ?? null,
        action,
        entityType ?? null,
        entityId ?? null,
        entityName ?? null,
        changes ? JSON.stringify(changes) : null,
        ipAddress ?? null,
      ]
    );
  } catch (err) {
    // Audit failures must never crash the app
    console.error('Audit log write failed:', err.message);
  }
}

// Build a { field: { from, to } } diff between a before-row and an after-row,
// for audit `changes`. Only `fields` are considered. Any column whose name ends
// in `_enc` (or is in `secretFields`) is recorded as a redacted "changed" marker —
// never the plaintext or ciphertext. JSONB/objects are compared by value.
export function diffChanges(before, after, fields, secretFields = []) {
  const changes = {};
  const isSecret = (k) => k.endsWith('_enc') || secretFields.includes(k);
  const norm = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  for (const f of fields) {
    const b = before?.[f];
    const a = after?.[f];
    if (norm(b) === norm(a)) continue;
    changes[f] = isSecret(f) ? { changed: true } : { from: b ?? null, to: a ?? null };
  }
  return Object.keys(changes).length ? changes : null;
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.socket.remoteAddress ??
    null
  );
}
