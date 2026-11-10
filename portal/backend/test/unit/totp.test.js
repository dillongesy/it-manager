import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode, base32Decode, generateSecret, hotp, verifyTotp, stepAt, otpauthUri,
  generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode,
} from '../../src/lib/totp.js';

// RFC 6238 appendix B: SHA-1 secret "12345678901234567890", 8-digit values. The last six
// digits are what a 6-digit authenticator shows.
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('hotp matches the RFC 6238 SHA-1 test vectors (6-digit form)', () => {
  for (const [seconds, eight] of RFC_VECTORS) {
    assert.equal(hotp(RFC_SECRET, Math.floor(seconds / 30)), eight.slice(-6), `T=${seconds}`);
  }
});

test('base32 round-trips and decodes the RFC secret', () => {
  const encoded = base32Encode(RFC_SECRET);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(encoded), RFC_SECRET);
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), RFC_SECRET);
  assert.throws(() => base32Decode('NOT*BASE32'));
});

test('generated secrets are 32 base32 characters (160 bits) and differ', () => {
  const a = generateSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, generateSecret());
});

test('verifyTotp accepts the current code and one step of clock drift, nothing further', () => {
  const secret = generateSecret();
  const t = 1_800_000_000_000;
  const now = stepAt(t);
  assert.equal(verifyTotp(secret, hotp(secret, now), { timeMs: t }), now);
  assert.equal(verifyTotp(secret, hotp(secret, now - 1), { timeMs: t }), now - 1);
  assert.equal(verifyTotp(secret, hotp(secret, now + 1), { timeMs: t }), now + 1);
  assert.equal(verifyTotp(secret, hotp(secret, now - 2), { timeMs: t }), null);
  assert.equal(verifyTotp(secret, '12345', { timeMs: t }), null);
  assert.equal(verifyTotp(secret, 'abcdef', { timeMs: t }), null);
  assert.equal(verifyTotp(secret, ` ${hotp(secret, now).slice(0, 3)} ${hotp(secret, now).slice(3)} `, { timeMs: t }), now);
});

test('verifyTotp refuses a code whose step was already used', () => {
  const secret = generateSecret();
  const t = 1_800_000_000_000;
  const now = stepAt(t);
  assert.equal(verifyTotp(secret, hotp(secret, now), { timeMs: t, lastStep: now }), null);
  assert.equal(verifyTotp(secret, hotp(secret, now - 1), { timeMs: t, lastStep: now - 1 }), null);
  assert.equal(verifyTotp(secret, hotp(secret, now + 1), { timeMs: t, lastStep: now }), now + 1);
});

test('otpauth URI carries the secret, issuer and account', () => {
  const uri = otpauthUri({ secret: 'ABC234', issuer: 'Northwind IT', account: 'dana' });
  assert.match(uri, /^otpauth:\/\/totp\/Northwind%20IT%3Adana\?/);
  const params = new URL(uri.replace('otpauth://', 'http://x/')).searchParams;
  assert.deepEqual([params.get('secret'), params.get('issuer'), params.get('digits'), params.get('period')], ['ABC234', 'Northwind IT', '6', '30']);
});

test('recovery codes: ten distinct codes, hashed case- and dash-insensitively', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toLowerCase().replace('-', ' ')));
  assert.equal(looksLikeRecoveryCode(codes[0]), true);
  assert.equal(looksLikeRecoveryCode('123456'), false);
});
