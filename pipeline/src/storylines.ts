import type { Entity } from './entities.ts';
import type { ScriptModel } from './script/llm.ts';
import { closeStorylines, loadOpenStorylines, loadStoryDesk, saveBriefs, saveNeurons, saveSift, storylinesDueBriefs, type Store } from './store.ts';
import { categorise } from './tags.ts';
import { slug, truncate } from './text.ts';
import type { Fixture, SourceKind } from './types.ts';
import { OutOfBudget, type MeteredModel } from './workers-ai.ts';

// Story engine stage 2 (issue #25): what Hearts News 24 knows. Part of `npm run ingest`: each new article (and club or
// Hearts Standard video transcript) is read once by Workers AI and reduced to short claims ("Milne: ACL injury, out
// for months"), each with the outlets reporting it and a status (reported, confirmed, disputed, replaced). Claims are
// filed under storylines: a person and a topic, a match (one per fixture, preview to fallout), or the club. Headline-
// only items back the claims they match, as corroboration. Each storyline that changed gets a short written brief.
// Storylines close when resolved, when quiet, or (a match) a few days after the next match, and stay in the store as
// the channel's long-term memory. The SQL is in store.ts.

export type StorylineKind = 'person' | 'match' | 'club';
export type ClaimStatus = 'reported' | 'confirmed' | 'disputed' | 'replaced';
export type CloseReason = 'resolved' | 'quiet' | 'next_match';

export interface ClaimSource {
  item: string;
  /** The item's publisher, or its source id. */
  outlet: string;
  /** 1 when only a headline backs it. */
  corroboration: number;
  /** When the source was added. */
  at: string;
}

export interface Claim {
  id: number;
  text: string;
  status: ClaimStatus;
  /** When its earliest source was published. */
  firstSeen: string;
  replacedBy?: number;
  disputes?: number;
  sources: ClaimSource[];
}

export interface Brief {
  /** The picture as it stands, as one story. */
  known: string;
  /** Who says what where outlets disagree; empty when nothing is. */
  disputed: string;
  /** What the newest claims added. */
  latest: string;
}

export interface Storyline {
  id: number;
  kind: StorylineKind;
  entity?: string;
  category?: string;
  title: string;
  fixture?: string;
  kickOff?: string;
  status: 'open' | 'closed';
  openedAt: string;
  /** When its newest claim was first published. */
  updatedAt: string;
  brief?: Brief;
  briefAt?: string;
  claims: Claim[];
}

/** An item waiting to be read: an article or transcript (`text`), or a headline. */
export interface SiftItem {
  id: string;
  source: string;
  publisher?: string;
  kind: SourceKind;
  title: string;
  publishedAt: string;
  text?: string;
  /** Headlines: whether its tags name a player or staff, or a category. Untagged headlines aren't sent. */
  tagged?: boolean;
}

export interface StoryDesk {
  open: Storyline[];
  nextIds: { storyline: number; claim: number };
  neuronsToday: number;
  waiting: { articles: number; oldest?: string };
  articles: SiftItem[];
  headlines: SiftItem[];
}

