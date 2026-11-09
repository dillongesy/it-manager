import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Integration tests boot the real Express app against a throwaway test database
// and drive it over HTTP — exercising the actual routes, middleware, and SQL.
// They self-skip unless field/backend/.env.test exists (see .env.test.example).

const envTestPath = fileURLToPath(new URL('../../.env.test', import.meta.url));
const enabled = existsSync(envTestPath);

const SERVICE_TOKEN = 'integration-test-service-token';

if (!enabled) {
  test('Field service integration (skipped — create field/backend/.env.test to enable)', { skip: true }, () => {});
} else {
  // Env must be set BEFORE importing config/app (config reads env at import time).
  dotenv.config({ path: envTestPath });
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.ACCESS_TOKEN_SECRET ||= 'test-access-secret';
  process.env.REFRESH_TOKEN_SECRET ||= 'test-refresh-secret';

  const { default: app } = await import(new URL('../../src/app.js', import.meta.url));
  const { pool } = await import(new URL('../../src/db/index.js', import.meta.url));

  let server;
  let baseUrl;
  const createdItemIds = [];

  async function makeItem({ quantity = 10, threshold = 2 } = {}) {
    const sku = 'TEST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO inventory_items (name, category, sku, quantity, low_stock_threshold, unit)
       VALUES ('ZZ Integration Test Item', 'Test', $1, $2, $3, 'ea') RETURNING *`,
      [sku, quantity, threshold]
    );
    createdItemIds.push(rows[0].id);
    return rows[0];
  }

  const svc = (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { 'X-Service-Token': SERVICE_TOKEN, ...(opts.headers || {}) },
    });

  before(async () => {
    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const id of createdItemIds) {
      await pool.query('DELETE FROM inventory_transactions WHERE item_id=$1', [id]);
      await pool.query('DELETE FROM inventory_items WHERE id=$1', [id]);
    }
    await pool.query(`DELETE FROM users WHERE username='it-portal-service'`);
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  test('rejects a request with no service token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/service/inventory`);
    assert.equal(res.status, 401);
  });

  test('rejects a request with the wrong service token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/service/inventory`, {
      headers: { 'X-Service-Token': 'nope' },
    });
    assert.equal(res.status, 401);
  });

  test('lists inventory with a valid token (200, array)', async () => {
    await makeItem();
    const res = await svc('/api/service/inventory');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.some((i) => i.name === 'ZZ Integration Test Item'));
  });

  test('gets one item with its ledger', async () => {
    const item = await makeItem();
    const res = await svc(`/api/service/inventory/${item.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, item.id);
    assert.ok(Array.isArray(body.transactions));
  });

  test('checkout decrements stock and writes an IT-attributed ledger row', async () => {
    const item = await makeItem({ quantity: 10 });
    const res = await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 3, actor: 'Test Tech', notes: 'unit job' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(Number(body.quantity), 7);

    // Ledger row exists, attributed to the service account, with the IT tag + actor.
    const { rows } = await pool.query(
      `SELECT it.type, it.quantity_delta, it.quantity_after, it.reference_type, it.notes, u.full_name, u.is_active
       FROM inventory_transactions it
       JOIN users u ON u.id = it.user_id
       WHERE it.item_id=$1 AND it.type='checkout'
       ORDER BY it.created_at DESC LIMIT 1`,
      [item.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].quantity_delta), -3);
    assert.equal(Number(rows[0].quantity_after), 7);
    assert.equal(rows[0].reference_type, 'it_portal');
    assert.equal(rows[0].full_name, 'IT Portal');
    assert.equal(rows[0].is_active, false); // service account can never log in
    assert.equal(rows[0].notes, '[IT Portal: Test Tech] unit job');
  });

  test('checkout beyond available stock is rejected (409) and leaves stock unchanged', async () => {
    const item = await makeItem({ quantity: 2 });
    const res = await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 }),
    });
    assert.equal(res.status, 409);

    const { rows } = await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id]);
    assert.equal(Number(rows[0].quantity), 2); // rolled back, untouched
  });

  test('checkout with a non-positive quantity is rejected (400)', async () => {
    const item = await makeItem({ quantity: 5 });
    for (const bad of [0, -1]) {
      const res = await svc(`/api/service/inventory/${item.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: bad }),
      });
      assert.equal(res.status, 400, `quantity ${bad} should be rejected`);
    }
    const { rows } = await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id]);
    assert.equal(Number(rows[0].quantity), 5);
  });

  test('checkout on a missing item returns 404', async () => {
    const res = await svc('/api/service/inventory/00000000-0000-0000-0000-000000000000/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1 }),
    });
    assert.equal(res.status, 404);
  });

  // ─── Return (powers WO part edit/delete reconciliation) ──────────────────────

  test('return adds stock back and writes an IT-attributed return ledger row', async () => {
    const item = await makeItem({ quantity: 5 });
    const res = await svc(`/api/service/inventory/${item.id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 2, actor: 'Test Tech', notes: 'WO part removed: Switch' }),
    });
    assert.equal(res.status, 200);
    assert.equal(Number((await res.json()).quantity), 7);

    const { rows } = await pool.query(
      `SELECT it.type, it.quantity_delta, it.quantity_after, it.reference_type, it.notes, u.full_name
       FROM inventory_transactions it JOIN users u ON u.id = it.user_id
       WHERE it.item_id=$1 AND it.type='return' ORDER BY it.created_at DESC LIMIT 1`,
      [item.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].quantity_delta), 2);   // positive = added back
    assert.equal(Number(rows[0].quantity_after), 7);
    assert.equal(rows[0].reference_type, 'it_portal');
    assert.equal(rows[0].full_name, 'IT Portal');
    assert.equal(rows[0].notes, '[IT Portal: Test Tech] WO part removed: Switch');
  });

  test('checkout then return nets to zero (the delete-a-linked-part flow)', async () => {
    const item = await makeItem({ quantity: 10 });
    await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 4 }),
    });
    let q = (await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0].quantity;
    assert.equal(Number(q), 6); // consumed 4

    await svc(`/api/service/inventory/${item.id}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 4 }),
    });
    q = (await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0].quantity;
    assert.equal(Number(q), 10); // returned 4 → back to original
  });

  test('edit reconciliation: net delta when increasing a linked qty (4 → 6 consumes 2 more)', async () => {
    // Mirrors the WO edit path: original consumed 4, new qty 6 → checkout the diff.
    const item = await makeItem({ quantity: 10 });
    await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 4 }),
    });
    // qty raised to 6 → consume 2 more
    await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 2 }),
    });
    const q = (await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0].quantity;
    assert.equal(Number(q), 4); // 10 - 4 - 2
  });

  test('edit reconciliation: return the difference when decreasing a linked qty (4 → 1 returns 3)', async () => {
    const item = await makeItem({ quantity: 10 });
    await svc(`/api/service/inventory/${item.id}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 4 }),
    });
    // qty lowered to 1 → return 3
    await svc(`/api/service/inventory/${item.id}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 3 }),
    });
    const q = (await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0].quantity;
    assert.equal(Number(q), 9); // 10 - 4 + 3 = 9 (net 1 consumed, matching lowered qty)
  });

  test('return with a non-positive quantity is rejected (400)', async () => {
    const item = await makeItem({ quantity: 5 });
    for (const bad of [0, -1]) {
      const res = await svc(`/api/service/inventory/${item.id}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: bad }),
      });
      assert.equal(res.status, 400, `quantity ${bad} should be rejected`);
    }
    const { rows } = await pool.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id]);
    assert.equal(Number(rows[0].quantity), 5);
  });

  test('return on a missing item returns 404', async () => {
    const res = await svc('/api/service/inventory/00000000-0000-0000-0000-000000000000/return', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1 }),
    });
    assert.equal(res.status, 404);
  });
}
