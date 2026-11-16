import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOrderTransition, calculateFeeXof, calculateXof, formatUsdtMicros, parseUsdtMicros } from '../src/domain.ts';

test('USDT is represented in exact six-decimal micros', () => {
  assert.equal(parseUsdtMicros('12.340001'), 12_340_001n);
  assert.equal(formatUsdtMicros(12_340_000n), '12.34');
  assert.throws(() => parseUsdtMicros('1.0000001'));
  assert.throws(() => parseUsdtMicros('0'));
});

test('XOF settlement rounds to integer XOF units without floating point', () => {
  assert.equal(calculateXof(1_500_000n, 600n), 900n);
  assert.equal(calculateXof(1n, 500_000n), 1n);
  assert.equal(calculateFeeXof(10_000n, 125), 125n);
});

test('order transitions reject client-driven release/completion paths', () => {
  assert.doesNotThrow(() => assertOrderTransition('awaiting_payment', 'payment_reported'));
  assert.throws(() => assertOrderTransition('awaiting_payment', 'completed'));
  assert.throws(() => assertOrderTransition('completed', 'cancelled'));
});
