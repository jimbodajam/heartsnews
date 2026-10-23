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
  /** The item whose article the body is, so the store can keep it. */
  bodyItem?: string;
}

const STOP = new Set(
  ('the a an and or of to in on for at as with by from is are was be been after over its it this that their his her ' +
    'has have will says say said new hearts heart midlothian fc v vs how why what who when he they we you not but out up')
    .split(' '),
);

const KIND_RANK: Record<SourceKind, number> = { official: 0, press: 1, video: 2, podcast: 3, aggregator: 4, forum: 5 };
const KIND_WEIGHT: Record<SourceKind, number> = { official: 1.2, press: 1, video: 0.8, aggregator: 0.8, podcast: 0.6, forum: 0 };

// Betting tips and "watch it here" listings aren't news, so they're dropped outright.
const JUNK =
  /betting|\bbets?\b|\bodds\b|\btips\b|\bpicks\b|bet builder|^watch\b|how to watch|live stream|tv channel|what channel|match sheet|detailed view|\bpage \d+\b/i;
// Real but minor: goal clips, highlight reels and gossip round-ups sink down the order.
const MINOR = /\b(goals|highlights)\b|gossip/i;

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

export function tokens(title: string): Set<string> {
  return new Set(normaliseTitle(title).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
}

export function sameStory(a: Set<string>, b: Set<string>): boolean {
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

/**
 * Another club's take on us: one of their fan sites ("Celtic FC News", "The Celtic Way"), or a search hit whose
 * headline is led by them ("Celtic player ratings as…"). Real, but their story rather than ours.
 */
function rivalAngle(it: Item, club: ClubConfig): 'outlet' | 'headline' | undefined {
  const rivals = club.rivals ?? [];
  if (mentionsAny(outlet(it), rivals) && !mentionsAny(outlet(it), club.keywords)) return 'outlet';
  if (it.kind !== 'aggregator') return undefined;
  // A scoreline names the home side first ("Celtic 2-4 Hearts"), so a club followed by a score doesn't lead.
  const first = (names: string[]) => {
    const at = names.map((n) => normaliseTitle(it.title).search(new RegExp(`\\b${normaliseTitle(n)}\\b(?! \\d)`))).filter((i) => i >= 0);
    return at.length ? Math.min(...at) : Infinity;
  };
  return first(rivals) < first(club.keywords) ? 'headline' : undefined;
}

/** Only sinks a story when every outlet carrying it is coming at it from a rival's side. */
function rivalWeight(items: Item[], club: ClubConfig): number {
  const angles = items.map((it) => rivalAngle(it, club));
  if (angles.some((a) => !a)) return 1;
  return angles.includes('headline') ? 0.5 : 0.25;
}

/** Signings and injuries are what fans most want to hear about. */
const CATEGORY_WEIGHT: Record<StoryCategory, number> = { transfer: 1.25, injury: 1.15, match: 1.1, news: 1 };

/**
 * Situational boosts on top of a story's own importance: stories about the next (or current) opponent on a
 * matchday, and stories the Kickback is busy talking about.
 */
export function boostStories(stories: Story[], opts: { opponent?: string; fanThreads: Item[] }): void {
  const opponent = opts.opponent && normaliseTitle(opts.opponent);
  const buzz = tokens(opts.fanThreads.map((t) => `${t.title} ${t.summary}`).join(' '));
  for (const s of stories) {
    let boost = 1;
    if (opponent && normaliseTitle(s.title).includes(opponent)) boost *= 1.3;
    const own = tokens(s.title);
    const overlap = [...own].filter((w) => buzz.has(w)).length;
    if (overlap >= 3) boost *= 1.2;
    s.score = Math.round(s.score * boost * 1000) / 1000;
  }
}

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
      const category = categorise(text);
      // Importance: a big story stays big all day (30-hour half-life, like rolling news running it on repeat),
      // boosted by how many newsrooms have it, the most official source, and what kind of story it is.
      const score =
        0.5 ** (hours / 30) *
        (1 + 0.5 * Math.max(0, direct - 1) + 0.15 * reposts) *
        Math.max(...c.items.map((it) => KIND_WEIGHT[it.kind])) *
        CATEGORY_WEIGHT[category] *
        (mentionsAny(lead.title, club.keywords) ? 1 : 0.4) *
        (MINOR.test(lead.title) ? 0.3 : 1) *
        rivalWeight(c.items, club);
      return {
        id: `s${shortHash(lead.url).slice(0, 6)}`,
        title: speakable(lead.title),
        summary: ranked.find((it) => it.summary)?.summary ?? '',
        category,
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
            s.bodyItem = it.id;
            return;
          }
        } catch {
          // Some outlets refuse article pages; try the next one.
        }
      }
      // No article? A video's transcript is the next best thing (press conferences, fan shows).
      const transcript = s.items.find((i) => (i.transcript?.length ?? 0) > 300)?.transcript;
      if (transcript) {
        s.body = transcript;
        return;
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
