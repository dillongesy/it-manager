// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30-second steps, 6 digits): the
// scheme used by Google Authenticator, Microsoft Authenticator, Authy, 1Password and
// similar apps. Pure functions only; storage and policy live in lib/mfa.js.
//
// The same file is used by the Portal API and the Field API.
import crypto from 'node:crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const WINDOW = 1;              // accept the previous and next step for clock drift
const SECRET_BYTES = 20;       // 160 bits, as recommended by RFC 4226
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str ?? '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, base32-encoded (what authenticator apps expect). */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

/** The one-time password for time step `step`. */
export function hotp(secret, step) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (timeMs = Date.now()) => Math.floor(timeMs / 1000 / STEP_SECONDS);

/**
 * Check a code. Returns the matching time step (to record against replay), or null.
 * Codes for steps at or before `lastStep` are refused, so a code works only once.
 */
export function verifyTotp(secret, code, { timeMs = Date.now(), lastStep = null } = {}) {
  const digits = String(code ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(digits)) return null;
  const now = stepAt(timeMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return step;
  }
  return null;
}

/** otpauth:// URI for QR codes; `issuer` and `account` appear in the authenticator app. */
export function otpauthUri({ secret, issuer, account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// --- Recovery codes -----------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use recovery codes, e.g. "K7Q2M-9XH4T". */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const s = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

const normalizeRecovery = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');

/** Stored form of a recovery code (codes are never stored in plain text). */
export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}

export const looksLikeRecoveryCode = (code) => normalizeRecovery(code).length === 10;
