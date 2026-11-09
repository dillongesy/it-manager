import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRates, priceChanges, RATE_DEFAULTS } from '../../src/lib/billing-rates.js';

test('the shipped defaults are Standard $90 and Tech $70', () => {
  assert.deepEqual(RATE_DEFAULTS.map(r => [r.label, r.rate]), [['Standard', 90], ['Tech', 70]]);
});

test('sanitizeRates trims labels and rounds rates to cents', () => {
  assert.deepEqual(
    sanitizeRates([{ label: '  Standard ', rate: '95.555' }, { label: 'After hours', rate: 135 }]),
    [{ label: 'Standard', rate: 95.56 }, { label: 'After hours', rate: 135 }],
  );
});

test('sanitizeRates rejects empty lists, blank names, duplicates and bad amounts', () => {
  const rejects = (input, pattern) => assert.throws(() => sanitizeRates(input), (e) => e.status === 400 && pattern.test(e.message));
  rejects([], /At least one/);
  rejects(null, /At least one/);
  rejects([{ label: ' ', rate: 10 }], /needs a name/);
  rejects([{ label: 'Tech', rate: 10 }, { label: 'tech', rate: 20 }], /more than once/);
  rejects([{ label: 'Tech', rate: -1 }], /between 0 and/);
  rejects([{ label: 'Tech', rate: 'abc' }], /between 0 and/);
  rejects(Array.from({ length: 11 }, (_, i) => ({ label: `R${i}`, rate: 1 })), /At most 10/);
});

test('priceChanges lists only re-priced rates whose name is unchanged', () => {
  const before = [{ label: 'Standard', rate: 90 }, { label: 'Tech', rate: 70 }, { label: 'Old', rate: 50 }];
  const after = [{ label: 'standard', rate: 95 }, { label: 'Tech', rate: 70 }, { label: 'New', rate: 60 }];
  assert.deepEqual(priceChanges(before, after), [{ label: 'standard', from: 90, to: 95 }]);
});
