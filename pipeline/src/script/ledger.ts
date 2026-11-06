import type { Bulletin } from '../../../shared/bulletin.ts';
import type { ClubConfig, Fixture } from '../types.ts';
import type { Opinion } from '../memory.ts';
import { removeLines } from './factcheck.ts';
import { isUs, teamName, type Facts } from './facts.ts';
import { distinct, repeats } from './notebook.ts';
import { tokens } from '../stories.ts';

// The fact ledger (issue #32): every result we know, from the store's matches table and this build's fixtures feed,
// and a check in code on each script line after the AI fact-checker has been over it. The AI checker can make the
// writer's own mistake (Hearts "won 2-0" when they lost); this one can't. It only acts when a sentence names one
// opponent we've played and says something about that game that the ledger contradicts:
// - a wrong score is put right ("2-0" when it was 7-1);
// - the wrong winner, or a scorer who didn't score (or scored for the other side), drops the line.
// Anything it isn't sure of (predictions, other seasons, aggregates, half-time scores) it leaves alone.

const DAY_MS = 86_400_000;
/** A sentence with no score of its own is taken to be about the latest meeting only if it was this recent. */
const RECENT_DAYS = 30;
/** A game with no status from the feed is over this long after kick-off. */
const GAME_MS = 3 * 3_600_000;

export interface LedgerMatch {
  /** "<kick-off date>|<home>|<away>", our club by its short name. */
  id: string;
  date: string;
  home: string;
  away: string;
  competition?: string;
  homeScore: number;
  awayScore: number;
  /** Every goal, in order; missing when the feed didn't give them. */
  scorers?: { side: 'home' | 'away'; player: string; minute: string }[];
  source: 'bbc' | 'sportsdb';
  /** On now, so the score is the score so far. Never stored. */
  live?: boolean;
}

export interface Ledger {
  club: ClubConfig;
  /** Newest first. */
  matches: LedgerMatch[];
  /** Surnames (squashed) the scorer check knows to be players. */
  players: Set<string>;
}

export interface LedgerCheck {
  /** "<segment index>.<line index>", as the AI fact-check names lines. */
  line: string;
  segment: string;
  kind: 'score' | 'outcome' | 'scorer' | 'repeat';
  action: 'fixed' | 'dropped';
  was: string;
  now?: string;
  reason: string;
}

