import type { AiredStory } from './memory.ts';
import { buildStories, BY_PERSON, CATEGORY_WEIGHT, KIND_RANK, KIND_WEIGHT, MAX_ARTICLES, outlet, type Article, type Story, type StoryCategory } from './stories.ts';
import { BIG_LEAD_H, bigGame } from './matchday.ts';
import { matchPhase, type Brief, type ClaimStatus, type Storyline, type StorylineKind } from './storylines.ts';
import type { Tags } from './tags.ts';
import { mentionsAny, normaliseTitle } from './text.ts';
import type { ClubConfig, Fixture, Item } from './types.ts';

// Story engine 2b (issue #31): the bulletin's stories are the storylines in the store. The ingest has already read
// every article into claims and keeps a brief on each storyline (storylines.ts), so a build fetches no article pages:
// it takes the storylines, writes from their briefs and claims, and flags what's new since each one last aired.
// Weighted by storyline: a match leads around the game and drops away once the next one is played, and its fallout
// leads only while there's something new in it; anything else stays alive while it gets new claims and fades when
// quiet. More coverage of the same claims adds sources, not weight. What this build collected that the ingest hasn't
// read yet goes in from its headlines, joining its storyline when it plainly belongs to one.

/** A claim's source as the build reads it from the store, with up to 4,000 characters of its text. */
export interface StoredItem extends Item {
  text?: string;
}

/** What the build reads from the store (loadOnAir in store.ts). */
export interface OnAirDesk {
  /** Open storylines, and any resolved in the last two days. */
  storylines: Storyline[];
  /** The items their claims came from, by id. */
  items: Map<string, StoredItem>;
  /** Each storyline's airings, by storyline id. */
  airings: Map<number, AiredStory>;
  /** Which of this build's collected items the ingest has read. */
  sifted: Set<string>;
}

