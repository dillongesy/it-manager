import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSetupCode } from '../../src/lib/one-time.js';
import { ipInCidr } from '../../src/lib/cidr.js';

test('setup codes are three groups of four upper-case hex characters, and differ', () => {
  const a = generateSetupCode();
  const b = generateSetupCode();
  assert.match(a, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.notEqual(a, b);
});

test('the reverse proxy subnet is matched, including IPv4-mapped addresses', () => {
  const proxy = '172.29.0.0/24';
  assert.equal(ipInCidr('172.29.0.5', proxy), true);
  assert.equal(ipInCidr('::ffff:172.29.0.5', proxy), true);
  assert.equal(ipInCidr('172.29.1.5', proxy), false);      // portal_ingress
  assert.equal(ipInCidr('192.168.50.20', proxy), false);   // a LAN client
  assert.equal(ipInCidr('not-an-ip', proxy), false);
});
