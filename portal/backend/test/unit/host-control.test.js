import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../src/config/index.js';
import { hostStatus, requestHostChange, UPDATE_PRESET } from '../../src/lib/host-control.js';

// A stand-in for install.sh host-apply: answers each request with result.json.
function fakeHelper(dir, respond) {
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        const body = await readFile(join(dir, 'request'), 'utf8');
        await rm(join(dir, 'request'));
        const fields = Object.fromEntries(body.trim().split('\n').map(l => l.split('=')));
        await writeFile(join(dir, 'result.json'), JSON.stringify({ id: fields.id, ...respond(fields) }));
      } catch { /* no request yet */ }
      await new Promise(r => setTimeout(r, 20));
    }
  })();
  return () => { stop = true; };
}

test('update schedule presets', () => {
  for (const ok of ['off', 'daily:02', 'daily:23', 'weekly:sun:02', 'weekly:mon:00']) assert.ok(UPDATE_PRESET.test(ok), ok);
  for (const bad of ['', 'daily:24', 'daily:2', 'weekly:sunday:02', 'weekly:sun', 'hourly', 'off\nfirewall=off']) {
    assert.ok(!UPDATE_PRESET.test(bad), JSON.stringify(bad));
  }
});

test('without the host helper, settings are unavailable', async () => {
  const saved = config.hostControlDir;
  const dir = await mkdtemp(join(tmpdir(), 'host-control-'));
  try {
    config.hostControlDir = null;
    assert.equal(await hostStatus(), null);
    config.hostControlDir = dir;                       // folder exists, no status.json
    assert.equal(await hostStatus(), null);
    await assert.rejects(requestHostChange({ updates: 'daily:02' }), (e) => e.status === 503);
  } finally {
    config.hostControlDir = saved;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a request is written as whitelisted lines and its result is returned', async () => {
  const saved = config.hostControlDir;
  const dir = await mkdtemp(join(tmpdir(), 'host-control-'));
  const seen = [];
  const stop = fakeHelper(dir, (fields) => { seen.push(fields); return fields.update ? { ok: false, error: 'busy' } : { ok: true }; });
  try {
    config.hostControlDir = dir;
    await writeFile(join(dir, 'status.json'), JSON.stringify({ agent: true, updates: 'weekly:sun:02' }));
    assert.equal((await hostStatus()).updates, 'weekly:sun:02');

    assert.deepEqual(await requestHostChange({ updates: 'daily:03' }), { ok: true, error: null });
    assert.deepEqual(await requestHostChange({ update: 'now' }), { ok: false, error: 'busy' });
    assert.deepEqual(seen.map(({ id, ...rest }) => rest), [{ updates: 'daily:03' }, { update: 'now' }]);

    await assert.rejects(requestHostChange({ updates: 'daily:03\nfirewall=off' }), (e) => e.status === 400);
    await assert.rejects(requestHostChange({ firewall: 'off' }), (e) => e.status === 400);   // not settable from the Portal
    await assert.rejects(requestHostChange({ update: 'later' }), (e) => e.status === 400);
    await assert.rejects(requestHostChange({}), (e) => e.status === 400);
    await assert.rejects(access(join(dir, 'request')));   // invalid requests are never written
  } finally {
    stop();
    config.hostControlDir = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