/** A story's storyline: what the presenters work from, and what's new since it last aired. */
export interface OnAirStoryline {
  id: number;
  kind: StorylineKind;
  /** A match: before the game, the day of the result, or the fallout. */
  phase?: 'preview' | 'result' | 'fallout';
  brief?: Brief;
  /** Its standing claims (not replaced), oldest first, each marked if it's come in since the storyline last aired. */
  claims: { text: string; status: ClaimStatus; isNew: boolean }[];
  aired?: AiredStory;
  /** It's never aired, or has a new claim (or a headline just in) since it last did. */
  isNew: boolean;
  /** It's never had a package, or has something new since its last. */
  newSinceInDepth: boolean;
  /** Headlines this build collected that the ingest hasn't read yet. */
  justIn: string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A match leads from two days before kick-off to a day after. */
export const LEAD_BEFORE_H = 48;
export const LEAD_AFTER_H = 24;
/** A match's weight: leading; previewed further out; in the fallout with nothing new; once the next match is played. */
const MATCH_LEAD = 1.6;
const MATCH_EARLY = 0.4;
const MATCH_QUIET = 0.08;
const MATCH_GONE = 0.03;
/**
 * A big game (matchday.ts bigGame): leads from BIG_LEAD_H (72 hours) before kick-off and for a day and a half after,
 * weighs more while it does, is talked about further out, and its fallout lasts twice as long.
 */
const BIG = { lead: 2.2, early: 0.8, afterH: 36, falloutH: 48 };
/** Hours for a storyline's weight to halve with no new claim: someone's injury or transfer, the club, a match's fallout. */
const HALF_LIFE_H = { person: 48, club: 30, fallout: 24 };
/** A headline just in is this close to a match's kick-off to be about it. */
const MATCH_NEWS_MS = 3 * DAY_MS;

const PERSON_CATEGORIES: StoryCategory[] = ['injury', 'transfer', 'contract', 'discipline'];

function categoryOf(s: Storyline): StoryCategory {
  if (s.kind === 'match') return 'match';
  return PERSON_CATEGORIES.find((c) => c === s.category) ?? 'news';
}

const latestOf = (times: string[]) => times.reduce((m, t) => (t > m ? t : m), '');

/**
 * How alive a storyline is now, before its importance. A match: leading around the game, then only while new claims
 * come in, and gone once the next match is played. Anything else halves for every two days (a person) or 30 hours
 * (the club) since its newest claim. `newestNew` is when the newest claim since it last aired was first published.
 * A big game has a longer, stronger build-up and fallout.
 */
export function liveness(s: Storyline, newest: string, newestNew: string | undefined, played: Fixture[], now: Date, big = false): number {
  const t = now.getTime();
  const hoursSince = (iso: string) => Math.max(0, (t - Date.parse(iso)) / HOUR_MS);
  if (s.kind === 'match' && s.kickOff) {
    const kick = Date.parse(s.kickOff);
    if (played.some((f) => Date.parse(f.date) > kick + HOUR_MS && Date.parse(f.date) <= t)) return MATCH_GONE;
    if (t < kick - (big ? BIG_LEAD_H : LEAD_BEFORE_H) * HOUR_MS) return big ? BIG.early : MATCH_EARLY;
    if (t < kick + (big ? BIG.afterH : LEAD_AFTER_H) * HOUR_MS) return big ? BIG.lead : MATCH_LEAD;
    return newestNew ? Math.max(MATCH_QUIET, 0.5 ** (hoursSince(newestNew) / (big ? BIG.falloutH : HALF_LIFE_H.fallout))) : MATCH_QUIET;
  }
  return 0.5 ** (hoursSince(newest) / (s.kind === 'person' ? HALF_LIFE_H.person : HALF_LIFE_H.club));
}

/**
 * What kind of story it is, and how widely and how officially it's reported. Outlets count up to five, and a
 * headline backing a claim counts for less than an article it was read from: more coverage adds a little, not a lot.
 */
function importance(category: StoryCategory, read: Set<string>, backing: Set<string>, items: Item[]): number {
  const kinds = items.map((it) => KIND_WEIGHT[it.kind]);
  return (
    CATEGORY_WEIGHT[category] *
    (1 + 0.25 * Math.min(4, Math.max(0, read.size - 1)) + 0.1 * Math.min(3, backing.size)) *
    (kinds.length ? Math.max(0.8, ...kinds) : 1)
  );
}

/**
 * The storyline a story from fresh headlines belongs to: the same person and topic, or a match against the side it
 * names. A match's news isn't always tagged as one ("REACTION | Points over performance | Motherwell 0-2 Hearts").
 */
function belongsTo(story: Story, lines: Storyline[], club: ClubConfig): Storyline | undefined {
  if (BY_PERSON.has(story.category)) {
    return lines.find((l) => l.kind === 'person' && l.category === story.category && l.entity && story.people.includes(l.entity));
  }
  if (story.category !== 'match' && story.category !== 'news') return undefined;
  const title = ` ${normaliseTitle(story.title)} `;
  return lines.find((l) => {
    if (l.kind !== 'match' || !l.fixture || !l.kickOff || Math.abs(Date.parse(story.latest) - Date.parse(l.kickOff)) > MATCH_NEWS_MS) return false;
    const [, home, away] = l.fixture.split('|');
    const opponent = mentionsAny(home, club.keywords) ? away : home;
    return title.includes(` ${normaliseTitle(opponent)} `);
  });
}

/** Whether a match storyline is a big game: its fixture (competition from the fixture list), and its news for a cup's round. */
function isBig(s: Storyline, claims: Storyline['claims'], o: OnAirOptions): boolean {
  if (s.kind !== 'match' || !s.fixture || !s.kickOff) return false;
  const [, home, away] = s.fixture.split('|');
  const kick = Date.parse(s.kickOff);
  const listed = [...o.played, ...(o.upcoming ?? [])].find((f) => Math.abs(Date.parse(f.date) - kick) < 3 * HOUR_MS);
  const text = [s.title, s.brief?.known, ...claims.map((c) => c.text)].filter(Boolean).join(' ');
  return Boolean(bigGame(o.club, { home, away, competition: listed?.competition }, text));
}

export interface OnAirOptions {
  club: ClubConfig;
  /** Everything this build collected. */
  items: Item[];
  tags: Map<string, Tags>;
  /** Our results so far (a match storyline drops away once the next one's played). */
  played: Fixture[];
  /** Our fixtures to come, for a match storyline's competition (whether it's a big game). */
  upcoming?: Fixture[];
  now: Date;
  /** Weigh as if nothing had aired (--fresh). */
  ignoreAirings?: boolean;
}

/**
 * The bulletin's stories: one per storyline with something standing, weighted as above, plus a story for each group
 * of collected headlines the ingest hasn't read that belongs to no storyline. Strongest first. Cooldowns from recent
 * airings are applied afterwards, with the headline stories' (memory.ts freshness).
 */
export function storylineStories(desk: OnAirDesk, o: OnAirOptions): Story[] {
  const names = new Map(o.club.sources.map((s) => [s.id, s.name.replace(/ \(.*\)$/, '')]));
  const named = (it: StoredItem): StoredItem => ({ ...it, sourceName: it.publisher ?? names.get(it.sourceId) ?? it.sourceId });
  const lines = desk.storylines.filter((s) => s.claims.some((c) => c.status !== 'replaced'));

  // What the ingest hasn't read yet, grouped as headlines; a group that belongs to a storyline joins it.
  const unread = o.items.filter((it) => !desk.sifted.has(it.id) && !desk.items.has(it.id));
  const justIn = new Map<number, Story[]>();
  const loose: Story[] = [];
  for (const st of buildStories(unread, o.club, o.now, o.tags)) {
    const home = belongsTo(st, lines, o.club);
    if (home) justIn.set(home.id, [...(justIn.get(home.id) ?? []), st]);
    else loose.push(st);
  }

  const stories = lines.map((s): Story => {
    const aired = o.ignoreAirings ? undefined : desk.airings.get(s.id);
    const fresh = justIn.get(s.id) ?? [];
    const since = (c: Storyline['claims'][number], at: string | undefined) =>
      !at || c.sources.some((x) => !x.corroboration && (x.at ?? c.firstSeen) > at);
    const standing = s.claims.filter((c) => c.status !== 'replaced');
    const claims = standing.map((c) => ({ text: c.text, status: c.status, isNew: since(c, aired?.lastAired) }));
    const newClaims = standing.filter((c, i) => claims[i].isNew);

    // Its items: the claims' sources (read ones first, best outlet first), then any headlines just in.
    const sourceIds = new Set(standing.flatMap((c) => c.sources.map((x) => x.item)));
    const stored = [...sourceIds].map((id) => desk.items.get(id)).filter((it): it is StoredItem => !!it).map(named);
    const readIds = new Set(standing.flatMap((c) => c.sources.filter((x) => !x.corroboration).map((x) => x.item)));
    const ranked = [...stored].sort((a, b) => Number(readIds.has(b.id)) - Number(readIds.has(a.id)) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
    const items = [...ranked, ...fresh.flatMap((st) => st.items)];
    const read = new Set(ranked.filter((it) => readIds.has(it.id)).map(outlet));
    const backing = new Set(ranked.filter((it) => !readIds.has(it.id)).map(outlet).filter((x) => !read.has(x)));

    // Up to three outlets' stored text, those behind what's new first, then the newest.
    const newIds = new Set(newClaims.flatMap((c) => c.sources.filter((x) => !x.corroboration).map((x) => x.item)));
    const articles: Article[] = [];
    for (const it of ranked
      .filter((it) => readIds.has(it.id) && (it.text?.length ?? 0) > 300)
      .sort((a, b) => Number(newIds.has(b.id)) - Number(newIds.has(a.id)) || b.publishedAt.localeCompare(a.publishedAt))) {
      if (articles.length >= MAX_ARTICLES) break;
      if (!articles.some((a) => a.outlet === outlet(it))) articles.push({ outlet: outlet(it), text: it.text!, item: it.id });
    }

    const latestFresh = latestOf(fresh.map((st) => st.latest));
    const latest = latestOf([s.updatedAt, ...standing.map((c) => c.firstSeen), latestFresh]);
    const newestNew = latestOf([...newClaims.map((c) => c.firstSeen), latestFresh]) || undefined;
    const category = categoryOf(s);
    const score = liveness(s, latest, newestNew, o.played, o.now, isBig(s, standing, o)) * importance(category, read, backing, ranked);
    const brief = s.brief;
    return {
      id: `l${s.id}`,
      title: s.title,
      summary: brief?.known ?? standing.at(-1)!.text,
      category,
      sources: [...read, ...backing, ...fresh.flatMap((st) => st.sources)].filter((x, i, all) => all.indexOf(x) === i),
      latest,
      score: Math.round(score * 1000) / 1000,
      items,
      people: s.entity ? [s.entity] : [],
      articles,
      // Quotes and scores are checked against every source's text, not just the three the writer sees.
      body: [brief?.known, brief?.disputed, ...claims.map((c) => c.text), ...ranked.filter((it) => readIds.has(it.id)).map((it) => it.text)]
        .filter(Boolean)
        .join('\n\n'),
      storyline: {
        id: s.id,
        kind: s.kind,
        ...(s.kind === 'match' && s.kickOff ? { phase: matchPhase(s.kickOff, o.now) } : {}),
        ...(brief ? { brief } : {}),
        claims,
        ...(aired ? { aired } : {}),
        isNew: !aired || newClaims.length > 0 || fresh.length > 0,
        newSinceInDepth: !aired?.lastInDepth || fresh.length > 0 || standing.some((c) => since(c, aired.lastInDepth)),
        justIn: fresh.map((st) => st.title),
      },
    };
  });
  return [...stories, ...loose].sort((a, b) => b.score - a.score);
}
