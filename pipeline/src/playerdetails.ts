import { fetchText } from './http.ts';
import { decodeEntities } from './text.ts';

// What a player's page on the club site says about them: squad number, position, nationality, date of birth, when they
// signed and their debut, and appearances and goals. The page is hand-typed ("4th August 20245" is on it), so a date is
// kept only when it reads as a whole date, and the page's own words are kept beside it in `raw`.

export interface PlayerDetails {
  number?: number;
  position?: string;
  nationality?: string;
  /** YYYY-MM-DD */
  born?: string;
  signed?: string;
  /** The debut as the page words it ("Saturday, 10th May, 2025", "August, 1st | Aberdeen (A)"), and its date when whole. */
  debut?: string;
  debutOn?: string;
  apps?: number;
  goals?: number;
  /** The player's page. */
  url?: string;
  /** Label → text as the page gave it. */
  raw?: Record<string, string>;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "4th August 2024", "Saturday, 10th May, 2025" → 2024-08-04. Anything missing a day, month or four-digit year is not a date. */
export function parseDate(text: string): string | undefined {
  const day = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?(?![\d])/.exec(text)?.[1];
  const month = MONTHS.indexOf(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i.exec(text)?.[1].toLowerCase() ?? '');
  const year = /(?<!\d)(\d{4})(?!\d)/.exec(text)?.[1];
  if (!day || month < 0 || !year) return undefined;
  const d = new Date(Date.UTC(Number(year), month, Number(day)));
  // 31st February rolls over into March: not a date.
  return d.getUTCMonth() === month && d.getUTCDate() === Number(day) && Number(year) >= 1900 ? d.toISOString().slice(0, 10) : undefined;
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** The "player details" block: two columns of spans, labels then values, in the same order (Signed On is missing for some). */
export function parseDetails(html: string): PlayerDetails | undefined {
  const block = /player details<\/span>\s*<div[^>]*>\s*<div[^>]*>(.*?)<\/div>\s*<div[^>]*>(.*?)<\/div>/is.exec(html);
  if (!block) return undefined;
  const spans = (h: string) => [...h.matchAll(/<span[^>]*>(.*?)<\/span>/gis)].map((m) => text(m[1]));
  const labels = spans(block[1]);
  const values = spans(block[2]);
  const raw: Record<string, string> = {};
  labels.forEach((l, i) => {
    if (l && values[i]) raw[l] = values[i];
  });
  const get = (label: RegExp) => Object.entries(raw).find(([k]) => label.test(k))?.[1];
  const count = (label: string) => {
    const m = new RegExp(`<span class="uppercase">${label}</span>\\s*<span[^>]*>(\\d+)</span>`, 'i').exec(html);
    return m ? Number(m[1]) : undefined;
  };
  const number = get(/squad number/i);
  const debut = get(/^debut/i);
  const out: PlayerDetails = {
    number: number && /^\d{1,3}$/.test(number) ? Number(number) : undefined,
    position: get(/position/i),
    nationality: get(/nationality/i),
    born: parseDate(get(/birth/i) ?? ''),
    signed: parseDate(get(/signed/i) ?? ''),
    debut,
    debutOn: parseDate(debut ?? ''),
    apps: count('appearances'),
    goals: count('goals'),
    raw,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PlayerDetails;
}

/** One player's page. Undefined when it has no details block (a staff page, or the layout changed). */
export async function fetchDetails(url: string): Promise<PlayerDetails | undefined> {
  const d = parseDetails(await fetchText(url));
  return d && { ...d, url };
}
