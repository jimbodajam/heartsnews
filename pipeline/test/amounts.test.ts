// Amounts as an article prints them (issue #100), and the check that a figure's number is in the text. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountsIn, displayAmount, hasAmount, parseAmount } from '../src/amounts.ts';

test('each way of writing an amount parses to the same value', () => {
  for (const s of ['£33.4m', '£33.4 million', '33.4 million pounds', '£33,400,000', '33.4m']) {
    assert.deepEqual(parseAmount(s), { n: 33_400_000, kind: 'money' }, s);
  }
  assert.deepEqual(parseAmount('£1.2bn'), { n: 1.2e9, kind: 'money' });
  assert.deepEqual(parseAmount('£1.2 billion'), { n: 1.2e9, kind: 'money' });
  assert.deepEqual(parseAmount('£500k'), { n: 500_000, kind: 'money' });
  assert.deepEqual(parseAmount('£500 thousand'), { n: 500_000, kind: 'money' });
  assert.deepEqual(parseAmount('€2m'), { n: 2e6, kind: 'money' });
  assert.deepEqual(parseAmount('12%'), { n: 12, kind: 'percent' });
  assert.deepEqual(parseAmount('12 per cent'), { n: 12, kind: 'percent' });
  assert.deepEqual(parseAmount('18,000'), { n: 18_000, kind: 'count' });
  assert.equal(parseAmount('lots'), undefined);
  assert.equal(parseAmount('£33.4m of it'), undefined);
});

test('a figure matches the text however it is written there, and not when the number is absent', () => {
  const text = 'Turnover was £33.4 million, up 12 per cent, with 18,000 season tickets. The loss was £4.2m.';
  assert.equal(amountsIn(text).length, 4);
  assert.ok(hasAmount(text, parseAmount('£33.4m')!));
  assert.ok(hasAmount(text, parseAmount('£4.2 million')!));
  assert.ok(hasAmount(text, parseAmount('12%')!));
  assert.ok(!hasAmount(text, parseAmount('£33.5m')!), 'not in the text');
  assert.ok(!hasAmount(text, parseAmount('£12m')!), 'a percent is not money');
  assert.ok(!hasAmount(text, parseAmount('£33.4')!), 'a bare 33.4 is not 33.4 million');
  assert.ok(!hasAmount('Debt of £133.4m', parseAmount('£33.4m')!), 'not the tail of a longer number');
});

test('the card form is short', () => {
  assert.equal(displayAmount(parseAmount('£33.4 million')!), '£33.4M');
  assert.equal(displayAmount(parseAmount('£1.2bn')!), '£1.2BN');
  assert.equal(displayAmount(parseAmount('£500k')!), '£500K');
  assert.equal(displayAmount(parseAmount('£4,200,000')!), '£4.2M');
  assert.equal(displayAmount(parseAmount('12 per cent')!), '12%');
  assert.equal(displayAmount(parseAmount('18,000')!), '18,000');
});
