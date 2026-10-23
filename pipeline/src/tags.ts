import type { Entity } from './entities.ts';
import type { Item } from './types.ts';

// What each item is about (story engine stage 1, issue #24): the people, clubs and competitions it names, its
// category and a rough mood, from its headline and summary, or from the article itself once `npm run ingest` has
// fetched it (stage 1b, issue #30). No AI: names come from the entity list, the rest from word patterns. Tags are
// saved in the store by item id (store.ts), and stories group by them (stories.ts).

/** Bump when tagging changes enough that items already in the store should be tagged again. */
export const TAGGER_VERSION = 2;

export type Category = 'transfer' | 'contract' | 'injury' | 'discipline' | 'match' | 'news';
export type Mood = 'good' | 'bad' | 'neutral';

export interface Tags {
  category: Category;
  mood: Mood;
  /** Every entity named, by id. */
  entities: string[];
  /** The players and staff named. */
  people: string[];
  /** The players named, or the staff when no player is: who the item is mainly about. */
  about: string[];
}

const CONTRACT =
  /\b(new (deal|contract)|contract (extension|talks|offer|renewal|expires?|situation|stand-?off)|extends? (his |her )?(deal|contract|stay)|out of contract|(signs?|signed|pens?|penned|agrees?|agreed) (a )?(new|fresh|long-term|\w+-year) (deal|contract)|expiring)\b/i;
const TRANSFER = /\b(transfers?|signs?|signing|signed|loan|bid|swoop|target(ed|s)?|linked with|pre-contract|medical|move for|release clause|transfer window)\b/i;
const INJURY = /\b(injur\w*|ruled out|sidelined|fitness|hamstring|knee|ankle|acl|surgery|setback|left behind)\b/i;
const DISCIPLINE = /\b(red card|sent off|sending off|straight red|suspen\w*|ban|bans|banned|disciplinary|charged|fined|retrospective)\b/i;
const MATCH = /\b(preview|report|kick-off|line-?ups?|team news|player ratings|talking points|referee|result|draw|defeat|thrash\w*|beat|hammer\w*|win|vs?\.?)\b/i;

/** A new deal before a transfer ("signs new contract" isn't a signing), an injury before the match it happened in. */
const PATTERNS: [Category, RegExp][] = [
  ['contract', CONTRACT],
  ['transfer', TRANSFER],
  ['injury', INJURY],
  ['discipline', DISCIPLINE],
  ['match', MATCH],
];

/** Every category, in the order they're checked. */
export const CATEGORIES: Category[] = [...PATTERNS.map(([c]) => c), 'news'];

export function categorise(text: string): Category {
  return PATTERNS.find(([, re]) => re.test(text))?.[0] ?? 'news';
}

const GOOD =
  /\b(boost\w*|returns?|back in training|fit again|delighted|pride|proud|praise\w*|wins?|won|beat|thrash\w*|hammer\w*|victory|unbeaten|stunning|brilliant|hero\w*|top spot|agrees?|extends?)\b/gi;
const BAD =
  /\b(blows?|ruled out|sidelined|woes?|crisis|setbacks?|injur\w*|defeats?|loss|lost|lose|rocked|fears?|worst|banned|sent off|slams?|blasted|lambasted|fury|furious|anger|axed|sacked|blunder|disaster|decimated|ravaged|toll|frustrat\w*|concerns?|doubts?)\b/gi;

/** Good news or bad, by counting the words that lean each way. */
export function mood(text: string): Mood {
  const good = text.match(GOOD)?.length ?? 0;
  const bad = text.match(BAD)?.length ?? 0;
  return good > bad ? 'good' : bad > good ? 'bad' : 'neutral';
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An article's opening is its first paragraph, and the next too while they come to less than this (a one-line lede). */
const OPENING_CHARS = 120;

/** The headline and the article's first paragraphs, where whoever the story is about gets named. */
export function opening(title: string, text: string): string {
  const out = [title];
  let size = 0;
  for (const p of text.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (size >= OPENING_CHARS) break;
    out.push(p);
    size += p.length;
  }
  return out.join('\n');
}

/**
 * A name as a whole word. A one-word name for a person (a surname) must be capitalised, so "white" in a sentence
 * isn't Tom White; full names and club names match in any case ("WOUTER VRANCKEN | Injury latest").
 */
function nameMatcher(e: Entity): (text: string) => number {
  const person = e.type === 'player' || e.type === 'staff';
  const names = [...new Set([e.name, ...e.aliases].map((n) => plain(n).trim()).filter((n) => n.length > 2))];
  const word = (list: string[], flags: string) =>
    list.length ? new RegExp(`(?:^|[^\\p{L}])(?:${list.map(escape).join('|')})(?=$|[^\\p{L}])`, flags) : undefined;
  const loose = word(names.filter((n) => !person || /\s/.test(n)), 'giu');
  const strict = word(names.filter((n) => person && !/\s/.test(n)).flatMap((n) => [n, n.toUpperCase()]), 'gu');
  // How many times it's named. "Harry Milne" also matches as "Milne", so take the larger count, not the sum.
  const count = (re: RegExp | undefined, text: string) => (re ? (text.match(re)?.length ?? 0) : 0);
  return (text) => Math.max(count(loose, text), count(strict, text));
}

const isPerson = (e: Entity) => e.type === 'player' || e.type === 'staff';

/**
 * Tags items against the entity list. Forum threads aren't tagged: they're opinion, not stories.
 * With an article's full text (`texts`, by item id) it's tagged from that instead: whoever is named in the headline
 * and opening or more than once, not in passing, and the category from the headline, or the opening if the headline
 * doesn't say.
 */
export function tagItems(items: Item[], entities: Entity[], texts = new Map<string, string>()): Map<string, Tags> {
  const matchers = entities.map((e) => ({ e, count: nameMatcher(e) }));
  const tags = new Map<string, Tags>();
  for (const it of items) {
    if (it.kind === 'forum') continue;
    const body = texts.get(it.id);
    const lead = body ? opening(it.title, body) : `${it.title}\n${it.summary}`;
    const leadPlain = plain(lead);
    const bodyPlain = body ? plain(body) : '';
    const named = matchers.filter((m) => m.count(leadPlain) > 0 || m.count(bodyPlain) > 1).map((m) => m.e);
    const players = named.filter((e) => e.type === 'player');
    const headline = categorise(it.title);
    tags.set(it.id, {
      category: body && headline === 'news' ? categorise(lead) : headline,
      mood: mood(lead),
      entities: named.map((e) => e.id),
      people: named.filter(isPerson).map((e) => e.id),
      about: (players.length ? players : named.filter((e) => e.type === 'staff')).map((e) => e.id),
    });
  }
  return tags;
}
