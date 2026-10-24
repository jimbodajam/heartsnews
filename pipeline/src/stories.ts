import { CATEGORIES, categorise, type Category, type Tags } from './tags.ts';
import { mentionsAny, normaliseTitle, shortHash } from './text.ts';
import type { OnAirStoryline } from './onair.ts';
import type { ClubConfig, Item, SourceKind } from './types.ts';

// Turns raw items into ranked stories: the same news from several outlets becomes one story,
// scored by freshness, how many outlets carry it and how authoritative they are. A bulletin's stories are mostly the
// store's storylines (onair.ts); this groups what the ingest hasn't read yet, or everything when the store is down.

export type StoryCategory = Category;

/** One outlet's text for a story: its article, or failing that a video transcript or feed summary. */
export interface Article {
  outlet: string;
  text: string;
  /** The item whose article page this is, so the store can keep it. */
  item?: string;
}

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
  /** Players and staff the story is about, by entity id. */
  people: string[];
  /** Up to three outlets' text: stored articles for a storyline, otherwise a video transcript or feed summary. */
  articles?: Article[];
  /** The brief, the claims and the articles' text together, for checking quotes and scores against. */
  body?: string;
  /** The storyline this story is, when it comes from the store (onair.ts). */
  storyline?: OnAirStoryline;
}

const STOP = new Set(
  ('the a an and or of to in on for at as with by from is are was be been after over its it this that their his her ' +
    'has have will says say said new hearts heart midlothian fc v vs how why what who when he they we you not but out up')
    .split(' '),
);

export const KIND_RANK: Record<SourceKind, number> = { official: 0, press: 1, video: 2, podcast: 3, aggregator: 4, forum: 5 };
export const KIND_WEIGHT: Record<SourceKind, number> = { official: 1.2, press: 1, video: 0.8, aggregator: 0.8, podcast: 0.6, forum: 0 };

// Betting tips and "watch it here" listings aren't news, so they're dropped outright.
const JUNK =
  /betting|\bbets?\b|\bodds\b|\btips\b|\bpicks\b|bet builder|^watch\b|how to watch|live stream|tv channel|what channel|match sheet|detailed view|\bpage \d+\b/i;
// Real but minor: goal clips, highlight reels and gossip round-ups sink down the order.
const MINOR = /\b(goals|highlights)\b|gossip/i;

/**
 * Categories where who it's about makes it the same story: "Milne ruled out", "Vrancken on the full-back problem" and
 * "Hearts injury list grows" share no headline words but are one injury story. Not matches: a preview, the team news
 * and the report name the same players but are different stories.
 */
export const BY_PERSON = new Set<Category>(['injury', 'transfer', 'contract', 'discipline']);
/** How far apart two items about the same person can be and still be one story. */
const SAME_STORY_MS = 48 * 3.6e6;

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

export const outlet = (it: Item) => it.publisher ?? it.sourceName;

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
export const CATEGORY_WEIGHT: Record<StoryCategory, number> = { transfer: 1.25, contract: 1.15, injury: 1.15, discipline: 1.1, match: 1.1, news: 1 };

/**
 * Situational boosts on top of a story's own importance: stories about the next (or current) opponent on a
 * matchday (by any of its names), more so before a big game, and stories the Kickback is busy talking about.
 */
export function boostStories(stories: Story[], opts: { opponent?: string[]; big?: boolean; fanThreads: Item[] }): void {
  const opponent = (opts.opponent ?? []).map((n) => ` ${normaliseTitle(n)} `);
  const buzz = tokens(opts.fanThreads.map((t) => `${t.title} ${t.summary}`).join(' '));
  for (const s of stories) {
    let boost = 1;
    if (opponent.some((n) => ` ${normaliseTitle(s.title)} `.includes(n))) boost *= opts.big ? 1.5 : 1.3;
    const own = tokens(s.title);
    const overlap = [...own].filter((w) => buzz.has(w)).length;
    if (overlap >= 3) boost *= 1.2;
    s.score = Math.round(s.score * boost * 1000) / 1000;
  }
}

interface Cluster {
  tokens: Set<string>;
  items: Item[];
  /** The first item's category. */
  category: Category;
  /** Everyone named so far, with when each item naming them was published. */
  people: Map<string, number[]>;
}

