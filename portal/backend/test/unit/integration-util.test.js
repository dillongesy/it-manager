// Shared integration plumbing: OAuth token reuse and forgetting old credentials.
// The failures these prevent: an old token (or a list fetched with the old key) still
// used after an admin changes an integration's credentials, until it happens to expire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBearer, makeCache, onIntegrationChange, integrationChanged } from '../../src/lib/integration-util.js';
import { config } from '../../src/config/index.js';
import { _raw as dell } from '../../src/lib/dell-client.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fresh = (value) => ({ value, expires: Date.now() + 3600_000 });

test('makeBearer: concurrent callers share one sign-in, then the token is reused', async () => {
  let calls = 0;
  const bearer = makeBearer(async () => fresh(`t${++calls}`));
  const [a, b] = await Promise.all([bearer(), bearer()]);
  assert.deepEqual([a, b, await bearer(), calls], ['t1', 't1', 't1', 1]);
});

test('makeBearer: expire() signs in again; a nearly-expired token is not used', async () => {
  let calls = 0;
  const bearer = makeBearer(async () => ({ value: `t${++calls}`, expires: Date.now() + (calls === 1 ? 30_000 : 3600_000) }));
  assert.equal(await bearer(), 't1');
  assert.equal(await bearer(), 't2');          // t1 had under a minute left
  bearer.expire();
  assert.equal(await bearer(), 't3');
});

test('makeBearer: a failed sign-in is not cached', async () => {
  let calls = 0;
  const bearer = makeBearer(async () => { if (++calls === 1) throw new Error('rejected'); return fresh('ok'); });
  await assert.rejects(bearer(), /rejected/);
  assert.equal(await bearer(), 'ok');
});

test('makeBearer: reset() discards a sign-in that was still running with the old credentials', async () => {
  const slow = deferred();
  let calls = 0;
  let sawCurrent;
  const bearer = makeBearer(async (isCurrent) => {
    if (++calls === 1) { await slow.promise; sawCurrent = isCurrent(); return fresh('old'); }
    return fresh('new');
  });
  const first = bearer();
  bearer.reset();                               // the admin saved new credentials
  const second = bearer();                      // starts its own sign-in, not the old one
  slow.resolve();
  assert.equal(await first, 'old');             // that caller started before the change
  assert.equal(sawCurrent, false);
  assert.equal(await second, 'new');
  assert.equal(await bearer(), 'new');          // the old token never became the shared one
  assert.equal(calls, 2);
});

test('makeCache: clear() while a load is running keeps the stale result out', async () => {
  const cache = makeCache(60_000);
  const slow = deferred();
  const loading = cache.get('k', false, async () => { await slow.promise; return 'old account'; });
  cache.clear();
  slow.resolve();
  assert.equal(await loading, 'old account');
  assert.equal(await cache.get('k', false, async () => 'new account'), 'new account');
  assert.equal(await cache.get('k', false, async () => 'not called'), 'new account');
});

test('integrationChanged runs only that integration\'s resetters, and one failing doesn\'t stop the rest', () => {
  const ran = [];
  onIntegrationChange('test-a', () => ran.push('a1'));
  onIntegrationChange('test-a', () => { throw new Error('boom'); });
  onIntegrationChange('test-a', () => ran.push('a3'));
  onIntegrationChange('test-b', () => ran.push('b'));
  const err = console.error; console.error = () => {};
  try { integrationChanged('test-a'); } finally { console.error = err; }
  integrationChanged('nobody-registered');
  assert.deepEqual(ran, ['a1', 'a3']);
});

test('Dell: new credentials take effect on the next call, not when the old token expires', async () => {
  const realFetch = globalThis.fetch;
  const saved = { ...config.dell };
  const sentIds = [];
  globalThis.fetch = async (url, init) => {
    const id = new URLSearchParams(init.body).get('client_id');
    sentIds.push(id);
    return new Response(JSON.stringify({ access_token: `token-for-${id}`, expires_in: 3600 }), { status: 200 });
  };
  try {
    dell.reset();
    Object.assign(config.dell, { clientId: 'old-id', clientSecret: 'old-secret' });
    assert.equal(await dell.bearer(), 'token-for-old-id');
    assert.equal(await dell.bearer(), 'token-for-old-id');      // reused

    Object.assign(config.dell, { clientId: 'new-id', clientSecret: 'new-secret' });
    integrationChanged('dell');                                  // what saveIntegration does
    assert.equal(await dell.bearer(), 'token-for-new-id');
    assert.deepEqual(sentIds, ['old-id', 'new-id']);
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(config.dell, saved);
    dell.reset();
  }
});
