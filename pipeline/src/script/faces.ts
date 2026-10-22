import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Face } from '../faces.ts';

// Which portrait (from `npm run faces`) goes with a story or a quote.

const FACES = fileURLToPath(new URL('../../../site/public/faces/faces.json', import.meta.url));

export function loadFaces(path = FACES): Face[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Face[]) : [];
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const word = (needle: string) => new RegExp(`(^|[^\\p{L}])${plain(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');

/**
 * The face for whoever the text is about: a full-name match first, then a surname, but only when exactly one
 * person has that surname (e.g. "Williams" could be JJ or Mikey). Surnames must be capitalised in the text, so
 * "white" in a sentence doesn't match Tom White.
 */
export function faceFor(text: string, faces: Face[]): string | undefined {
  const t = plain(text);
  const full = faces.find((f) => word(f.name).test(t));
  if (full) return `faces/${full.file}`;
  const bySurname = faces.filter((f) => word(f.surname).test(t));
  return bySurname.length === 1 ? `faces/${bySurname[0].file}` : undefined;
}
