import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../src/config/index.js';
import { hostStatus, requestHostChange, UPDATE_PRESET, backupSettingsLines, BACKUP_SCHEDULE, BACKUP_NAME } from '../../src/lib/host-control.js';

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

test('a network change is validated and sent as whitelisted lines', async () => {
  const saved = config.hostControlDir;
  const dir = await mkdtemp(join(tmpdir(), 'host-control-'));
  const seen = [];
  const stop = fakeHelper(dir, (fields) => { seen.push(fields); return { ok: true }; });
  try {
    config.hostControlDir = dir;
    await writeFile(join(dir, 'status.json'), JSON.stringify({ agent: true }));
    const network = { lan: ['192.168.50.0/24', '10.8.0.0/24'], names: ['portal.office.lan'] };
    assert.deepEqual(await requestHostChange({ network }), { ok: true, error: null });
    assert.deepEqual(seen.map(({ id, ...rest }) => rest),
      [{ network: 'apply', lan: '192.168.50.0/24,10.8.0.0/24', names: 'portal.office.lan' }]);

    for (const bad of [
      { lan: [] },
      { lan: ['192.168.50.0'] },
      { lan: ['192.168.50.0/24\nfirewall=off'] },
      { lan: ['300.1.1.0/24'] },
      { lan: Array.from({ length: 9 }, (_, i) => `10.${i}.0.0/16`) },
      { lan: ['192.168.50.0/24'], names: ['bad name'] },
      { lan: ['192.168.50.0/24'], names: ['a.lan\nupdate=now'] },
    ]) {
      await assert.rejects(requestHostChange({ network: bad }), (e) => e.status === 400, JSON.stringify(bad));
    }
    await assert.rejects(access(join(dir, 'request')));
  } finally {
    stop();
    config.hostControlDir = saved;
    await rm(dir, { recursive: true, force: true });
  }
});

const goodBackup = {
  schedule: 'weekly:mon,wed,fri:00:30', storage: 'smb', share: '//nas.office.lan/Backups/IT Manager',
  user: 'svc-backup', domain: 'OFFICE', password: 'p@ss=word', keep: { last: 3, daily: 7, weekly: 4, monthly: 6, yearly: 1 },
  compress: 'zstd', encryption: 'set', passphrase: 'correct horse battery=', includeKeys: true, verify: true,
};

test('backup schedules and names', () => {
  for (const ok of ['off', 'daily:01:00', 'daily:23:59', 'weekly:sun:02:30', 'weekly:mon,wed,fri:00:00']) assert.ok(BACKUP_SCHEDULE.test(ok), ok);
  for (const bad of ['daily:1:00', 'daily:24:00', 'weekly::01:00', 'weekly:sunday:01:00', 'daily:01:00\nupdate=now']) assert.ok(!BACKUP_SCHEDULE.test(bad), JSON.stringify(bad));
  assert.ok(BACKUP_NAME.test('itm-2026_11_10-01_00_03.tar.zst.gpg'));
  for (const bad of ['../etc/passwd', 'itm-2026_11_10-01_00_03.tar.zst\nx', 'itm-x.tar']) assert.ok(!BACKUP_NAME.test(bad), bad);
});

test('backup settings become whitelisted lines with encoded secrets', () => {
  const lines = backupSettingsLines(goodBackup);
  assert.ok(lines.includes('backup-share=//nas.office.lan/Backups/IT Manager'));
  assert.ok(lines.includes('backup-keep=3,7,4,6,1'));
  assert.ok(lines.includes(`backup-pass=${Buffer.from('p@ss=word').toString('base64')}`));
  assert.ok(lines.includes(`backup-passphrase=${Buffer.from('correct horse battery=').toString('base64')}`));
  assert.ok(!lines.some(l => l.includes('p@ss=word') || l.includes('correct horse')));   // never in clear
  assert.ok(lines.every(l => !/[\r\n]/.test(l)));

  const bad = (patch) => assert.throws(() => backupSettingsLines({ ...goodBackup, ...patch }), (e) => e.status === 400, JSON.stringify(patch));
  bad({ schedule: 'hourly' });
  bad({ storage: 's3' });
  bad({ share: '//nas/x;reboot' });
  bad({ share: 'nas/share' });
  bad({ storage: 'local', path: '/etc/cron.d' });
  bad({ storage: 'local', path: '/var/../etc' });
  bad({ storage: 'local', path: 'relative/dir' });
  bad({ storage: 'nfs', share: '//nas/x' });
  bad({ user: 'a b' });
  bad({ password: 'line\nbreak' });
  bad({ keep: { last: -1 } });
  bad({ keep: { daily: 1.5 } });
  bad({ compress: 'xz' });
  bad({ encryption: 'set', passphrase: 'too short' });
  assert.deepEqual(backupSettingsLines({ ...goodBackup, storage: 'local', path: '/mnt/backup/' }).filter(l => l.startsWith('backup-path')), ['backup-path=/mnt/backup']);
});

test('backup tasks need a valid backup name', async () => {
  const saved = config.hostControlDir;
  const dir = await mkdtemp(join(tmpdir(), 'host-control-'));
  const seen = [];
  const stop = fakeHelper(dir, (fields) => { seen.push(fields); return { ok: true }; });
  try {
    config.hostControlDir = dir;
    await writeFile(join(dir, 'status.json'), JSON.stringify({ agent: true }));
    await requestHostChange({ backupTask: { task: 'now' } });
    await requestHostChange({ backupTask: { task: 'restore', name: 'itm-2026_11_10-01_00_03.tar.zst' } });
    assert.deepEqual(seen.map(({ id, ...rest }) => rest), [
      { 'backup-task': 'now' },
      { 'backup-task': 'restore', 'backup-name': 'itm-2026_11_10-01_00_03.tar.zst' },
    ]);
    await assert.rejects(requestHostChange({ backupTask: { task: 'restore', name: '../x' } }), (e) => e.status === 400);
    await assert.rejects(requestHostChange({ backupTask: { task: 'format-disk' } }), (e) => e.status === 400);
  } finally {
    stop();
    config.hostControlDir = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
