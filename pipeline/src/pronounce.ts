import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Respells tricky words just before text goes to the voice engine (e.g. "Celtic" → "Seltic").
// The dictionary lives in pronunciations.json at the repo root.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function loadPronunciations(path = resolve(ROOT, 'pronunciations.json')): Record<string, string> {
  return (JSON.parse(readFileSync(path, 'utf8')) as { words: Record<string, string> }).words;
}

/** Build a function that rewrites text for speaking. Longest keys win, so "Kamson-Kamara" beats "Kamara". */
export function pronouncer(words: Record<string, string>): (text: string) => string {
  const map = new Map(Object.entries(words).map(([k, v]) => [stripAccents(k), v]));
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  if (!keys.length) return (t) => t;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\w-])(${escaped.join('|')})(?![\\w-])`, 'g');
  return (text) => stripAccents(text).replace(pattern, (m) => map.get(m) ?? m);
}