/** Lowercase letters only, accents gone: "Djú" and "dju" are the same name. */
const squash = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
/** "K. Tierney", "Kieran Tierney" and "Tierney's" are all "tierney". */
export const surname = (name: string) => squash(name.replace(/['’]s$/, '').replace(/\(og\)/i, '').trim().split(/\s+/).at(-1) ?? '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The finished games in a fixtures feed, as ledger rows. A game on now isn't one. */
export function playedMatches(club: ClubConfig, fixtures: Fixture[], now: Date): LedgerMatch[] {
  return fixtures
    .filter((x) => x.homeScore != null && x.awayScore != null && (x.status === 'done' || (!x.status && Date.parse(x.date) + GAME_MS < now.getTime())))
    .map((x) => toMatch(club, x));
}

function toMatch(club: ClubConfig, x: Fixture, live = false): LedgerMatch {
  const home = teamName(club, x.home);
  const away = teamName(club, x.away);
  const goals = (x.homeScore ?? 0) + (x.awayScore ?? 0);
  return {
    id: `${x.date.slice(0, 10)}|${home}|${away}`,
    date: x.date,
    home,
    away,
    ...(x.competition ? { competition: x.competition } : {}),
    homeScore: x.homeScore ?? 0,
    awayScore: x.awayScore ?? 0,
    ...(x.scorers?.length || goals === 0 ? { scorers: x.scorers ?? [] } : {}),
    // Only the BBC's data carries its page slugs and links.
    source: x.link || x.homeSlug ? 'bbc' : 'sportsdb',
    ...(live ? { live: true } : {}),
  };
}

/**
 * The ledger for one build: the stored results, with this build's feed over them (a BBC row isn't replaced by
 * TheSportsDB's), plus the game on now. `players` are the names the scorer check can be sure are players.
 */
export function buildLedger(club: ClubConfig, stored: LedgerMatch[], fresh: LedgerMatch[], players: string[], live?: Fixture): Ledger {
  const byId = new Map(stored.map((m) => [m.id, m]));
  for (const m of fresh) {
    const had = byId.get(m.id);
    if (had?.source === 'bbc' && m.source === 'sportsdb') continue;
    byId.set(m.id, { ...m, scorers: m.scorers ?? had?.scorers });
  }
  if (live?.homeScore != null && live.awayScore != null) byId.set(toMatch(club, live).id, toMatch(club, live, true));
  const matches = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
  const known = [...players, ...matches.flatMap((m) => (m.scorers ?? []).map((s) => s.player))];
  return { club, matches, players: new Set(known.map(surname).filter((s) => s.length > 2)) };
}

// ---- Reading a sentence ----

/** Predictions, hopes and what-ifs: not a claim about a result. */
const HYPOTHETICAL = /\b(will|won't|going to|gonna|predict\w*|reckon\w*|expect\w*|could|would|should|might|may|hope\w*|if|think|thinks|fancy|fancies|tipping|backing|prediction)\b|'ll\b/i;
/** Another time, or a score that isn't the result. */
const ELSEWHEN =
  /\b(ago|back in|previous(ly)?|earlier (this|in the) (season|campaign|year)|last (time|meeting|season|year|month|campaign)|first meeting|aggregate|penalt\w*|shoot-?out|half[- ]time|the break|the interval|(18|19|20)\d\d)\b/i;
/**
 * Another Hearts side: the ledger only has the men's first team. On 25 Oct "Hearts Women… a four-two victory away
 * against Celtic Women" was "corrected" to the men's 7-1.
 */
const OTHER_SIDE = /\b(women(?:'s)?|ladies|girls|swpl|b team|reserves|colts|youth|u-?\d{2}s?|under-?\d{2}s?)\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'gi');

const NUMBER_WORDS = ['nil', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const wordValue = (w: string) => (w === 'zero' || w === 'nil' ? 0 : NUMBER_WORDS.indexOf(w));
const WORD = `(nil|zero|${NUMBER_WORDS.slice(1).join('|')})`;

interface Mention {
  at: number;
  text: string;
  a: number;
  b: number;
  words: boolean;
  /** Said as "one-all". */
  all?: boolean;
}

/**
 * The scores in a sentence: "7-1", "7–1", "two-nil", "one-all". Not formations (4-3-3, four-four-two), spans of
 * time ("3-4 weeks") or a score on the way to the result ("2-0 down", "led 1-0").
 */
function mentions(s: string): Mention[] {
  const found: Mention[] = [];
  for (const m of s.matchAll(/(?<![\d.\-–])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d%]|\s?[-–]\s?\d)/g)) {
    found.push({ at: m.index, text: m[0], a: Number(m[1]), b: Number(m[2]), words: false });
  }
  for (const m of s.matchAll(new RegExp(`\\b${WORD}-(${WORD.slice(1, -1)}|all)\\b(?!-)`, 'gi'))) {
    const [a, b] = [m[1].toLowerCase(), m[2].toLowerCase()];
    if ((a === 'one' && b === 'two') || /-$/.test(s.slice(0, m.index))) continue;
    found.push({ at: m.index, text: m[0], a: wordValue(a), b: b === 'all' ? wordValue(a) : wordValue(b), words: true, all: b === 'all' });
  }
  return found.filter((m) => {
    const before = s.slice(Math.max(0, m.at - 12), m.at);
    const after = s.slice(m.at + m.text.length, m.at + m.text.length + 24);
    return (
      !/\b(from|led|leading|lead|leads|trailing|trailed|at)\s+$/i.test(before) &&
      !/^\s*(down|up|ahead|behind|lead|weeks?|months?|days?|games?|matches|points?|pts|years?|minutes?|mins|times|percent)\b/i.test(after)
    );
  });
}

const sameScore = (m: LedgerMatch, x: Mention) => (m.homeScore === x.a && m.awayScore === x.b) || (m.homeScore === x.b && m.awayScore === x.a);

type Outcome = 'won' | 'lost' | 'drew';

function ourOutcome(club: ClubConfig, m: LedgerMatch): Outcome {
  const [ours, theirs] = isUs(club, m.home) ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore];
  return ours > theirs ? 'won' : ours < theirs ? 'lost' : 'drew';
}

const FILLER = '(?:\\s+(?:were|was|have|had|has|now|just|deservedly|comfortably|narrowly|eventually|finally|well|heavily|badly|duly|then|also|again|been|got|getting|being|only|ultimately|convincingly|emphatically))*';
const PASSIVE = '\\s+(?:were|was|been|got|being)(?:\\s+\\w+ly)?\\s+';
const BEATEN = '(?:beaten|thrashed|hammered|humbled|routed|defeated|battered|demolished|swept aside|outclassed)';
/** What may follow "won", "lost" or "drew" for it to be a result: not "lost Milne to injury", "won a corner", "drew level". */
const RESULT_NEXT = '(?=\\s+(?:\\d|\\w+-\\w+\\b|to\\b|at\\b|away\\b|against\\b|with\\b|again\\b|heavily\\b|badly\\b|comfortably\\b|narrowly\\b|convincingly\\b|in\\b|there\\b|on\\s+(?:Satur|Sun|Mon|Tues|Wednes|Thurs|Fri)day\\b)|\\s*[,.!?;—–]|\\s*$)';
const SCORE_OR_LOSS = '(?:an?\\s+)?(?:\\S+\\s+)?(?:defeat|loss|\\d+-\\d+)';
const WIN = `(?:won${RESULT_NEXT}|beat|defeated|thrashed|hammered|edged(?: past| out)?|saw off|eased past|cruised past|swept aside|overcame|routed|battered|demolished|ran out (?:winners|\\d)|(?:claimed|picked up|secured|earned|grabbed|sealed) (?:a|an|the|their)(?: \\w+)? (?:win|victory)|took (?:all )?(?:the|three) points)`;
const LOSE = `(?:lost${RESULT_NEXT}|beaten by|went down (?:\\d|at\\b|away\\b|against\\b)|(?:fell|slumped|crashed|sank) to ${SCORE_OR_LOSS}|succumbed|suffered (?:a|an|another|their)(?: \\w+)?(?: \\d+-\\d+)? (?:defeat|loss|thrashing|hammering|humbling))`;
const DRAW = `(?:drew${RESULT_NEXT}|held (?:\\S+ ){1,2}to an? (?:\\S+ )?draw|shared the (?:points|spoils)|(?:played out|battled to|ground out|settled for|earned|claimed) an? (?:\\w+ )?(?:\\d+-\\d+ )?draw)`;
const WIN_NOUN = '(?:win|victory|triumph|success)';
const LOSS_NOUN = '(?:defeat|loss|thrashing|hammering|humbling|humiliation|drubbing|reverse|hiding)';

/**
 * What a sentence says about our result against `opp`, each claim from our side. "Hearts were beaten by Celtic",
 * "a defeat to Celtic", "Celtic beat Hearts" and "Celtic's win over Hearts" all say we lost.
 */
function outcomeClaims(s: string, us: string, opp: string): Outcome[] {
  const claims: Outcome[] = [];
  const flip = (o: Outcome): Outcome => (o === 'won' ? 'lost' : o === 'lost' ? 'won' : 'drew');
  for (const [who, ours] of [[us, true], [opp, false]] as const) {
    const at = (verb: string) => new RegExp(`\\b(?:${who})${FILLER}\\s+${verb}(?!\\w)`, 'i').test(s);
    const passive = (verb: string) => new RegExp(`\\b(?:${who})${FILLER}${PASSIVE}${verb}(?!\\w)`, 'i').test(s);
    let claim: Outcome | undefined;
    if (passive('held to an? (?:\\S+ )?draw') || at(DRAW)) claim = 'drew';
    else if (passive(BEATEN) || at(LOSE)) claim = 'lost';
    else if (at(WIN)) claim = 'won';
    if (claim) claims.push(ours ? claim : flip(claim));
  }
  // Nouns: "a win over Celtic", "defeat to Celtic", "a defeat for Hearts", "Celtic's win over Hearts".
  const isOurs = (name: string) => new RegExp(`^(?:${us})$`, 'i').test(name);
  const object = (noun: string, o: Outcome) => {
    const re = new RegExp(`\\b${noun}\\s+(?:(?:over|against|at|to|by|away to|away at|at the hands of)\\s+(?:the\\s+)?(${us}|${opp})|for\\s+(?:the\\s+)?(${us}|${opp}))\\b`, 'gi');
    for (const m of s.matchAll(re)) {
      // "A win over Celtic" is ours; "a win over Hearts" is theirs. "A win for Hearts" is ours; "for Celtic", theirs.
      if (m[1]) claims.push(isOurs(m[1]) ? flip(o) : o);
      else if (m[2]) claims.push(isOurs(m[2]) ? o : flip(o));
    }
  };
  object(WIN_NOUN, 'won');
  object(LOSS_NOUN, 'lost');
  if (new RegExp(`\\b(?:(?:\\d+-\\d+|goalless|scoreless)\\s+draw|draw\\s+(?:with|against|at|away to)\\s+(?:the\\s+)?(?:${us}|${opp})|stalemate)\\b`, 'i').test(s)) claims.push('drew');
  return claims;
}

const NAME = "([A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+)?)";
const SCORED =
  '(?:scored|netted|struck|headed (?:home|in)|fired (?:home|in)|slotted (?:home|in)|tapped in|nodded (?:home|in)|bagged|grabbed (?:a|the|his)|got (?:a|the|his) (?:goal|consolation|winner|equaliser|opener)|opened the scoring|equalised|levelled|pulled (?:one|a goal) back|got one back|was on the scoresheet|found the net)';
const GOAL_NOUN = '(?:goal|goals|strike|header|consolation|winner|equaliser|opener|double|brace|penalty)';

/** Who a sentence says scored: "Mendy scored", "a goal from Mendy", "Mendy's consolation". */
function scorerClaims(s: string): string[] {
  const names = [
    ...s.matchAll(new RegExp(`${NAME}(?:['’]s)?${FILLER}\\s+${SCORED}\\b`, 'gu')),
    ...s.matchAll(new RegExp(`\\b${GOAL_NOUN}\\s+(?:from|by)\\s+${NAME}`, 'gu')),
    ...s.matchAll(new RegExp(`${NAME}['’]s\\s+(?:\\w+\\s+)?${GOAL_NOUN}\\b`, 'gu')),
  ].map((m) => m[1]);
  return [...new Set(names)];
}

/** The names a team goes by on air: its own, and any it shares in the big-games list ("Hibernian", "Hibs"). */
function teamAliases(club: ClubConfig, team: string): string[] {
  const group = club.bigGames?.opponents.find((o) => o.names.includes(team))?.names ?? [];
  return [...new Set([team, ...group])];
}

/** Which of the teams we've played a sentence names, the longest name winning ("Dundee United" over "Dundee"). */
function namedOpponents(s: string, teams: Map<string, string[]>): string[] {
  const hits: { team: string; at: number; end: number }[] = [];
  for (const [team, aliases] of teams) {
    for (const alias of aliases) {
      for (const m of s.matchAll(new RegExp(`\\b${escape(alias)}\\b`, 'gi'))) hits.push({ team, at: m.index, end: m.index + m[0].length });
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
  return [...new Set(kept.map((h) => h.team))];
}

interface LineResult {
  text: string;
  fixes: { kind: 'score'; reason: string }[];
  drop?: { kind: 'outcome' | 'scorer'; reason: string };
}

const scoreText = (m: LedgerMatch) => `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`;

/** One line checked against the ledger: its text with any scores put right, or why it has to go. */
export function checkLine(ledger: Ledger, text: string, now: Date): LineResult {
  const { club } = ledger;
  const usNames = [club.shortName, club.name, ...club.nicknames, 'we'];
  const us = usNames.map(escape).join('|');
  const opponents = new Map<string, string[]>();
  for (const m of ledger.matches) {
    const opp = isUs(club, m.home) ? m.away : m.home;
    if (!opponents.has(opp)) opponents.set(opp, teamAliases(club, opp));
  }

  const result: LineResult = { text, fixes: [] };
  const edits: { at: number; length: number; text: string }[] = [];
  for (const sm of text.matchAll(/[^.!?]+[.!?]*/g)) {
    const s = sm[0];
    // Only a sentence about us and one team we've played: "Celtic won 5-0 at Aberdeen" is someone else's result.
    if (HYPOTHETICAL.test(s) || ELSEWHEN.test(s) || OTHER_SIDE.test(s) || !new RegExp(`\\b(?:${us}|us|our)\\b`, 'i').test(s)) continue;
    const named = namedOpponents(s, opponents);
    if (named.length !== 1) continue;
    const opp = named[0];
    const meetings = ledger.matches.filter((m) => m.home === opp || m.away === opp);
    const latest = meetings[0];
    const recent = latest && (latest.live || now.getTime() - Date.parse(latest.date) <= RECENT_DAYS * DAY_MS) ? latest : undefined;
    // A month that isn't the latest meeting's is another game.
    const months = [...s.matchAll(MONTH)].map((m) => m[1].toLowerCase());
    if (months.length && (!recent || months.some((mo) => MONTHS.indexOf(mo) !== new Date(recent.date).getUTCMonth()))) continue;

    const scores = mentions(s);
    const referenced = meetings.find((m) => scores.some((x) => sameScore(m, x))) ?? recent;
    if (!referenced) continue;

    if (referenced === recent && !meetings.some((m) => scores.some((x) => sameScore(m, x)))) {
      for (const x of scores) {
        const fixed = rightScore(referenced, x, s.slice(0, x.at), opponents, usNames);
        edits.push({ at: sm.index + x.at, length: x.text.length, text: fixed });
        result.fixes.push({ kind: 'score', reason: `said ${x.text}; it was ${scoreText(referenced)}` });
      }
    }

    const oppNames = (opponents.get(opp) ?? [opp]).map(escape).join('|');
    if (!referenced.live) {
      const actual = ourOutcome(club, referenced);
      const wrong = outcomeClaims(s, us, oppNames).find((c) => c !== actual);
      if (wrong) {
        result.drop = { kind: 'outcome', reason: `says ${club.shortName} ${wrong} against ${opp}; they ${actual}, ${scoreText(referenced)}` };
        return result;
      }
    }

    if (/\bown goal\b/i.test(s) || !referenced.scorers) continue;
    const ourSide = isUs(club, referenced.home) ? 'home' : 'away';
    const complete = referenced.scorers.length === referenced.homeScore + referenced.awayScore;
    const pinned = scores.some((x) => sameScore(referenced, x));
    for (const name of scorerClaims(s)) {
      const who = surname(name);
      if (!ledger.players.has(who)) continue;
      const goals = referenced.scorers.filter((g) => surname(g.player) === who);
      if (!goals.length) {
        // Unless it's one of the other meetings he scored in, and the sentence doesn't say which game.
        const elsewhere = meetings.some((m) => m !== referenced && m.scorers?.some((g) => surname(g.player) === who));
        if (complete && !(elsewhere && !pinned)) {
          result.drop = { kind: 'scorer', reason: `says ${name} scored; he didn't in ${scoreText(referenced)}` };
          return result;
        }
        continue;
      }
      const forUs = new RegExp(`\\b(?:for|gave)\\s+(?:the\\s+)?(?:${us})\\b|\\b(?:${us})['’]s?\\s+(?:\\w+\\s+)?${GOAL_NOUN}\\b`, 'i').test(s);
      const forThem = new RegExp(`\\b(?:for|gave)\\s+(?:the\\s+)?(?:${oppNames})\\b|\\b(?:${oppNames})['’]s?\\s+(?:\\w+\\s+)?${GOAL_NOUN}\\b`, 'i').test(s);
      const sides = new Set(goals.map((g) => g.side));
      if ((forUs && !forThem && !sides.has(ourSide)) || (forThem && !forUs && sides.size === 1 && sides.has(ourSide))) {
        result.drop = { kind: 'scorer', reason: `says ${name} scored for ${forUs ? club.shortName : opp}; his goal was for ${forUs ? opp : club.shortName}, ${scoreText(referenced)}` };
        return result;
      }
    }
  }
  for (const e of edits.sort((a, b) => b.at - a.at)) result.text = result.text.slice(0, e.at) + e.text + result.text.slice(e.at + e.length);
  return result;
}

/**
 * The right score, said the way the line said it: digits or words, and in the order the teams are named ("Celtic
 * 7-1 Hearts"), otherwise the winner's goals first ("lost 7-1").
 */
function rightScore(m: LedgerMatch, x: Mention, before: string, opponents: Map<string, string[]>, usNames: string[]): string {
  const homeIsUs = !opponents.has(m.home);
  const last = before.trimEnd();
  const names = (team: string, ours: boolean) => (ours ? usNames : (opponents.get(team) ?? [team]));
  const ends = (team: string, ours: boolean) => names(team, ours).some((n) => new RegExp(`\\b${escape(n)}$`, 'i').test(last));
  let [a, b] = [Math.max(m.homeScore, m.awayScore), Math.min(m.homeScore, m.awayScore)];
  if (last.length < before.length || /\s$/.test(before)) {
    if (ends(m.home, homeIsUs)) [a, b] = [m.homeScore, m.awayScore];
    else if (ends(m.away, !homeIsUs)) [a, b] = [m.awayScore, m.homeScore];
  }
  if (!x.words) return `${a}-${b}`;
  const say = (n: number) => (n === 0 ? 'nil' : (NUMBER_WORDS[n] ?? String(n)));
  const first = /^[A-Z]/.test(x.text) ? say(a).replace(/^./, (c) => c.toUpperCase()) : say(a);
  return a === b ? `${first}-all` : `${first}-${say(b)}`;
}

/** A view said this many times is made: a line saying it again is dropped. */
export const SAID_ENOUGH = 3;
/** So is one said this recently: on a channel with a bulletin every half hour, it was on air a moment ago. */
const RECENT_MS = 12 * 3_600_000;
/**
 * A repeating sentence with at least this share of words not in the view it repeats is saying something new too
 * (Ross on Mato "at left-back for the first time in eleven years, keeping Salah quiet": 55% new). Losing news is
 * worse than an opinion said twice, and the AI fact-checker catches some repeats as well.
 */
const MOSTLY_NEW = 0.5;

/**
 * Lines where a presenter only says again a view they've already made: said SAID_ENOUGH times or more, or in the
 * last 12 hours (Ross's "advanced metrics cover for missing players" and Fraser's "grit over laptop statistics" went
 * out every half hour on 24 Oct, Ross's three times in one bulletin). Repeats aren't saved as takes any more, so the
 * count alone wouldn't catch the next one. The prompt asks the writer not to; this makes sure. Dropped, as the ledger
 * drops a contradicted line.
 */
export function repeatedViews(f: Facts, bulletin: Bulletin): LedgerCheck[] {
  const made = new Map<string, Opinion[]>();
  for (const [id, pm] of Object.entries(f.memory.presenters)) {
    const recent = (t: Opinion) => f.now.getTime() - Date.parse(t.at) < RECENT_MS;
    made.set(id, distinct([...pm.opinions].reverse()).filter((d) => d.times >= SAID_ENOUGH || recent(d.take)).map((d) => d.take));
  }
  // The words of a line that aren't in the view it repeats. A line that's mostly the view has nothing new in it; one
  // that restates a leaning on the way to news ("Halkett remains sidelined… we must stay cautious") keeps its place.
  const newWords = (text: string, view: string) => {
    const said = tokens(view);
    const words = [...tokens(text)];
    return words.filter((w) => !said.has(w)).length / Math.max(1, words.length);
  };
  const checks: LedgerCheck[] = [];
  const drop = new Set<string>();
  bulletin.segments.forEach((seg, si) => {
    if (seg.kind === 'adverts' || seg.kind === 'history') return;
    seg.lines.forEach((line, li) => {
      const views = made.get(line.speaker);
      if (!views?.length || line.graphic?.type === 'predictions') return;
      const repeated = (s: string) => {
        const closest = views.filter((t) => repeats(s, [t])).sort((a, b) => newWords(s, a.view) - newWords(s, b.view))[0];
        return closest && newWords(s, closest.view) < MOSTLY_NEW ? closest : undefined;
      };
      // Sentence by sentence: "Borchgrevink is out for weeks. That shows we must manage the load." keeps the news.
      const sentences = line.text.match(/[^.!?]+[.!?]*\s*/g) ?? [line.text];
      const found = sentences.map(repeated);
      const said = found.filter((v): v is Opinion => Boolean(v));
      if (!said.length) return;
      const reason = said.map((v) => `says again "${v.view}" (said ${v.at})`).join('; ');
      const kept = sentences.filter((_, i) => !found[i]).join('').trim();
      if (kept) {
        checks.push({ line: `${si}.${li}`, segment: seg.id, kind: 'repeat', action: 'fixed', was: line.text, now: kept, reason });
        line.text = kept;
      } else {
        checks.push({ line: `${si}.${li}`, segment: seg.id, kind: 'repeat', action: 'dropped', was: line.text, reason });
        drop.add(`${si}.${li}`);
      }
    });
  });
  removeLines(bulletin, drop);
  return checks;
}

/**
 * Every line of a bulletin checked against the ledger: scores put right in place, contradicted lines dropped (a
 * segment keeps at least one line). Predictions, adverts and On This Day (other eras) aren't results to check.
 */
export function checkBulletin(ledger: Ledger, bulletin: Bulletin, now: Date): LedgerCheck[] {
  const checks: LedgerCheck[] = [];
  const drop = new Set<string>();
  bulletin.segments.forEach((seg, si) => {
    if (seg.kind === 'adverts' || seg.kind === 'history') return;
    seg.lines.forEach((line, li) => {
      if (line.graphic?.type === 'predictions') return;
      const id = `${si}.${li}`;
      const r = checkLine(ledger, line.text, now);
      if (r.drop) {
        checks.push({ line: id, segment: seg.id, kind: r.drop.kind, action: 'dropped', was: line.text, reason: r.drop.reason });
        drop.add(id);
      } else if (r.fixes.length) {
        checks.push({ line: id, segment: seg.id, kind: 'score', action: 'fixed', was: line.text, now: r.text, reason: r.fixes.map((f) => f.reason).join('; ') });
        line.text = r.text;
      }
    });
  });
  removeLines(bulletin, drop);
  return checks;
}
