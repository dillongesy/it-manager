import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffChanges } from '../../src/middleware/audit.js';

test('diffChanges returns null when nothing changed', () => {
  assert.equal(diffChanges({ a: 1, b: 'x' }, { a: 1, b: 'x' }, ['a', 'b']), null);
});

test('diffChanges captures from/to for changed plain fields', () => {
  const c = diffChanges({ label: 'Old', ram: '8GB' }, { label: 'New', ram: '8GB' }, ['label', 'ram']);
  assert.deepEqual(c, { label: { from: 'Old', to: 'New' } });
});

test('diffChanges only inspects the listed fields', () => {
  const c = diffChanges({ a: 1, b: 2 }, { a: 9, b: 9 }, ['a']);
  assert.deepEqual(c, { a: { from: 1, to: 9 } });
});

test('diffChanges redacts *_enc columns (no plaintext/ciphertext)', () => {
  const c = diffChanges({ password_enc: 'oldcipher' }, { password_enc: 'newcipher' }, ['password_enc']);
  assert.deepEqual(c, { password_enc: { changed: true } });
});

test('diffChanges redacts explicitly-named secret fields', () => {
  const c = diffChanges({ token: 'a' }, { token: 'b' }, ['token'], ['token']);
  assert.deepEqual(c, { token: { changed: true } });
});

test('diffChanges compares objects/JSONB by value', () => {
  const same = diffChanges({ vlans: [{ id: 1 }] }, { vlans: [{ id: 1 }] }, ['vlans']);
  assert.equal(same, null);
  const diff = diffChanges({ vlans: [{ id: 1 }] }, { vlans: [{ id: 2 }] }, ['vlans']);
  assert.deepEqual(diff, { vlans: { from: [{ id: 1 }], to: [{ id: 2 }] } });
});

test('diffChanges normalizes null/undefined to null in output', () => {
  const c = diffChanges({ note: null }, { note: 'hi' }, ['note']);
  assert.deepEqual(c, { note: { from: null, to: 'hi' } });
});
