// A player's page on the club site (pipeline/src/playerdetails.ts): the details block, read defensively. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { people } from '../src/faces.ts';
import { parseDate, parseDetails } from '../src/playerdetails.ts';

const block = (labels: string[], values: string[]) => `<span class="h6 font-bold text-primary uppercase">player details</span>
<div class="flex w-full mb-10 border-b border-grey-100">
  <div class="flex flex-col basis-1/2 gap-4 pt-4 pb-10">${labels.map((l) => `<span class="font-normal text-grey-600">${l}</span>`).join('')}</div>
  <div class="flex flex-col basis-1/2 gap-4 pt-4 pb-10">${values.map((v) => `<span class=" text-primary">${v}</span>`).join('')}</div>
</div><div class="flex w-full pb-6"><div><span class="uppercase">appearances</span><span class="font-bold h3">18</span></div></div>`;

test('whole dates are read in the forms the club page uses, and nothing else is a date', () => {
  assert.equal(parseDate('30th October 2001'), '2001-10-30');
  assert.equal(parseDate('Saturday, 10th May, 2025'), '2025-05-10');
  assert.equal(parseDate('4th August 2024'), '2024-08-04');
  // The page has typos: a five-digit year, no year, an impossible day.
  assert.equal(parseDate('4th August 20245'), undefined);
  assert.equal(parseDate('August, 1st | Aberdeen (A)'), undefined);
  assert.equal(parseDate('31st February 2024'), undefined);
  assert.equal(parseDate(''), undefined);
});

test('a goalkeeper with no "Signed On": the labels and values line up by position', () => {
  const d = parseDetails(block(['Squad Number', 'Position', 'Nationality', 'Date of Birth', 'Debut'], ['1', 'Goalkeeper', 'Netherlands', '30th October 2001', 'August, 1st | Aberdeen (A)']));
  assert.deepEqual(d, {
    number: 1,
    position: 'Goalkeeper',
    nationality: 'Netherlands',
    born: '2001-10-30',
    debut: 'August, 1st | Aberdeen (A)',
    raw: { 'Squad Number': '1', Position: 'Goalkeeper', Nationality: 'Netherlands', 'Date of Birth': '30th October 2001', Debut: 'August, 1st | Aberdeen (A)' },
  });
});

test('with "Signed On", and the typo kept as the page wrote it with no date made up', () => {
  const d = parseDetails(block(['Squad Number', 'Position', 'Nationality', 'Date of Birth', 'Signed On', 'Debut'], ['22', 'Midfielder', 'Iceland', '14th August 2002', '4th August 20245', '4th August 2025']))!;
  assert.deepEqual([d.number, d.born, d.signed, d.debutOn, d.raw?.['Signed On']], [22, '2002-08-14', undefined, '2025-08-04', '4th August 20245']);
});

test('a page without the block (a staff page, or a changed layout) gives nothing', () => {
  assert.equal(parseDetails('<html><body>Manager</body></html>'), undefined);
});

test('the squad page gives each person their own page address', () => {
  const html = `<div class="featured-card relative"><a href="/pages/beau-reus"title="Beau Reus"><img src="//cdn.test/beau.png?width=100"><span class="h6 x">BEAU</span><span class="h5 x">REUS</span></a></div>`;
  assert.deepEqual(people(html), [{ name: 'Beau Reus', img: 'https://cdn.test/beau.png?width=400', href: '/pages/beau-reus' }]);
});
