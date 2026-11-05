// The finance card (issue #100): figures merged across outlets without repeats, and the card attached only to a club
// storyline with at least two checked figures. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeFigures } from '../src/onair.ts';
import { financeGraphic } from '../src/script/assemble.ts';
import type { Story } from '../src/stories.ts';

const turnover = { label: 'Turnover', value: '£33.4m', previous: '£28.1m', period: '2024/25' };
const loss = { label: 'Loss', value: '£4.2m', period: '2024/25' };

test('figures merge across outlets in order, skipping the same label and amount written another way', () => {
  const merged = mergeFigures([
    { outlet: 'BBC', text: '', figures: [turnover] },
    { outlet: 'Daily Record', text: '', figures: [{ label: 'turnover', value: '£33.4 million' }, loss] },
    { outlet: 'Courier', text: '' },
  ]);
  assert.deepEqual(merged.map((f) => [f.label, f.outlet]), [['Turnover', 'BBC'], ['Loss', 'Daily Record']]);
});

const story = (kind: 'club' | 'person', figures: Story['figures']): Story =>
  ({ id: 'l1', title: 'Accounts', storyline: { kind }, figures }) as unknown as Story;

test('a club story with two checked figures gets the card, with trend, period and outlet', () => {
  const g = financeGraphic(story('club', [{ ...turnover, outlet: 'BBC' }, { ...loss, outlet: 'Daily Record' }]));
  assert.deepEqual(g, {
    type: 'finance',
    title: 'CLUB FINANCES',
    source: 'BBC',
    period: '2024/25',
    figures: [
      { label: 'Turnover', value: '£33.4M', previous: '£28.1M', trend: 'up' },
      { label: 'Loss', value: '£4.2M' },
    ],
  });
});

test('one figure, or a person storyline, gets no card; at most four figures are shown', () => {
  assert.equal(financeGraphic(story('club', [{ ...turnover, outlet: 'BBC' }])), undefined);
  assert.equal(financeGraphic(story('person', [{ ...turnover, outlet: 'BBC' }, { ...loss, outlet: 'BBC' }])), undefined);
  assert.equal(financeGraphic(story('club', undefined)), undefined);
  const many = Array.from({ length: 6 }, (_, i) => ({ label: `Item ${i}`, value: `£${i + 1}m`, outlet: 'BBC' }));
  assert.equal(financeGraphic(story('club', many))?.figures.length, 4);
});