export interface SiftPlan {
  storylines: { id: number; kind: StorylineKind; entity?: string; category?: string; title: string; fixture?: string; kickOff?: string; openedAt: string }[];
  claims: { id: number; storylineId: number; text: string; status: ClaimStatus; firstSeen: string; disputes?: number }[];
  sources: { claimId: number; itemId: string; corroboration?: boolean }[];
  statuses: { id: number; status: ClaimStatus; replacedBy?: number }[];
  /** Storylines with a new claim, and that claim's time. */
  touched: { id: number; at: string }[];
  resolved: number[];
  /** Items read (whatever they gave). */
  sifted: string[];
  /** Claims in the reply that pointed at no storyline or article we know. */
  dropped?: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Read once this many articles are waiting, or the oldest item has waited RUN_AFTER_MS. */
export const RUN_AT_ARTICLES = 5;
export const RUN_AFTER_MS = HOUR_MS;
/** Articles per request, and per run (so a first backfill spreads over a few runs). */
export const ARTICLES_PER_REQUEST = 10;
export const ARTICLES_PER_RUN = 30;
export const HEADLINES_PER_REQUEST = 60;
export const HEADLINES_PER_RUN = 120;
export const BRIEFS_PER_REQUEST = 2;
export const BRIEFS_PER_RUN = 16;
/** Of each article, what the model reads. */
const ARTICLE_CHARS = 5_000;
/** A quiet storyline closes after this long with no new claim; an injury lasts longer. */
export const QUIET_DAYS: Record<string, number> = { injury: 28 };
export const QUIET_DAYS_DEFAULT = 14;
/** A match storyline closes this long after the next match is played. */
export const MATCH_CLOSE_DAYS = 3;
/** Fixtures the reading can file claims under: the last few played and the next few. */
const FIXTURES_BACK = 3;
const FIXTURES_AHEAD = 2;

const CATEGORIES = ['injury', 'transfer', 'contract', 'discipline', 'manager', 'finance', 'stadium', 'other'];
/** The topics a person storyline can be about. */
const PERSON_TOPICS = ['injury', 'transfer', 'contract', 'discipline'];
/** The topics a club storyline about one person can be about; anything else they say or do is about a match. */
const CLUB_TOPICS = ['manager', 'finance', 'stadium'];

/** A ref the model gave back ("c12", "C12", "12" or 12) in the form we sent it ("c12"). */
export const asRef = (prefix: string, ref: unknown) => {
  const m = /^\s*([a-z]?)\s*(\d+)\s*$/i.exec(String(ref ?? ''));
  return m && (!m[1] || m[1].toLowerCase() === prefix) ? `${prefix}${m[2]}` : undefined;
};

/** Lower case, no accents, words split by single spaces: for spotting a name in a title. */
const plainLower = (s: string) => slug(s).replaceAll('-', ' ');

/** Display names for outlets the store knows by source id. */
export type OutletNames = Map<string, string>;

const outletOf = (names: OutletNames, outlet: string) => names.get(outlet) ?? outlet;

export const fixtureKey = (f: Fixture) => `${f.date.slice(0, 10)}|${f.home}|${f.away}`;

/** Where a match storyline is up to: before the game, the day of the result, then the fallout. */
export function matchPhase(kickOff: string, now: Date): 'preview' | 'result' | 'fallout' {
  const t = new Date(kickOff).getTime();
  if (now.getTime() < t) return 'preview';
  return now.getTime() < t + DAY_MS ? 'result' : 'fallout';
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(iso));

// ---- Closing ----

/**
 * Storylines due to close: a match a few days after our next match was played (or three weeks on, if we never see
 * it), anything else when it's had no new claim for a while (longer for an injury).
 */
export function closingDue(open: Storyline[], played: Fixture[], now: Date): { id: number; reason: CloseReason }[] {
  const out: { id: number; reason: CloseReason }[] = [];
  const t = now.getTime();
  for (const s of open) {
    if (s.kind === 'match' && s.kickOff) {
      const kick = new Date(s.kickOff).getTime();
      const next = played.map((f) => new Date(f.date).getTime()).filter((d) => d > kick + HOUR_MS).sort((a, b) => a - b)[0];
      if ((next && t - next >= MATCH_CLOSE_DAYS * DAY_MS) || t - kick >= 21 * DAY_MS) out.push({ id: s.id, reason: 'next_match' });
      continue;
    }
    const quiet = QUIET_DAYS[s.category ?? ''] ?? QUIET_DAYS_DEFAULT;
    if (t - new Date(s.updatedAt).getTime() >= quiet * DAY_MS) out.push({ id: s.id, reason: 'quiet' });
  }
  return out;
}

// ---- Reading articles into claims ----

const S = { type: 'string' };

export const SIFT_SCHEMA = {
  type: 'object',
  properties: {
    storylines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: S,
          kind: { type: 'string', enum: ['person', 'match', 'club'] },
          title: S,
          entity: S,
          category: { type: 'string', enum: CATEGORIES },
          fixture: S,
        },
        required: ['ref', 'kind', 'title'],
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: S,
          storyline: S,
          sources: { type: 'array', items: S },
          relation: { type: 'string', enum: ['new', 'same', 'confirms', 'disputes', 'replaces'] },
          target: S,
          resolves: { type: 'boolean' },
        },
        required: ['text', 'storyline', 'sources', 'relation'],
      },
    },
  },
  required: ['storylines', 'claims'],
};

interface SiftReply {
  storylines?: { ref?: string; kind?: string; title?: string; entity?: string; category?: string; fixture?: string }[];
  claims?: { text?: string; storyline?: string; sources?: string[]; relation?: string; target?: string; resolves?: boolean }[];
}

function sourceLabels(c: Claim, names: OutletNames): string {
  const read = [...new Set(c.sources.filter((s) => !s.corroboration).map((s) => outletOf(names, s.outlet)))];
  const heads = [...new Set(c.sources.filter((s) => s.corroboration).map((s) => outletOf(names, s.outlet)))].filter((o) => !read.includes(o));
  return [...read, ...heads.map((o) => `${o} (headline)`)].join(', ');
}

