import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Drives the Portal→Field bridge endpoints for job captures over HTTP with the
// service token. Self-skips unless field/backend/.env.test exists.

const envTestPath = fileURLToPath(new URL('../../.env.test', import.meta.url));
const enabled = existsSync(envTestPath);
const SERVICE_TOKEN = 'integration-test-service-token';

if (!enabled) {
  test('Field field-jobs bridge integration (skipped — create field/backend/.env.test to enable)', { skip: true }, () => {});
} else {
  dotenv.config({ path: envTestPath });
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.ACCESS_TOKEN_SECRET ||= 'test-access-secret';
  process.env.REFRESH_TOKEN_SECRET ||= 'test-refresh-secret';

  const { default: app } = await import(new URL('../../src/app.js', import.meta.url));
  const { pool } = await import(new URL('../../src/db/index.js', import.meta.url));

  let server;
  let baseUrl;
  const jobIds = [];

  async function makeJob({ captureStatus = 'ready', customer = 'ZZ Bridge Customer', days = [] } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO field_work_orders (customer_name, customer_address, hours, description, capture_status)
       VALUES ($1, '1 Test Ln', 1.5, 'Ran cable', $2) RETURNING *`,
      [customer, captureStatus]
    );
    jobIds.push(rows[0].id);

    // Optional day structure (migration 006):
    // [{ date, description, techs: [[initials, hours], …] }]
    for (const [i, day] of days.entries()) {
      const { rows: d } = await pool.query(
        `INSERT INTO field_work_order_days (work_order_id, sort_order, work_date, description)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [rows[0].id, (i + 1) * 10, day.date, day.description ?? null]
      );
      for (const [initials, hours] of day.techs ?? []) {
        await pool.query(
          `INSERT INTO field_work_order_technicians (work_order_id, day_id, initials, hours)
           VALUES ($1,$2,$3,$4)`,
          [rows[0].id, d[0].id, initials, hours]
        );
      }
    }
    return rows[0];
  }

  const svc = (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, { ...opts, headers: { 'X-Service-Token': SERVICE_TOKEN, ...(opts.headers || {}) } });

  before(async () => {
    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const id of jobIds) await pool.query('DELETE FROM field_work_orders WHERE id=$1', [id]);
    await pool.query(`DELETE FROM users WHERE username='it-portal-service'`);
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  test('rejects a request with no service token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/service/field-jobs`);
    assert.equal(res.status, 401);
  });

  test('lists only ready captures', async () => {
    const ready = await makeJob({ captureStatus: 'ready', customer: 'ZZ Ready Co' });
    await makeJob({ captureStatus: 'open', customer: 'ZZ Open Co' });
    const res = await svc('/api/service/field-jobs');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.some((j) => j.id === ready.id));
    assert.ok(!body.some((j) => j.customer_name === 'ZZ Open Co'), 'open jobs must not be listed');
  });

  test('gets one full capture with techs/items/photos arrays', async () => {
    const job = await makeJob();
    const res = await svc(`/api/service/field-jobs/${job.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, job.id);
    assert.ok(Array.isArray(body.technicians));
    assert.ok(Array.isArray(body.items));
    assert.ok(Array.isArray(body.photos));
  });

  test('a multi-day capture crosses the bridge with its days and per-tech hours', async () => {
    // This is the contract the Portal importer depends on: one field day becomes
    // one work_order_section, so the structure must survive the bridge intact.
    const job = await makeJob({
      customer: 'ZZ Multi Day Co',
      days: [
        { date: '2026-07-20', description: 'Cable pull', techs: [['ZD', 4], ['ZE', 2.5]] },
        { date: '2026-07-25', description: 'NVR config', techs: [['ZD', 8]] },
      ],
    });

    const res = await svc(`/api/service/field-jobs/${job.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.days.length, 2);
    assert.deepEqual(body.days.map((d) => Number(d.hours)), [6.5, 8]);
    assert.equal(Number(body.hours), 14.5, 'job hours are the sum of every day');
    assert.equal(body.days[0].technicians.length, 2);
    assert.equal(Number(body.days[0].technicians.find((t) => t.initials === 'ZE').hours), 2.5);

    // The list view carries the range + totals so the inbox card needs no second fetch.
    const list = await svc('/api/service/field-jobs');
    const row = (await list.json()).find((j) => j.id === job.id);
    assert.equal(Number(row.day_count), 2);
    assert.equal(Number(row.hours), 14.5);
    assert.equal(String(row.work_date).slice(0, 10), '2026-07-20');
    assert.equal(String(row.last_date).slice(0, 10), '2026-07-25');
  });

  test('marks a ready capture imported (200) and records the WO number', async () => {
    const job = await makeJob();
    const res = await svc(`/api/service/field-jobs/${job.id}/imported`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_number: 123, actor: 'Test Tech' }),
    });
    assert.equal(res.status, 200);

    const { rows } = await pool.query(
      'SELECT capture_status, imported_at, imported_wo_number FROM field_work_orders WHERE id=$1',
      [job.id]
    );
    assert.equal(rows[0].capture_status, 'imported');
    assert.ok(rows[0].imported_at);
    assert.equal(rows[0].imported_wo_number, 123);
  });

  test('cannot import a capture that is not ready (409)', async () => {
    const job = await makeJob({ captureStatus: 'open' });
    const res = await svc(`/api/service/field-jobs/${job.id}/imported`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_number: 1 }),
    });
    assert.equal(res.status, 409);
  });

  test('importing a missing capture returns 409', async () => {
    const res = await svc('/api/service/field-jobs/00000000-0000-0000-0000-000000000000/imported', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_number: 1 }),
    });
    assert.equal(res.status, 409);
  });
}
