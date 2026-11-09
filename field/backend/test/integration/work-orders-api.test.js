import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// Boots the real app against a throwaway DB and drives the work-order lifecycle
// over HTTP. Self-skips unless field/backend/.env.test exists.

const envTestPath = fileURLToPath(new URL('../../.env.test', import.meta.url));
const enabled = existsSync(envTestPath);

if (!enabled) {
  test('Field work-orders integration (skipped — create field/backend/.env.test to enable)', { skip: true }, () => {});
} else {
  dotenv.config({ path: envTestPath });
  process.env.NODE_ENV = 'test';
  process.env.ACCESS_TOKEN_SECRET ||= 'test-access-secret';
  process.env.REFRESH_TOKEN_SECRET ||= 'test-refresh-secret';
  process.env.SERVICE_TOKEN ||= 'unused-here';

  const { default: app } = await import(new URL('../../src/app.js', import.meta.url));
  const { pool } = await import(new URL('../../src/db/index.js', import.meta.url));

  let server;
  let baseUrl;
  let adminId;
  let linkedTechId;
  let token;
  const woIds = [];
  const itemIds = [];

  function signFor(user) {
    return jwt.sign(
      { sub: user.id, username: user.username, role: user.role, fullName: user.full_name, initials: user.initials },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );
  }

  const auth = (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });

  const createWO = async (body) => {
    const res = await auth('/api/work-orders', { method: 'POST', body: JSON.stringify(body) });
    const wo = await res.json();
    if (wo?.id) woIds.push(wo.id);
    return { res, wo };
  };

  before(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const admin = await pool.query(
      `INSERT INTO users (username, full_name, initials, password_hash, role)
       VALUES ($1,'ZZ Test Admin','TA','x','admin') RETURNING id, username, full_name, role, initials`,
      [`zz_admin_${suffix}`]
    );
    adminId = admin.rows[0].id;
    token = signFor(admin.rows[0]);

    const tech = await pool.query(
      `INSERT INTO users (username, full_name, initials, password_hash, role)
       VALUES ($1,'ZZ Linked Tech','LT','x','camera_tech') RETURNING id`,
      [`zz_tech_${suffix}`]
    );
    linkedTechId = tech.rows[0].id;

    const item = await pool.query(
      `INSERT INTO inventory_items (name, sku, quantity, unit)
       VALUES ('ZZ WO Test Item', $1, 50, 'ea') RETURNING id`,
      ['TEST-WO-' + suffix.toUpperCase()]
    );
    itemIds.push(item.rows[0].id);

    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const id of woIds) await pool.query('DELETE FROM field_work_orders WHERE id=$1', [id]); // cascades techs+items
    for (const id of itemIds) await pool.query('DELETE FROM inventory_items WHERE id=$1', [id]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[adminId, linkedTechId]]);
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  test('rejects unauthenticated requests (401)', async () => {
    const res = await fetch(`${baseUrl}/api/work-orders`);
    assert.equal(res.status, 401);
  });

  test('requires a customer name (400)', async () => {
    const { res } = await createWO({ customer_name: '   ' });
    assert.equal(res.status, 400);
  });

  test('creates a draft with BOTH a linked tech and a free-typed tech, plus a line item', async () => {
    const { res, wo } = await createWO({
      customer_name: 'Acme Corp',
      customer_address: '1 Main St',
      days: [{
        work_date: '2026-07-20',
        technicians: [
          { user_id: linkedTechId, hours: 2.5 },              // dropdown pick
          { initials: 'zz', name: 'Free Type', hours: 1.5 },  // typed on the spot
        ],
        items: [{ inventory_item_id: itemIds[0], description: 'ZZ WO Test Item', quantity: 3 }],
      }],
    });
    assert.equal(res.status, 201);
    assert.equal(wo.capture_status, 'open');
    assert.equal(wo.days.length, 1);
    assert.equal(wo.days[0].technicians.length, 2);

    // Linked tech resolves its initials from the users table; free-text keeps typed values.
    const linked = wo.days[0].technicians.find((t) => t.user_id);
    const free = wo.days[0].technicians.find((t) => !t.user_id);
    assert.equal(linked.initials, 'LT');
    assert.equal(Number(linked.hours), 2.5);
    assert.equal(free.initials, 'ZZ');
    assert.equal(free.full_name, 'Free Type');
    assert.equal(wo.days[0].items.length, 1);
    assert.equal(Number(wo.days[0].items[0].quantity), 3);

    // The day's hours — and the job's — are the SUM of the technicians, never a
    // separately-entered figure that could disagree with them.
    assert.equal(Number(wo.days[0].hours), 4);
    assert.equal(Number(wo.hours), 4);
  });

  test('a multi-day job keeps each day’s date, crew, hours and parts separate', async () => {
    const { res, wo } = await createWO({
      customer_name: 'Three Day Install',
      days: [
        { work_date: '2026-07-20', description: 'Cable pull',
          technicians: [{ initials: 'zd', name: 'Day One', hours: 4 }] },
        { work_date: '2026-07-21', description: 'Mount cameras',
          technicians: [{ initials: 'zd', name: 'Day One', hours: 3 }],
          items: [{ inventory_item_id: itemIds[0], description: 'ZZ WO Test Item', quantity: 2 }] },
        { work_date: '2026-07-25', description: 'NVR config',
          technicians: [{ initials: 'zd', name: 'Day One', hours: 8 }, { initials: 'ze', hours: 8 }] },
      ],
    });
    assert.equal(res.status, 201);
    assert.equal(wo.days.length, 3);
    assert.deepEqual(wo.days.map((d) => String(d.work_date).slice(0, 10)),
      ['2026-07-20', '2026-07-21', '2026-07-25']);
    assert.deepEqual(wo.days.map((d) => Number(d.hours)), [4, 3, 16]);
    assert.equal(Number(wo.hours), 23);

    // Parts belong to the day they were used on, not the whole job.
    assert.equal(wo.days[0].items.length, 0);
    assert.equal(wo.days[1].items.length, 1);

    // The job's own work_date tracks its FIRST day so list sorting still works.
    assert.equal(String(wo.work_date).slice(0, 10), '2026-07-20');
  });

  test('editing replaces the whole day structure — adding and removing days', async () => {
    const { wo } = await createWO({
      customer_name: 'Grows',
      days: [{ work_date: '2026-07-20', technicians: [{ initials: 'zg', hours: 2 }] }],
    });

    const grow = await auth(`/api/work-orders/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        customer_name: 'Grown',
        days: [
          { work_date: '2026-07-20', technicians: [{ initials: 'zg', hours: 2 }] },
          { work_date: '2026-07-22', technicians: [{ initials: 'zg', hours: 5 }] },
        ],
      }),
    });
    assert.equal(grow.status, 200);
    const grown = await grow.json();
    assert.equal(grown.customer_name, 'Grown');
    assert.equal(grown.days.length, 2);
    assert.equal(Number(grown.hours), 7);

    const shrink = await auth(`/api/work-orders/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ days: [{ work_date: '2026-07-22', technicians: [{ initials: 'zg', hours: 5 }] }] }),
    });
    const shrunk = await shrink.json();
    assert.equal(shrunk.days.length, 1);
    assert.equal(Number(shrunk.hours), 5);
  });

  test('a partial edit that says nothing about days leaves them untouched', async () => {
    const { wo } = await createWO({
      customer_name: 'Keep My Days',
      days: [
        { work_date: '2026-07-20', technicians: [{ initials: 'zk', hours: 4 }] },
        { work_date: '2026-07-21', technicians: [{ initials: 'zk', hours: 6 }] },
      ],
    });
    const res = await auth(`/api/work-orders/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ customer_name: 'Renamed Only' }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.customer_name, 'Renamed Only');
    assert.equal(updated.days.length, 2, 'renaming the customer must not drop days');
    assert.equal(Number(updated.hours), 10);
  });

  test('a flat pre-days payload still works and becomes a single Day 1', async () => {
    const { res, wo } = await createWO({
      customer_name: 'Legacy Client',
      work_date: '2026-07-20',
      hours: 2.5,
      technicians: [{ initials: 'zl', name: 'Legacy Tech' }],
      items: [{ inventory_item_id: itemIds[0], description: 'ZZ WO Test Item', quantity: 1 }],
    });
    assert.equal(res.status, 201);
    assert.equal(wo.days.length, 1);
    assert.equal(wo.days[0].items.length, 1);
    // One technician means the old lump total unambiguously belongs to them.
    assert.equal(Number(wo.days[0].technicians[0].hours), 2.5);
    assert.equal(Number(wo.hours), 2.5);
  });

  test('a flat payload with several techs keeps the lump total in the notes, not invented per-tech', async () => {
    const { wo } = await createWO({
      customer_name: 'Legacy Crew',
      hours: 6,
      technicians: [{ initials: 'zm' }, { initials: 'zn' }],
    });
    assert.equal(wo.days.length, 1);
    assert.equal(Number(wo.hours), 0, 'no hours are invented for either tech');
    assert.match(wo.days[0].notes, /6 total hours/);
  });

  test('edits an open capture (200)', async () => {
    const { wo } = await createWO({ customer_name: 'Edit Me' });
    const res = await auth(`/api/work-orders/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        customer_name: 'Edited',
        days: [{ work_date: '2026-07-20', technicians: [{ initials: 'ze', hours: 4 }] }],
      }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.customer_name, 'Edited');
    assert.equal(Number(updated.hours), 4);
  });

  const stockOf = async (id) =>
    Number((await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [id])).rows[0].quantity);

  test('marking ready consumes stock; reopening returns it', async () => {
    const before = await stockOf(itemIds[0]);
    const { wo } = await createWO({
      customer_name: 'Stock Flow',
      items: [{ inventory_item_id: itemIds[0], description: 'ZZ WO Test Item', quantity: 4 }],
    });

    const ready = await auth(`/api/work-orders/${wo.id}/ready`, { method: 'POST' });
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).capture_status, 'ready');
    assert.equal(await stockOf(itemIds[0]), before - 4, 'stock should drop by 4 on ready');

    const reopen = await auth(`/api/work-orders/${wo.id}/reopen`, { method: 'POST' });
    assert.equal(reopen.status, 200);
    assert.equal((await reopen.json()).capture_status, 'open');
    assert.equal(await stockOf(itemIds[0]), before, 'stock should be restored on reopen');
  });

  test('a ready capture cannot be edited (409)', async () => {
    const { wo } = await createWO({ customer_name: 'Lock' });
    await auth(`/api/work-orders/${wo.id}/ready`, { method: 'POST' });
    const res = await auth(`/api/work-orders/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ customer_name: 'Nope' }),
    });
    assert.equal(res.status, 409);
  });

  test('reopening an already-open capture is rejected (409)', async () => {
    const { wo } = await createWO({ customer_name: 'Skip' });
    const res = await auth(`/api/work-orders/${wo.id}/reopen`, { method: 'POST' });
    assert.equal(res.status, 409);
  });

  test('only open captures can be deleted (409 once ready, 200 while open)', async () => {
    const { wo: ready } = await createWO({ customer_name: 'NoDelete' });
    await auth(`/api/work-orders/${ready.id}/ready`, { method: 'POST' });
    const blocked = await auth(`/api/work-orders/${ready.id}`, { method: 'DELETE' });
    assert.equal(blocked.status, 409);

    const { wo: open } = await createWO({ customer_name: 'OkDelete' });
    const ok = await auth(`/api/work-orders/${open.id}`, { method: 'DELETE' });
    assert.equal(ok.status, 200);
  });
}