/** Open storylines and their standing claims, as the reading sees them. */
function storylineList(open: Storyline[], names: OutletNames): string {
  if (!open.length) return '(none yet)';
  return open
    .map((s) => {
      const about = [s.kind, s.category, s.entity, s.fixture?.replaceAll('|', ' ')].filter(Boolean).join(', ');
      const claims = s.claims
        .filter((c) => c.status !== 'replaced')
        .map((c) => `  c${c.id} (${c.status}; ${dayLabel(c.firstSeen)}; ${sourceLabels(c, names)}) ${c.text}`);
      return [`s${s.id} [${about}] ${s.title}`, ...claims].join('\n');
    })
    .join('\n');
}

function fixtureList(fixtures: { ref: string; f: Fixture }[]): string {
  if (!fixtures.length) return '(none)';
  return fixtures
    .map(({ ref, f }) => {
      const score = f.homeScore != null && f.awayScore != null ? `, ${f.homeScore}-${f.awayScore}` : ', not played yet';
      return `${ref}: ${f.home} v ${f.away} (${f.competition}), ${dayLabel(f.date)}${score}`;
    })
    .join('\n');
}

export function siftPrompt(articles: SiftItem[], open: Storyline[], fixtures: { ref: string; f: Fixture }[], people: Entity[], names: OutletNames, club: string): string {
  return `You keep the newsroom notes for Hearts News 24, a news channel about ${club} (Hearts). Read the new articles below and reduce them to short claims about named people, matches or the club, each filed under a storyline.

A claim is one short line stating something reported as fact: "Milne: ACL injury, out for months", "Vrancken: Halkett close to a return". Name who it's about first. Not the writer's opinion, ratings or guesses; a quote's gist only when it tells us something. Leave out anything not about ${club}. Usually 0 to 5 claims per article; an injury round-up may give one per player.

Storylines:
- person: a story about one player or member of staff that runs beyond a single match, on one topic: injury, transfer, contract or discipline (category). E.g. "Milne injury", "Wilson contract". entity: their id from the people list, e.g. "harry-milne".
- match: one per fixture in the fixture list, running from the preview through the game to the report and the fallout. Everything about that game goes here: team news for it, the result, goals, substitutions, saves, refereeing, who said what about it, and reaction to the result ("Vrancken under pressure after the defeat") while it's about that result. A match report always gives the result as a claim. fixture: its ref.
- club: the club when it's neither: the manager's job, finances, the stadium, the board, the academy, the women's team.
Never open a storyline for one person's comments, form, position or availability ("Vrancken comments", "Kingsley availability"): that goes under the match it's about, reaction under the last game and team news under the next.
An article reacting to a result often looks ahead to the next game too: what's said about the result goes under the game just played, and only what's about the next game goes under that one.
File each claim under an open storyline when one fits. Open a new one (ref "n1", "n2", ...) only when none does, and never two for the same person and topic or the same fixture. Skip routine notices (ticket sales, travel and merchandise) and pundits' opinions.
Never make a claim that only says a game is on or coming up, or gives its date, kick-off, venue or TV channel ("Rangers face Hearts in a midweek trip", "Hearts host Rangers on Wednesday"): the fixture list already has that, and a claim is news about the game. Nor one that only sets the scene ("a big night at Tynecastle") or retells history from past seasons.
Before marking a claim new, check every standing claim under that storyline: the same thing in different words (another outlet, another interview with the same quotes) is "same", not new.
Some "articles" are video shows, given as a summary of the whole show. Take their claims section the way you take a reporter's: what the show presented as news (an injury update, a transfer link), credited to the show. A show saying something is not the club confirming it. Ignore their opinions and predictions.

relation: how the claim stands against the claims we already have:
- new: nothing like it yet.
- same: an existing claim already says this (another outlet reporting it). target: that claim.
- confirms: the club, the person or the manager confirms an existing claim. target: that claim.
- disputes: contradicts an existing claim still standing ("out for six weeks" against "out for months"). target: that claim.
- replaces: things have moved on since an existing claim ("back in training" replaces "out for six weeks"). target: that claim.
target is a claim id like "c12". Several articles saying the same new thing make one claim with all of them in sources (article refs like "a1").
resolves: true when the claim ends its storyline: back playing, deal signed, ban served, move completed.

People (id: name):
${people.map((e) => `${e.id}: ${e.name}`).join('\n') || '(none)'}

Fixtures:
${fixtureList(fixtures)}

Open storylines, with their standing claims:
${storylineList(open, names)}

New articles:
${articles.map((a, i) => `--- a${i + 1} | ${outletOf(names, a.publisher ?? a.source)} | ${dayLabel(a.publishedAt)} | ${a.title}\n${truncate((a.text ?? '').replace(/\n{2,}/g, '\n'), ARTICLE_CHARS)}`).join('\n\n')}`;
}

