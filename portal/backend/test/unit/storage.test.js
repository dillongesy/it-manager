import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { growthPerDay, forecast, directorySize } from '../../src/lib/storage.js';

const GB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-08T12:00:00Z');
const daysAgo = (d) => new Date(now.getTime() - d * DAY);

test('growthPerDay fits a straight line through the history', () => {
  const history = [0, 5, 10, 15, 20].map(d => ({ takenAt: daysAgo(20 - d), used: 100 * GB + d * GB }));
  assert.equal(Math.round(growthPerDay(history, now) / GB), 1);
});

test('growthPerDay ignores points older than the window and needs at least a day of history', () => {
  assert.equal(growthPerDay([{ takenAt: daysAgo(0.5), used: 1 }, { takenAt: now, used: 2 }], now), null);
  assert.equal(growthPerDay([{ takenAt: now, used: 1 }], now), null);
  const history = [{ takenAt: daysAgo(90), used: 0 }, { takenAt: daysAgo(10), used: 50 * GB }, { takenAt: now, used: 50 * GB }];
  assert.equal(growthPerDay(history, now), 0);
});

test('forecast: days until full and the date it happens', () => {
  const disk = { total: 100 * GB, free: 30 * GB, used: 70 * GB };
  const history = [{ takenAt: daysAgo(10), used: 60 * GB }, { takenAt: now, used: 70 * GB }];
  const f = forecast(disk, history, now);
  assert.equal(f.usedPercent, 70);
  assert.equal(f.daysUntilFull, 30);
  assert.equal(f.fullBy, '2026-12-08');
  assert.equal(f.status, 'warning');            // under 60 days
});

test('forecast status: by fullness, by time left, and no forecast without growth', () => {
  const flat = [{ takenAt: daysAgo(10), used: 50 * GB }, { takenAt: now, used: 50 * GB }];
  assert.deepEqual(
    [forecast({ total: 100 * GB, free: 50 * GB }, flat, now).status,
     forecast({ total: 100 * GB, free: 15 * GB }, flat, now).status,
     forecast({ total: 100 * GB, free: 5 * GB }, flat, now).status],
    ['ok', 'warning', 'critical'],
  );
  const flatForecast = forecast({ total: 100 * GB, free: 50 * GB }, flat, now);
  assert.equal(flatForecast.daysUntilFull, null);
  assert.equal(flatForecast.fullBy, null);

  const fast = [{ takenAt: daysAgo(2), used: 40 * GB }, { takenAt: now, used: 50 * GB }];
  assert.equal(forecast({ total: 100 * GB, free: 50 * GB }, fast, now).status, 'critical');   // full in 10 days
});

test('directorySize adds up nested files and treats a missing folder as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storage-test-'));
  try {
    await mkdir(join(dir, 'a', 'b'), { recursive: true });
    await writeFile(join(dir, 'one.bin'), Buffer.alloc(1000));
    await writeFile(join(dir, 'a', 'b', 'two.bin'), Buffer.alloc(234));
    assert.equal(await directorySize(dir), 1234);
    assert.equal(await directorySize(join(dir, 'missing')), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
