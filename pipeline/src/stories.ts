import { mentionsAny, normaliseTitle, shortHash } from './text.ts';
import type { ClubConfig, Item, SourceKind } from './types.ts';

// Turns raw items into ranked stories: the same news from several outlets becomes one story,
// scored by freshness, how many outlets carry it and how authoritative they are.

export type StoryCategory = 'transfer' | 'injury' | 'match' | 'news';

export interface Story {
  id: string;
  title: string;
  summary: string;
  category: StoryCategory;
  /** Outlet names, best first. */
  sources: string[];
  latest: string;
  score: number;
  items: Item[];
  /** Full article text, fetched only for stories covered in depth. */
  body?: string;
}

const STOP = new Set(
  ('the a an and or of to in on for at as with by from is are was be been after over its it this that their his her ' +
    'has have will says say said new hearts heart midlothian fc v vs how why what who when he they we you not but out up')
    .split(' '),
);

const KIND_RANK: Record<SourceKind, number> = { official: 0, press: 1, video: 2, podcast: 3, aggregator: 4, forum: 5 };
const KIND_WEIGHT: Record<SourceKind, number> = { official: 1.2, press: 1, video: 0.8, aggregator: 0.8, podcast: 0.6, forum: 0 };

const JUNK = /betting tips|\bodds\b|bet builder|free bets?/i;
const LISTINGS = /how to watch|live stream|tv channel|what channel/i;

const TRANSFER = /\b(transfers?|signs?|signing|signed|loan|bid|swoop|target(ed|s)?|linked with|pre-contract|medical|move for|release clause|transfer window)\b/i;
const INJURY = /\b(injur\w*|ruled out|sidelined|fitness|hamstring|knee|ankle|surgery|setback|left behind)\b/i;
const MATCH = /\b(preview|report|kick-off|line-?ups?|team news|player ratings|talking points|referee|result|draw|defeat|thrash\w*|beat|hammer\w*|win|vs?\.?)\b/i;

/**
 * Tidy a headline for reading aloud and showing on screen. YouTube-style titles become plain
 * ("PREVIEW | Signing of Salah | Trabzonspor v Hearts" → "Preview: Signing of Salah, Trabzonspor v Hearts").
 */
export function speakable(title: string): string {
  const parts = title.split(/\s*\|\s*/).filter(Boolean);
  const joined = parts.length > 1 ? `${parts[0]}: ${parts.slice(1).join(', ')}` : title;
  // Only clearly shouty titles (two or more capitalised words) get calmed down, and real acronyms are kept.
  const shouty = joined.match(/\b[A-Z][A-Z']{3,}\b/g) ?? [];
  if (shouty.filter((w) => !ACRONYMS.has(w)).length < 2) return joined.trim();
  return joined.replace(/\b[A-Z][A-Z']{3,}\b/g, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase())).trim();
}

const ACRONYMS = new Set(['UEFA', 'FIFA', 'SPFL', 'SWPL', 'HMFC', 'SFA', 'VAR', 'BBC', 'STV']);

function tokens(title: string): Set<string> {
  return new Set(normaliseTitle(title).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
}

function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5;
}

function categorise(text: string): StoryCategory {
  if (TRANSFER.test(text)) return 'transfer';
  if (INJURY.test(text)) return 'injury';
  if (MATCH.test(text)) return 'match';
  return 'news';
}

const outlet = (it: Item) => it.publisher ?? it.sourceName;

export function buildStories(items: Item[], club: ClubConfig, now = new Date()): Story[] {
  const clusters: { tokens: Set<string>; items: Item[] }[] = [];
  for (const item of items) {
    if (item.kind === 'forum' || JUNK.test(item.title)) continue;
    const t = tokens(item.title);
    const home = clusters.find((c) => sameStory(c.tokens, t));
    if (home) {
      home.items.push(item);
      for (const w of t) home.tokens.add(w);
    } else {
      clusters.push({ tokens: t, items: [item] });
    }
  }

  return clusters
    .map((c): Story => {
      const ranked = [...c.items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
      const lead = ranked[0];
      const latest = c.items.reduce((m, it) => (it.publishedAt > m ? it.publishedAt : m), lead.publishedAt);
      const sources = [...new Set(ranked.map(outlet))];
      const hours = Math.max(0, (now.getTime() - new Date(latest).getTime()) / 3.6e6);
      const text = c.items.map((it) => it.title).join(' ');
      // Aggregator hits are often reposts of the same article, so they count for less than a second newsroom.
      const direct = new Set(ranked.filter((it) => it.kind !== 'aggregator').map(outlet)).size;
      const reposts = sources.length - direct;
      const score =
        0.5 ** (hours / 18) *
        (1 + 0.5 * Math.max(0, direct - 1) + 0.15 * reposts) *
        Math.max(...c.items.map((it) => KIND_WEIGHT[it.kind])) *
        (mentionsAny(lead.title, club.keywords) ? 1 : 0.4) *
        (LISTINGS.test(lead.title) ? 0.3 : 1);
      return {
        id: `s${shortHash(lead.url).slice(0, 6)}`,
        title: speakable(lead.title),
        summary: ranked.find((it) => it.summary)?.summary ?? '',
        category: categorise(text),
        sources,
        latest,
        score: Math.round(score * 1000) / 1000,
        items: ranked,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Fetch article text for the stories that get an in-depth package. Tries each outlet's page in turn
 * (aggregator links are redirects, so they're skipped) and falls back to the longest feed summary.
 */
export async function addBodies(stories: Story[], fetchArticle: (url: string) => Promise<string>): Promise<void> {
  await Promise.all(
    stories.map(async (s) => {
      for (const it of s.items.filter((i) => i.kind === 'press' || i.kind === 'official')) {
        try {
          const text = await fetchArticle(it.url);
          if (text.length > 300) {
            s.body = text;
            return;
          }
        } catch {
          // Some outlets refuse article pages; try the next one.
        }
      }
      const longest = s.items.map((i) => i.summary).sort((a, b) => b.length - a.length)[0];
      if (longest) s.body = longest;
    }),
  );
}

/** The busiest fan threads, most replies first. */
export function fanThreads(items: Item[]): Item[] {
  return items.filter((it) => it.kind === 'forum').sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
}