/** The fixtures a claim can be filed under, newest result first then what's next, each with a ref. */
export function fixtureRefs(match: { last: Fixture[]; next: Fixture[] } | undefined): { ref: string; f: Fixture }[] {
  const last = [...(match?.last ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, FIXTURES_BACK);
  const next = [...(match?.next ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(0, FIXTURES_AHEAD);
  return [...last, ...next].map((f, i) => ({ ref: `f${i + 1}`, f }));
}

/** Who a person storyline can be about: a slug the model gives back must be one of these. */
const isPerson = (e: Entity) => e.type === 'player' || e.type === 'staff';

/**
 * Turns the model's reply into rows: checks every reference, folds a "new" storyline into the open one for the same
 * person and topic (or fixture), and works out what each relation does to the claim it points at.
 */
export function planSift(
  reply: SiftReply,
  articles: SiftItem[],
  open: Storyline[],
  fixtures: { ref: string; f: Fixture }[],
  people: Entity[],
  nextIds: StoryDesk['nextIds'],
  now: Date,
  shows: ReadonlySet<string> = new Set(),
): SiftPlan {
  const plan: SiftPlan = { storylines: [], claims: [], sources: [], statuses: [], touched: [], resolved: [], sifted: articles.map((a) => a.id) };
  // The model sometimes names a person rather than giving their id.
  const personOf = (ref: string | undefined) =>
    ref ? people.find((e) => e.id === ref || e.id === slug(ref) || [e.name, ...e.aliases].some((n) => n.toLowerCase() === ref.toLowerCase()))?.id : undefined;
  const fixtureByRef = new Map(fixtures.map((x) => [x.ref, x.f]));
  const words = (title: string) => ` ${plainLower(title)} `;
  const says = (title: string, name: string) => name.length > 2 && words(title).includes(` ${plainLower(name)} `);
  // Who a title is about, when the model gave no usable id ("Harry Milne injury"): exactly one person named in it.
  const personNamed = (title: string) => {
    const named = people.filter((e) => [e.name, ...e.aliases].some((n) => says(title, n)));
    return named.length === 1 ? named[0].id : undefined;
  };
  // Which fixture a title is about, when the model's ref doesn't fit: the opponent named in it. We're the team in
  // every fixture, so the opponent is the other one.
  const ours = (f: Fixture) => fixtures.every((x) => x.f.home === f.home || x.f.away === f.home) && fixtures.length > 1;
  const fixtureNamed = (title: string) => fixtures.find(({ f }) => says(title, ours(f) ? f.away : f.home) || (fixtures.length === 1 && says(title, f.away)))?.f;
  const storylineIds = new Map<string, number>(open.map((s) => [`s${s.id}`, s.id]));
  const known = [...open.map((s) => ({ id: s.id, kind: s.kind, entity: s.entity, category: s.category, fixture: s.fixture, title: s.title }))];
  let nextStoryline = nextIds.storyline;
  let nextClaim = nextIds.claim;
  let dropped = 0;

  /** The open storyline that already covers this one, or a new one. */
  const storylineFor = (kind: StorylineKind, title: string, entity?: string, category?: string, fixture?: Fixture): number => {
    const key = fixture ? fixtureKey(fixture) : undefined;
    const same = known.find((s) =>
      kind === 'match'
        ? s.fixture === key
        : kind === 'person'
          ? s.kind === 'person' && s.entity === entity && s.category === category
          : s.kind === 'club' && plainLower(s.title) === plainLower(title),
    );
    if (same) return same.id;
    const id = nextStoryline++;
    // A match is named after its fixture: the model's own title for one can be odd ("F1 result").
    const named = fixture ? `${fixture.home} v ${fixture.away}` : truncate(title.trim(), 80);
    plan.storylines.push({
      id,
      kind,
      ...(entity && kind !== 'match' ? { entity } : {}),
      ...(category ? { category } : {}),
      title: named,
      ...(key ? { fixture: key, kickOff: fixture!.date } : {}),
      openedAt: now.toISOString(),
    });
    known.push({ id, kind, entity, category, fixture: key, title: named });
    return id;
  };
  // Someone's comments, form or availability, which the model sometimes makes a club storyline of ("Vrancken
  // comments"), are filed under a match once we see the claim: the fixture it names, or the one nearest its date.
  const aboutMatch = new Set<string>();
  const nearestFixture = (at: string) =>
    [...fixtures].sort((a, b) => Math.abs(new Date(a.f.date).getTime() - new Date(at).getTime()) - Math.abs(new Date(b.f.date).getTime() - new Date(at).getTime()))[0]?.f;
  // Reaction to the game just played, in an article looking ahead to the next one, can come back filed under the next
  // ("Vrancken: no excuses after the win over Motherwell" under Hearts v Rangers). Before the next kick-off, a claim
  // that names the last opponent and not the next one is about the last game.
  const fixtureOfKey = new Map(fixtures.map(({ f }) => [fixtureKey(f), f]));
  const opponent = (f: Fixture) => (ours(f) ? f.away : f.home);
  const reactionHome = (storylineId: number | undefined, text: string, at: string): number | undefined => {
    const s = known.find((k) => k.id === storylineId);
    const next = s?.kind === 'match' && s.fixture ? fixtureOfKey.get(s.fixture) : undefined;
    if (!next || fixtures.length < 2 || Date.parse(next.date) <= Date.parse(at)) return storylineId;
    const last = fixtures
      .map(({ f }) => f)
      .filter((f) => Date.parse(f.date) <= Date.parse(at))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last || !says(text, opponent(last)) || says(text, opponent(next))) return storylineId;
    return storylineFor('match', '', undefined, 'match', last);
  };

  for (const n of reply.storylines ?? []) {
    if (!n.ref || !n.title) continue;
    const ref = n.ref.trim().toLowerCase();
    let kind = (['person', 'match', 'club'] as const).find((k) => k === n.kind) ?? 'club';
    // The model often leaves the category out; the title says it ("Milne injury").
    const given = CATEGORIES.includes(n.category ?? '') ? n.category : categorise(n.title);
    const looksLikeMatch = kind === 'match' || categorise(n.title) === 'match';
    const fixture = looksLikeMatch ? (fixtureByRef.get(asRef('f', n.fixture) ?? '') ?? fixtureNamed(n.title)) : undefined;
    if (fixture) kind = 'match';
    const entity = personOf(n.entity) ?? (kind !== 'match' && PERSON_TOPICS.includes(given ?? '') ? personNamed(n.title) : undefined);
    if (entity && kind === 'club' && PERSON_TOPICS.includes(given ?? '')) kind = 'person';
    // A person storyline needs a person and one of the topics; anything else about them is the club's.
    if ((kind === 'person' && (!entity || !PERSON_TOPICS.includes(given ?? ''))) || (kind === 'match' && !fixture)) kind = 'club';
    const category = kind === 'match' ? 'match' : CATEGORIES.includes(given ?? '') ? given : undefined;
    if (kind === 'club' && !CLUB_TOPICS.includes(category ?? '') && (entity ?? personNamed(n.title)) && fixtures.length) {
      aboutMatch.add(ref);
      continue;
    }
    storylineIds.set(ref, storylineFor(kind, n.title, entity, category, fixture));
  }

  const articleByRef = new Map(articles.map((a, i) => [`a${i + 1}`, a]));
  const claimById = new Map(open.flatMap((s) => s.claims.map((c) => [c.id, { claim: c, storyline: s.id }] as const)));
  const statusOf = new Map<number, ClaimStatus>();
  const touch = (id: number, at: string) => {
    const t = plan.touched.find((x) => x.id === id);
    if (!t) plan.touched.push({ id, at });
    else if (at > t.at) t.at = at;
  };
  // A match storyline closes on the calendar, never on a claim.
  const resolve = (id: number) => {
    if (known.find((s) => s.id === id)?.kind !== 'match') plan.resolved.push(id);
  };

  for (const c of reply.claims ?? []) {
    const text = c.text?.trim();
    const ref = /^\s*n\d+\s*$/i.test(c.storyline ?? '') ? c.storyline!.trim().toLowerCase() : (asRef('s', c.storyline) ?? '');
    const sources = [...new Set((c.sources ?? []).map((r) => articleByRef.get(asRef('a', r) ?? '')).filter((a): a is SiftItem => !!a))];
    const firstSeen = sources.map((a) => a.publishedAt).sort()[0];
    const fixture = text && firstSeen && aboutMatch.has(ref) ? (fixtureNamed(text) ?? nearestFixture(firstSeen)) : undefined;
    const filed = fixture ? storylineFor('match', '', undefined, 'match', fixture) : storylineIds.get(ref);
    const storylineId = text && firstSeen ? reactionHome(filed, text, firstSeen) : filed;
    if (!text || storylineId == null || !sources.length) {
      dropped++;
      continue;
    }
    const targetId = Number(asRef('c', c.target)?.slice(1));
    const target = claimById.get(targetId);
    const relation = target && target.claim.status !== 'replaced' ? (c.relation ?? 'new') : 'new';
    const addSources = (claimId: number) => sources.forEach((a) => plan.sources.push({ claimId, itemId: a.id }));
    const setStatus = (id: number, status: ClaimStatus, replacedBy?: number) => {
      statusOf.set(id, status);
      const had = plan.statuses.find((s) => s.id === id);
      if (had) Object.assign(had, { status, ...(replacedBy ? { replacedBy } : {}) });
      else plan.statuses.push({ id, status, ...(replacedBy ? { replacedBy } : {}) });
    };

    if (relation === 'same' && target) {
      addSources(targetId);
      continue;
    }
    // A show can say a thing is confirmed, but only the club or another outlet makes it so: a claim sourced from shows alone stays reported.
    if (relation === 'confirms' && target && sources.every((a) => shows.has(a.source))) {
      addSources(targetId);
      continue;
    }
    if (relation === 'confirms' && target) {
      addSources(targetId);
      if ((statusOf.get(targetId) ?? target.claim.status) === 'reported') setStatus(targetId, 'confirmed');
      touch(target.storyline, firstSeen);
      if (c.resolves) resolve(target.storyline);
      continue;
    }
    // A new claim, filed under the storyline the target's in when it answers one.
    const id = nextClaim++;
    const home = target && relation !== 'new' ? target.storyline : storylineId;
    const disputes = relation === 'disputes' && target ? targetId : undefined;
    plan.claims.push({ id, storylineId: home, text: truncate(text, 200), status: disputes ? 'disputed' : 'reported', firstSeen, ...(disputes ? { disputes } : {}) });
    addSources(id);
    if (disputes) setStatus(targetId, 'disputed');
    if (relation === 'replaces' && target) setStatus(targetId, 'replaced', id);
    touch(home, firstSeen);
    if (c.resolves) resolve(home);
  }

  // A new storyline's opening is its first claim's time; one that got no claims isn't opened at all.
  plan.storylines = plan.storylines.filter((s) => plan.claims.some((c) => c.storylineId === s.id));
  for (const s of plan.storylines) {
    s.openedAt = plan.claims.filter((c) => c.storylineId === s.id).map((c) => c.firstSeen).sort()[0];
  }
  plan.resolved = [...new Set(plan.resolved)];
  plan.dropped = dropped;
  return plan;
}

// ---- Headlines as corroboration ----

export const CORROBORATE_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: { type: 'object', properties: { headline: S, claims: { type: 'array', items: S } }, required: ['headline', 'claims'] },
    },
  },
  required: ['matches'],
};

