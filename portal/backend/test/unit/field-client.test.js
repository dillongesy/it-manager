import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQuery } from '../../src/lib/field-client.js';

test('toQuery returns empty string for no params', () => {
  assert.equal(toQuery({}), '');
});

test('toQuery skips undefined, null, and empty-string values', () => {
  assert.equal(toQuery({ a: undefined, b: null, c: '' }), '');
  assert.equal(toQuery({ search: 'cam', category: undefined }), '?search=cam');
});

test('toQuery builds and joins multiple params', () => {
  assert.equal(toQuery({ search: 'cam', category: 'Cameras' }), '?search=cam&category=Cameras');
});

test('toQuery URL-encodes keys and values', () => {
  assert.equal(toQuery({ search: 'a b&c' }), '?search=a%20b%26c');
});

test('toQuery keeps falsy-but-valid values like 0 and false', () => {
  assert.equal(toQuery({ offset: 0, flag: false }), '?offset=0&flag=false');
});
