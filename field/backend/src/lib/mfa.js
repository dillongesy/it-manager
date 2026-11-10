// Two-factor authentication for the Field App: policy, sign-in challenges, enrollment
// and verification.
//
// The policy ('off', 'optional' or 'required') is set in the Portal (Admin → Security)
// and pushed here over the bridge; the Field App reads its own copy from app_settings.
//
// After a correct password, a user who needs a second step gets a challenge token
// instead of a session. Challenge tokens are signed with a key derived from the access
// token secret, so they are never accepted as access tokens; they expire after five
// minutes and allow a limited number of attempts.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { encrypt, decrypt } from './encrypt.js';
import {
  generateSecret, verifyTotp, otpauthUri, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode,
} from './totp.js';

export const MFA_POLICIES = Object.freeze(['off', 'optional', 'required']);
const POLICY_KEY = 'security:mfa';
const DEFAULT_POLICY = 'optional';
const CHALLENGE_TTL = '5m';
const MAX_ATTEMPTS = 5;

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };

// --- Policy ---------------------------------------------------------------------

export async function getMfaPolicy() {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [POLICY_KEY]);
  const policy = rows[0]?.value;
  return MFA_POLICIES.includes(policy) ? policy : DEFAULT_POLICY;
}

/** Store the policy pushed by the Portal. */
export async function setMfaPolicy(policy) {
  if (!MFA_POLICIES.includes(policy)) fail(400, `mfa must be one of: ${MFA_POLICIES.join(', ')}.`);
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [POLICY_KEY, JSON.stringify(policy)]
  );
}

/** Name shown in the authenticator app. */
export async function issuerName() {
  const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'branding'`);
  const b = rows[0]?.value ?? {};
  if (b.companyName && b.fieldAppName) return `${b.companyName} ${b.fieldAppName}`;
  return b.fieldAppName || 'Field App';
}

// --- Challenge tokens -------------------------------------------------------------

const challengeKey = () => crypto.createHmac('sha256', config.jwt.accessSecret).update('mfa-challenge').digest();
const attempts = new Map();   // jti → failed attempts

/** purpose: 'verify' (enter a code) or 'enroll' (2FA required, not set up yet). */
export function issueChallenge(user, purpose) {
  return jwt.sign({ sub: user.id, purpose, jti: crypto.randomUUID() }, challengeKey(), { expiresIn: CHALLENGE_TTL });
}

export function readChallenge(token, purpose) {
  let payload;
  try {
    payload = jwt.verify(String(token ?? ''), challengeKey());
  } catch {
    fail(401, 'The sign-in step has expired. Sign in again.');
  }
  if (payload.purpose !== purpose) fail(401, 'The sign-in step has expired. Sign in again.');
  if ((attempts.get(payload.jti) ?? 0) >= MAX_ATTEMPTS) fail(429, 'Too many attempts. Sign in again.');
  return payload;
}

export function recordFailedAttempt(jti) {
  attempts.set(jti, (attempts.get(jti) ?? 0) + 1);
  if (attempts.size > 10_000) attempts.clear();   // bound memory; tokens expire in minutes anyway
}

// --- Per-user state -----------------------------------------------------------------

const USER_MFA = `SELECT id, username, full_name, totp_secret, totp_pending, totp_enabled_at, totp_last_step, totp_recovery
                    FROM users WHERE id = $1`;

export async function mfaStatus(userId) {
  const { rows } = await query(USER_MFA, [userId]);
  const u = rows[0];
  return {
    enrolled: Boolean(u?.totp_secret),
    enabledAt: u?.totp_enabled_at ?? null,
    recoveryCodesLeft: Array.isArray(u?.totp_recovery) ? u.totp_recovery.length : 0,
  };
}

/** A new secret for the user to scan; it becomes active once confirmed with a code. */
export async function startEnrollment(userId) {
  const { rows } = await query(USER_MFA, [userId]);
  const user = rows[0];
  if (!user) fail(404, 'User not found.');
  const secret = generateSecret();
  await query('UPDATE users SET totp_pending = $2 WHERE id = $1', [userId, encrypt(secret)]);
  const uri = otpauthUri({ secret, issuer: await issuerName(), account: user.username });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { secret, otpauthUri: uri, qr };
}

/** Confirm enrollment with a code from the app. Returns the recovery codes, shown once. */
export async function confirmEnrollment(userId, code) {
  const { rows } = await query(USER_MFA, [userId]);
  const pending = decrypt(rows[0]?.totp_pending);
  if (!pending) fail(400, 'Start setting up two-factor authentication first.');
  const step = verifyTotp(pending, code);
  if (step == null) return null;
  const codes = generateRecoveryCodes();
  await query(
    `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = NOW(),
                      totp_last_step = $2, totp_recovery = $3
      WHERE id = $1`,
    [userId, step, JSON.stringify(codes.map(hashRecoveryCode))]
  );
  return codes;
}

/**
 * Check a second-factor code (authenticator code or recovery code) for a user.
 * Each code is accepted once; concurrent use of the same code succeeds only once.
 * @returns {'totp'|'recovery'|null}
 */
export async function verifySecondFactor(userId, code) {
  const { rows } = await query(USER_MFA, [userId]);
  const user = rows[0];
  const secret = decrypt(user?.totp_secret);
  if (!secret) return null;

  if (looksLikeRecoveryCode(code)) {
    const { rowCount } = await query(
      `UPDATE users SET totp_recovery = totp_recovery - $2::text
        WHERE id = $1 AND totp_recovery ? $2::text`,
      [userId, hashRecoveryCode(code)]
    );
    return rowCount === 1 ? 'recovery' : null;
  }

  const lastStep = user.totp_last_step == null ? null : Number(user.totp_last_step);
  const step = verifyTotp(secret, code, { lastStep });
  if (step == null) return null;
  const { rowCount } = await query(
    `UPDATE users SET totp_last_step = $2
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
    [userId, step]
  );
  return rowCount === 1 ? 'totp' : null;
}

export async function newRecoveryCodes(userId) {
  const codes = generateRecoveryCodes();
  await query('UPDATE users SET totp_recovery = $2 WHERE id = $1 AND totp_secret IS NOT NULL',
    [userId, JSON.stringify(codes.map(hashRecoveryCode))]);
  return codes;
}

export async function disableMfa(userId) {
  await query(
    `UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL,
                      totp_last_step = NULL, totp_recovery = '[]'
      WHERE id = $1`,
    [userId]
  );
}