export function corroboratePrompt(headlines: { ref: string; outlet: string; title: string }[], open: Storyline[]): string {
  const claims = open.flatMap((s) => s.claims.filter((c) => c.status !== 'replaced').map((c) => `c${c.id} (${s.title}) ${c.text}`));
  return `These headlines come from outlets we can't read in full. For each one, list the claims below it backs up: it reports the same thing. A headline that's only on the same subject backs nothing; most back nothing. Leave those out.

Claims:
${claims.join('\n')}

Headlines:
${headlines.map((h) => `${h.ref} | ${h.outlet} | ${h.title}`).join('\n')}`;
}

/** Corroboration sources from the model's reply. Every headline sent (and every untagged one) counts as read. */
export function planCorroboration(
  reply: { matches?: { headline?: string; claims?: string[] }[] },
  sent: { ref: string; items: SiftItem[] }[],
  all: SiftItem[],
  open: Storyline[],
): SiftPlan {
  const claimIds = new Set(open.flatMap((s) => s.claims.map((c) => c.id)));
  const byRef = new Map(sent.map((h) => [h.ref, h.items]));
  const sources: SiftPlan['sources'] = [];
  for (const m of reply.matches ?? []) {
    const items = byRef.get(m.headline ?? '') ?? [];
    for (const ref of m.claims ?? []) {
      const id = Number(asRef('c', ref)?.slice(1));
      if (claimIds.has(id)) for (const it of items) sources.push({ claimId: id, itemId: it.id, corroboration: true });
    }
  }
  return { storylines: [], claims: [], sources, statuses: [], touched: [], resolved: [], sifted: all.map((h) => h.id) };
}

