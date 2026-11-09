import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../../src/config/index.js';
import { consumeOneTime, oneTimeExists, peekOneTime, destroyOneTime, safeEqual, BUNDLE, SETUP_CODE } from '../../src/lib/one-time.js';
import { sniffImage, sanitizeBranding, BRANDING_DEFAULTS } from '../../src/lib/settings.js';
import { INTEGRATIONS } from '../../src/lib/integration-registry.js';

function freshRevealDir() {
  const dir = mkdtempSync(join(tmpdir(), 'reveal-'));
  config.revealDir = dir;
  return dir;
}

test('consumeOneTime returns the content exactly once and leaves nothing behind', async () => {
  const dir = freshRevealDir();
  writeFileSync(join(dir, BUNDLE), '{"portal":{"ENCRYPTION_KEY":"abc"}}');
  assert.equal(oneTimeExists(BUNDLE), true);

  const first = await consumeOneTime(BUNDLE);
  assert.deepEqual(JSON.parse(first), { portal: { ENCRYPTION_KEY: 'abc' } });
  assert.equal(oneTimeExists(BUNDLE), false);
  assert.equal(await consumeOneTime(BUNDLE), null);
  assert.deepEqual(readdirSync(dir), [], 'no claimed/temp file may remain');
});

test('concurrent reveals: only one caller ever gets the bundle', async () => {
  const dir = freshRevealDir();
  writeFileSync(join(dir, BUNDLE), 'secret');
  const results = await Promise.all(Array.from({ length: 8 }, () => consumeOneTime(BUNDLE)));
  assert.equal(results.filter(r => r === 'secret').length, 1);
  assert.equal(results.filter(r => r === null).length, 7);
});

test('setup code can be peeked repeatedly, then destroyed', async () => {
  const dir = freshRevealDir();
  writeFileSync(join(dir, SETUP_CODE), 'AAAA-BBBB-CCCC\n');
  assert.equal(await peekOneTime(SETUP_CODE), 'AAAA-BBBB-CCCC');
  assert.equal(await peekOneTime(SETUP_CODE), 'AAAA-BBBB-CCCC');
  await destroyOneTime(SETUP_CODE);
  assert.equal(existsSync(join(dir, SETUP_CODE)), false);
});

test('no reveal dir configured = nothing to reveal', async () => {
  config.revealDir = null;
  assert.equal(oneTimeExists(BUNDLE), false);
  assert.equal(await consumeOneTime(BUNDLE), null);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, ''), true);
});

test('sniffImage identifies images by their bytes', () => {
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a....')), 'image/gif');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0])), 'image/x-icon');
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('hello')), null);
  assert.equal(sniffImage(Buffer.from('<html><script>alert(1)</script></html>')), null);
});

test('sniffImage refuses active SVG content', () => {
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
  ]) assert.equal(sniffImage(Buffer.from(bad)), 'unsafe-svg', bad);
});

test('sanitizeBranding trims, limits and validates colors', () => {
  const b = sanitizeBranding({ companyName: '  Acme IT  ', primaryColor: '#12abef', phone: 'x'.repeat(100) });
  assert.equal(b.companyName, 'Acme IT');
  assert.equal(b.primaryColor, '#12ABEF');
  assert.equal(b.phone.length, 40);
  assert.equal(b.productName, BRANDING_DEFAULTS.productName);
  assert.throws(() => sanitizeBranding({ accentColor: 'red' }), /#RRGGBB/);
  assert.equal(sanitizeBranding({ companyName: '' }).companyName, BRANDING_DEFAULTS.companyName);
});

test('integration registry is consistent with config sections', () => {
  const ids = new Set();
  for (const def of INTEGRATIONS) {
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`); ids.add(def.id);
    assert.ok(config[def.section], `config.${def.section} exists for ${def.id}`);
    assert.ok(def.fields.some(f => f.required), `${def.id} has a required field`);
    for (const f of def.fields) {
      assert.ok(f.key in config[def.section], `config.${def.section}.${f.key} exists`);
      assert.ok(f.env, `${def.id}.${f.key} has a legacy env name`);
    }
  }
});
