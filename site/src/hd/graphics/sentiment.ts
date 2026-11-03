import type { Graphic } from '../../../../shared/bulletin';
import { el, shell } from './common';

/** The most talking points listed. */
const MAX_TOPICS = 4;

/** The supporters' mood in a word, as SD. */
function moodWord(score: number): string {
  if (score < -0.6) return 'RAGING';
  if (score < -0.2) return 'UNEASY';
  if (score < 0.2) return 'MIXED';
  if (score < 0.6) return 'UPBEAT';
  return 'BUZZING';
}

/**
 * The supporters' mood: a meter from raging (red) to buzzing (green) whose needle steps out from the middle to the score,
 * the mood in a word under it, then the talking points.
 */
export function sentiment(g: Extract<Graphic, { type: 'sentiment' }>): HTMLElement {
  const { root, body } = shell('sentiment', 'FAN ZONE: SUPPORTER MOOD');
  const score = Math.max(-1, Math.min(1, g.score));
  const meter = el('div', 'meter');
  for (let i = 0; i < 5; i++) meter.append(el('i', `b${i}`));
  const needle = el('div', 'needle');
  needle.style.setProperty('--at', `${((score + 1) / 2) * 100}%`);
  meter.append(needle);
  const ends = el('div', 'ends');
  ends.append(el('span', '', 'RAGING'), el('b', '', moodWord(score)), el('span', '', 'BUZZING'));
  body.append(meter, ends);
  if (g.topics.length) {
    const topics = el('div', 'topics');
    g.topics.slice(0, MAX_TOPICS).forEach((t, i) => {
      const row = el('div', 'topic', `> ${t}`);
      row.style.setProperty('--i', String(i));
      topics.append(row);
    });
    body.append(el('div', 'tp', 'TALKING POINTS'), topics);
  }
  return root;
}