// ---- Briefs ----

export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    briefs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { storyline: S, title: S, known: S, disputed: S, latest: S },
        required: ['storyline', 'title', 'known', 'disputed', 'latest'],
      },
    },
  },
  required: ['briefs'],
};

export function briefPrompt(storylines: Storyline[], names: OutletNames, people: Entity[], now: Date): string {
  const blocks = storylines.map((s) => {
    const phase = s.kind === 'match' && s.kickOff ? `; match ${matchPhase(s.kickOff, now)}` : '';
    const head = `s${s.id} [${[s.kind, s.category].filter(Boolean).join(', ')}${phase}; ${s.status}] ${s.title}`;
    const old = s.brief ? `Previous brief (${s.briefAt ? dayLabel(s.briefAt) : ''}): ${s.brief.known}${s.brief.disputed ? ` Disputed: ${s.brief.disputed}` : ''}` : 'No brief yet.';
    const claims = s.claims.map((c) => {
      const isNew = !s.briefAt || c.sources.some((x) => !x.corroboration && x.at > s.briefAt!);
      const disputes = c.disputes ? `, disputes c${c.disputes}` : '';
      const replaced = c.replacedBy ? `, replaced by c${c.replacedBy}` : '';
      return `  c${c.id} ${dayLabel(c.firstSeen)} (${c.status}${disputes}${replaced}${isNew ? ', NEW' : ''}; ${sourceLabels(c, names)}) ${c.text}`;
    });
    return [head, old, 'Claims, oldest first:', ...claims].join('\n');
  });
  return `Write the newsroom brief for each storyline below: what a Hearts News 24 presenter needs to pick it up and tell it. Use only the claims; no opinion.
- known: two or three sentences giving the picture as it stands, as one story rather than a list of reports, the latest position first, without dates or who reported what (that goes in disputed). A replaced claim is history ("first reported as six weeks, now months"). For a match: in the preview, what's at stake and the team news; on the day of the result, the result and how it came about; in the fallout, what has followed it.
- disputed: where outlets disagree, who says what, crediting each. Empty when nothing is disputed.
- latest: one sentence giving the news in the claims marked NEW, as you'd say it on air ("Milne's injury is now said to be an ACL tear, ruling him out for the season"). Never mention claims, reports, dates or "NEW". If there's no brief yet, the newest development.
- title: the storyline's short title (a few words, like "Milne injury"); keep it unless it's become wrong.
- storyline: its ref as given below, like "s12".
Name people as the people list does; don't guess a first name.

People: ${people.map((e) => e.name).join(', ')}

${blocks.join('\n\n')}`;
}

