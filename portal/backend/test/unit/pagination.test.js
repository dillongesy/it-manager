// List paging. Every list route used to hard-default to 50 rows with no signal
// that more existed, so a work-order list silently stopped at 50 and looked
// complete. These guard the replacement: sane clamping, and a total count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaging, setTotalCount, DEFAULT_LIMIT, MAX_LIMIT } from '../../src/lib/pagination.js';

test('an empty query gets the default page size, starting at the top', () => {
  assert.deepEqual(parsePaging({}), { limit: DEFAULT_LIMIT, offset: 0 });
  assert.deepEqual(parsePaging(), { limit: DEFAULT_LIMIT, offset: 0 });
});

test('the default is well above the old hard-coded 50', () => {
  assert.ok(DEFAULT_LIMIT > 50);
});

test('explicit limit and offset are honored', () => {
  assert.deepEqual(parsePaging({ limit: '25', offset: '100' }), { limit: 25, offset: 100 });
});

test('limit is clamped to MAX_LIMIT so one request can never be unbounded', () => {
  assert.equal(parsePaging({ limit: '999999' }).limit, MAX_LIMIT);
  assert.equal(parsePaging({ limit: String(MAX_LIMIT + 1) }).limit, MAX_LIMIT);
});

test('garbage and non-positive values fall back to the default rather than reaching SQL', () => {
  assert.equal(parsePaging({ limit: 'abc' }).limit, DEFAULT_LIMIT);
  assert.equal(parsePaging({ limit: '0' }).limit, DEFAULT_LIMIT);
  assert.equal(parsePaging({ limit: '-5' }).limit, DEFAULT_LIMIT);
  assert.equal(parsePaging({ limit: null }).limit, DEFAULT_LIMIT);
});

test('a negative or unparseable offset collapses to 0', () => {
  assert.equal(parsePaging({ offset: '-10' }).offset, 0);
  assert.equal(parsePaging({ offset: 'xyz' }).offset, 0);
});

test('a route can lower the default without losing the clamp', () => {
  assert.equal(parsePaging({}, { defaultLimit: 50 }).limit, 50);
  assert.equal(parsePaging({ limit: '999' }, { defaultLimit: 50 }).limit, MAX_LIMIT);
  assert.equal(parsePaging({ limit: '999' }, { defaultLimit: 50, maxLimit: 200 }).limit, 200);
});

test('paging math lines up — consecutive pages neither skip nor repeat a row', () => {
  const pages = [0, 1, 2].map((i) => parsePaging({ limit: '100', offset: String(i * 100) }));
  assert.deepEqual(pages.map((p) => p.offset), [0, 100, 200]);
  assert.deepEqual(pages.map((p) => p.offset + p.limit), [100, 200, 300]);
});

test('setTotalCount publishes the header the client pages against', () => {
  const headers = {};
  setTotalCount({ setHeader: (k, v) => { headers[k] = v; } }, 312);
  assert.equal(headers['X-Total-Count'], '312');
});

test('setTotalCount coerces a Postgres string/NaN count to a clean number', () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  setTotalCount(res, '312');
  assert.equal(headers['X-Total-Count'], '312');
  setTotalCount(res, undefined);
  assert.equal(headers['X-Total-Count'], '0');
});