/**
 * The story an item about someone belongs to: one in the same category naming who it's mainly about within 48 hours,
 * the one sharing the most such people if there are several.
 */
function samePerson(clusters: Cluster[], tags: Tags | undefined, at: number): Cluster | undefined {
  if (!tags?.about.length || !BY_PERSON.has(tags.category)) return undefined;
  let best: Cluster | undefined;
  let most = 0;
  for (const c of clusters) {
    if (c.category !== tags.category) continue;
    const shared = tags.about.filter((p) => c.people.get(p)?.some((t) => Math.abs(t - at) <= SAME_STORY_MS)).length;
    if (shared > most) [best, most] = [c, shared];
  }
  return best;
}

/**
 * The category most of a story's headlines have ("Trabzonspor win despite late red card" doesn't make a match report
 * a discipline story). "news" only if none has another; a tie goes to the one categorise checks first.
 */
function vote(categories: Category[]): Category {
  const counts = new Map<Category, number>();
  for (const c of categories) if (c !== 'news') counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: Category = 'news';
  for (const c of CATEGORIES) if ((counts.get(c) ?? 0) > (counts.get(best) ?? 0)) best = c;
  return best;
}

/**
 * Groups items into stories: by who they're about (from their tags) for injuries, transfers, contracts and discipline,
 * otherwise by shared headline words. Untagged items group by headline words only.
 */
export function buildStories(items: Item[], club: ClubConfig, now = new Date(), tags = new Map<string, Tags>()): Story[] {
  const clusters: Cluster[] = [];
  for (const item of items) {
    if (item.kind === 'forum' || JUNK.test(item.title)) continue;
    const t = tokens(item.title);
    const tagged = tags.get(item.id);
    const at = Date.parse(item.publishedAt);
    const byPerson = samePerson(clusters, tagged, at);
    let home = byPerson ?? clusters.find((c) => sameStory(c.tokens, t));
    if (!home) {
      home = { tokens: new Set(), items: [], category: tagged?.category ?? categorise(item.title), people: new Map() };
      clusters.push(home);
    }
    home.items.push(item);
    // Only headlines grouped by their words add to the story's words: a big story about someone has so many
    // headlines that, with all their words, it would match nearly anything.
    if (!byPerson) for (const w of t) home.tokens.add(w);
    for (const p of tagged?.people ?? []) home.people.set(p, [...(home.people.get(p) ?? []), at]);
  }

  return clusters
    .map((c): Story => {
      const ranked = [...c.items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
      const lead = ranked[0];
      const latest = c.items.reduce((m, it) => (it.publishedAt > m ? it.publishedAt : m), lead.publishedAt);
      const sources = [...new Set(ranked.map(outlet))];
      const hours = Math.max(0, (now.getTime() - new Date(latest).getTime()) / 3.6e6);
      // Aggregator hits are often reposts of the same article, so they count for less than a second newsroom.
      const direct = new Set(ranked.filter((it) => it.kind !== 'aggregator').map(outlet)).size;
      const reposts = sources.length - direct;
      // A story about someone keeps the category it was grouped by; otherwise its headlines vote.
      const category = BY_PERSON.has(c.category) && c.people.size ? c.category : vote(c.items.map((it) => tags.get(it.id)?.category ?? categorise(it.title)));
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
        people: [...c.people.keys()],
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** How many outlets' articles a story is written from. */
export const MAX_ARTICLES = 3;

/**
 * Text for stories that aren't storylines, from what was collected: a build fetches no article pages (the ingest has
 * them, and its storylines carry them). A video's transcript (press conferences, fan shows), else the longest summary.
 */
export function addOwnText(stories: Story[]): void {
  for (const s of stories) {
    if (s.storyline || s.articles) continue;
    const video = s.items.find((i) => (i.transcript?.length ?? 0) > 300);
    const longest = [...s.items].sort((a, b) => b.summary.length - a.summary.length)[0];
    const article: Article | undefined = video?.transcript
      ? { outlet: outlet(video), text: video.transcript }
      : longest?.summary
        ? { outlet: outlet(longest), text: longest.summary }
        : undefined;
    if (!article) continue;
    s.articles = [article];
    s.body = article.text;
  }
}

/** The busiest fan threads, most replies first. */
export function fanThreads(items: Item[]): Item[] {
  return items.filter((it) => it.kind === 'forum').sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
}