export function parseBriefs(reply: { briefs?: { storyline?: string; title?: string; known?: string; disputed?: string; latest?: string }[] }, storylines: Storyline[]) {
  const byRef = new Map(storylines.map((s) => [`s${s.id}`, s]));
  const byTitle = new Map(storylines.map((s) => [s.title.toLowerCase(), s]));
  const briefs = reply.briefs ?? [];
  const out: { id: number; title: string; brief: Brief }[] = [];
  for (const [i, b] of briefs.entries()) {
    // By its ref; the model sometimes gives the title instead, or nothing usable, in which case by its place.
    const s =
      byRef.get(asRef('s', b.storyline) ?? '') ??
      byTitle.get((b.storyline ?? '').trim().toLowerCase()) ??
      (briefs.length === storylines.length ? storylines[i] : undefined);
    if (!s || !b.known?.trim() || out.some((o) => o.id === s.id)) continue;
    // A match keeps its fixture's name; a brief's title for one is often a headline ("Vrancken warning").
    const title = s.kind === 'match' ? s.title : truncate((b.title || s.title).trim(), 80);
    out.push({ id: s.id, title, brief: { known: b.known.trim(), disputed: (b.disputed ?? '').trim(), latest: (b.latest ?? '').trim() } });
  }
  return out;
}

// ---- A run ----

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export interface StorylineRun {
  store: Store;
  model: (MeteredModel | ScriptModel) | undefined;
  entities: Entity[];
  match: { last: Fixture[]; next: Fixture[] } | undefined;
  names: OutletNames;
  club: string;
  now: Date;
  /** Sources (shows) whose claims can't confirm one on their own. */
  shows?: ReadonlySet<string>;
  /** Fan channels with no claims to file: their videos are marked read without being sifted. */
  opinionOnly?: ReadonlySet<string>;
  log?: (line: string) => void;
}

/**
 * One go at the reading, at the end of an ingest: close what's due, then (once enough is waiting) read the new
 * articles into claims, check the headlines against them, and rewrite the briefs of storylines that changed.
 */
