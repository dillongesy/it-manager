import { query } from '../db/index.js';

// Mirrors the Portal's audit helper. Writes one row per change; failures are
// swallowed so an audit problem can never break an inventory operation.
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
    console.error('Audit log write failed:', err.message);
  }
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.socket?.remoteAddress ??
    null
  );
}
