import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInCidr } from '../../src/lib/cidr.js';

test('ipInCidr matches addresses inside the bridge subnet', () => {
  assert.equal(ipInCidr('172.29.7.10', '172.29.7.0/24'), true);
  assert.equal(ipInCidr('::ffff:172.29.7.10', '172.29.7.0/24'), true);
});

test('ipInCidr rejects other networks and junk', () => {
  assert.equal(ipInCidr('172.29.4.10', '172.29.7.0/24'), false);   // field_app (field-web)
  assert.equal(ipInCidr('10.0.0.1', '172.29.7.0/24'), false);
  assert.equal(ipInCidr('::1', '172.29.7.0/24'), false);
  assert.equal(ipInCidr('300.1.1.1', '172.29.7.0/24'), false);
  assert.equal(ipInCidr(undefined, '172.29.7.0/24'), false);
});

test('ipInCidr handles /32 and /0', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/32'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('8.8.8.8', '0.0.0.0/0'), true);
});
