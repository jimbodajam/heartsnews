import type { Line, Segment } from '../../../shared/bulletin.ts';
import { PAPERS, type Paper, type PaperHeadline } from '../papers.ts';
import { truncate } from '../text.ts';
import { ukHour } from '../time.ts';
import { firstName, presenter, type Facts } from './facts.ts';

// The breakfast papers round-up (#111): between 06:00 and 10:00 UK time, a fixed segment on what the papers say about
// Hearts, built from the store's headlines (papers.ts, #110). It is written by template, like On This Day: the outlet
// and the headline are the paper's own words, the reaction claims nothing, and nothing beyond the headline is said
// (the Evening News and Scotsman refuse automated reading, and no page is fetched for any paper). So there is no model
// call and nothing to fact-check. Skipped when no paper has a fresh Hearts headline.

export const PAPERS_FROM_HOUR = 6;
export const PAPERS_TO_HOUR = 10;
/** How far back a headline counts as this morning's paper. */
export const PAPERS_HOURS = 16;
const MAX_ITEMS = 4;
const MAX_PER_PAPER = 2;

/** How each paper is named on air. */
export const PAPER_NAME: Record<Paper, string> = {
  'daily-record': 'the Daily Record',
  herald: 'the Herald',
  scotsman: 'the Scotsman',
  'evening-news': 'the Evening News',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether this is breakfast: 06:00 up to (not including) 10:00 UK time. */
export function inPapersWindow(now: Date): boolean {
  const h = ukHour(now);
  return h >= PAPERS_FROM_HOUR && h < PAPERS_TO_HOUR;
}

/**
 * The headlines to run through: Hearts ones only, newest first, at most two a paper and four in all (taking turns
 * between papers), a repeated headline once. Empty outside the breakfast window.
 */
export function papersPicks(roundup: Record<Paper, PaperHeadline[]> | undefined, now: Date): PaperHeadline[] {
  if (!roundup || !inPapersWindow(now)) return [];
  const seen = new Set<string>();
  const queues = PAPERS.map((p) =>
    (roundup[p] ?? [])
      .filter((h) => h.hearts && h.title.trim())
      .filter((h) => {
        const key = h.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_PER_PAPER),
  );
  const out: PaperHeadline[] = [];
  for (let round = 0; round < MAX_PER_PAPER; round++) for (const q of queues) if (q[round] && out.length < MAX_ITEMS) out.push(q[round]);
  return out;
}

/** One-line reactions that say nothing the headline doesn't, so the headline's wording is the only claim made. */
const REACTIONS = ['One for the Gorgie breakfast table.', "We'll see if there is anything in that.", 'Worth keeping an eye on.', 'That will get people talking.'];

export interface PapersDraft {
  intro: string;
  items: { headlineId: string; text: string }[];
}

const headlineText = (h: PaperHeadline) => truncate(h.title.trim().replace(/[.!?]+$/, ''), 140);

/** The spoken words: an intro, then each paper credited by name with its headline and a reaction. */
export function papersDraft(f: Pick<Facts, 'papers' | 'club'>): PapersDraft | undefined {
  const picks = f.papers ?? [];
  if (!picks.length) return undefined;
  return {
    intro: `Time for a look at the morning papers, and what they're saying about ${f.club.shortName}.`,
    items: picks.map((h, i) => ({
      headlineId: h.id,
      text: `${cap(PAPER_NAME[h.outlet])} says: ${headlineText(h)}. ${REACTIONS[i % REACTIONS.length]}`,
    })),
  };
}

/** Who reads the papers: the second anchor, so the lead anchor can hand over to them. */
export const papersHost = (f: Facts) => firstName(presenter(f, f.channel.cast.anchors[1]));

/** The segment at the desk, a headline card for each paper's story. Undefined when there is nothing to run through. */
export function papersSegment(f: Facts, d: PapersDraft): Segment | undefined {
  const host = f.channel.cast.anchors[1];
  const lines: Line[] = [{ speaker: host, text: d.intro }];
  for (const item of d.items) {
    const h = f.papers?.find((x) => x.id === item.headlineId);
    if (h) lines.push({ speaker: host, text: item.text, graphic: { type: 'headline', title: headlineText(h), source: cap(PAPER_NAME[h.outlet]), icon: 'mic' } });
  }
  if (lines.length < 2) return undefined;
  return { id: 'papers', kind: 'papers', title: 'The Papers', strap: `What the papers say about ${f.club.shortName}`, scene: 'desk', presenters: [host], lines };
}
