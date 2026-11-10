import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/index.js';
import { issueChallenge, readChallenge, recordFailedAttempt } from '../../src/lib/mfa.js';

const user = { id: '00000000-0000-0000-0000-000000000001' };
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

test('a sign-in challenge token is never accepted as an access token', () => {
  const token = issueChallenge(user, 'verify');
  assert.throws(() => jwt.verify(token, config.jwt.accessSecret));
  const access = jwt.sign({ sub: user.id, purpose: 'verify' }, config.jwt.accessSecret);
  rejects(() => readChallenge(access, 'verify'), 401);
});

test('a challenge is only good for its own purpose', () => {
  const token = issueChallenge(user, 'enroll');
  assert.equal(readChallenge(token, 'enroll').sub, user.id);
  rejects(() => readChallenge(token, 'verify'), 401);
  rejects(() => readChallenge('garbage', 'enroll'), 401);
  rejects(() => readChallenge(undefined, 'enroll'), 401);
});

test('a challenge stops working after five failed codes', () => {
  const token = issueChallenge(user, 'verify');
  const { jti } = readChallenge(token, 'verify');
  for (let i = 0; i < 5; i++) recordFailedAttempt(jti);
  rejects(() => readChallenge(token, 'verify'), 429);
});