export async function updateStorylines(r: StorylineRun): Promise<void> {
  const log = r.log ?? console.log;
  const { store, now } = r;
  const desk = await loadStoryDesk(store, now, { articles: ARTICLES_PER_RUN, headlines: HEADLINES_PER_RUN });

  const played = (r.match?.last ?? []).filter((f) => f.homeScore != null);
  const closing = closingDue(desk.open, played, now);
  await closeStorylines(store, closing, now);
  if (closing.length) log(`Closed ${closing.length} storylines (${closing.map((c) => `s${c.id} ${c.reason}`).join(', ')}).`);

  const model = r.model;
  if (!model) {
    log('No Cloudflare token for Workers AI: storylines not updated.');
    return;
  }
  const due = desk.waiting.articles >= RUN_AT_ARTICLES || (desk.waiting.oldest && now.getTime() - new Date(desk.waiting.oldest).getTime() >= RUN_AFTER_MS);
  if (!due) {
    log(`Storylines: ${desk.waiting.articles} articles waiting; reading once there are ${RUN_AT_ARTICLES} or one has waited an hour.`);
    return;
  }

  const metered = 'neurons' in model ? model : undefined;
  let counted = metered?.neurons ?? 0; // the video summaries before this are already recorded
  const spent = () => {
    const n = (metered?.neurons ?? 0) - counted;
    counted += n;
    return n;
  };
  const fixtures = fixtureRefs(r.match);
  const people = r.entities.filter(isPerson);
  let { open, nextIds } = { open: desk.open.filter((s) => !closing.some((c) => c.id === s.id)), nextIds: desk.nextIds };

  try {
    let claims = 0;
    // A supporters' channel that only gives opinion has no claims to file; it is marked read, not sifted.
    const skipped = desk.articles.filter((a) => r.opinionOnly?.has(a.source));
    if (skipped.length) {
      await saveSift(store, { storylines: [], claims: [], sources: [], statuses: [], touched: [], resolved: [], sifted: skipped.map((a) => a.id) }, 0, now);
      log(`  Left  opinion-only videos out of the storylines.`);
    }
    for (const batch of chunks(desk.articles.filter((a) => !skipped.includes(a)), ARTICLES_PER_REQUEST)) {
      try {
        const reply = (await model.generateJson(siftPrompt(batch, open, fixtures, people, r.names, r.club), SIFT_SCHEMA)) as SiftReply;
        const plan = planSift(reply, batch, open, fixtures, people, nextIds, now, r.shows);
        await saveSift(store, plan, spent(), now);
        claims += plan.claims.length;
        log(`  Read ${batch.length} articles: ${plan.claims.length} new claims, ${plan.sources.length} sources, ${plan.storylines.length} new storylines.${plan.dropped ? ` (${plan.dropped} claims dropped)` : ''}`);
        ({ open, nextIds } = await loadOpenStorylines(store));
      } catch (err) {
        if (err instanceof OutOfBudget) throw err;
        log(`  Couldn't read ${batch.length} articles (left for the next run): ${(err as Error).message}`);
      }
    }
    if (desk.articles.length) log(`Storylines: ${desk.articles.length} articles read, ${claims} new claims.`);

    // Headlines back the claims they match. One request per batch of distinct headlines; untagged ones and any with
    // no claims to back are marked read without asking.
    const claimCount = open.reduce((n, s) => n + s.claims.length, 0);
    for (const batch of chunks(desk.headlines, HEADLINES_PER_REQUEST)) {
      const byTitle = new Map<string, SiftItem[]>();
      for (const h of batch.filter((h) => h.tagged)) byTitle.set(h.title.toLowerCase(), [...(byTitle.get(h.title.toLowerCase()) ?? []), h]);
      const sent = [...byTitle.values()].map((items, i) => ({ ref: `h${i + 1}`, items }));
      let reply = {};
      if (sent.length && claimCount) {
        try {
          const list = sent.map((h) => ({ ref: h.ref, outlet: outletOf(r.names, h.items[0].publisher ?? h.items[0].source), title: h.items[0].title }));
          reply = (await model.generateJson(corroboratePrompt(list, open), CORROBORATE_SCHEMA)) as object;
        } catch (err) {
          if (err instanceof OutOfBudget) throw err;
          log(`  Couldn't check ${sent.length} headlines (left for the next run): ${(err as Error).message}`);
          continue;
        }
      }
      const plan = planCorroboration(reply, sent, batch, open);
      await saveSift(store, plan, spent(), now);
      log(`  Checked ${batch.length} headlines: ${plan.sources.length} corroborations.`);
    }

    const stale = await storylinesDueBriefs(store, now, BRIEFS_PER_RUN);
    for (const batch of chunks(stale, BRIEFS_PER_REQUEST)) {
      try {
        const reply = (await model.generateJson(briefPrompt(batch, r.names, people, now), BRIEF_SCHEMA)) as object;
        const briefs = parseBriefs(reply, batch);
        if (briefs.length < batch.length) log(`  Only ${briefs.length} of ${batch.length} briefs came back usable: ${JSON.stringify(reply).slice(0, 400)}`);
        await saveBriefs(store, briefs, spent(), now);
        for (const b of briefs) log(`  Brief: ${b.title}: ${b.brief.known}`);
      } catch (err) {
        if (err instanceof OutOfBudget) throw err;
        log(`  Couldn't write briefs for ${batch.map((s) => s.title).join(', ')} (left for the next run): ${(err as Error).message}`);
      }
    }
  } catch (err) {
    if (!(err instanceof OutOfBudget)) throw err;
    log(err.message);
  } finally {
    await saveNeurons(store, spent(), now);
    if (metered) log(`Workers AI: ${Math.round(metered.neurons)} neurons this run, ${Math.round(desk.neuronsToday + metered.neurons)} today.`);
  }
}
