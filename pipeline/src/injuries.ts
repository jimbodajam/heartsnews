import type { Claim, Storyline } from './storylines.ts';

// The injury table (issue #107): one record per player injury, so the presenters can give real numbers ("seven in the
// treatment room, three of them hamstrings"). What the reports say (the part of the body, the status, the expected
// return) is read in the same request that writes the injury storyline's brief; when he got injured, when he came back
// and how many games he missed are worked out here from our own line-ups count (tally_games). The SQL is in store.ts.

export type InjuryType = 'muscle' | 'ligament' | 'bone' | 'knock' | 'illness' | 'unknown';
export type InjuryStatus = 'out' | 'doubt' | 'back' | 'unknown';
export type ReturnBand = 'short' | 'medium' | 'long' | 'season';

export const AREAS = ['hamstring', 'knee', 'ankle', 'groin', 'calf', 'thigh', 'quad', 'hip', 'back', 'foot', 'achilles', 'shoulder', 'head', 'illness'];
const TYPES: InjuryType[] = ['muscle', 'ligament', 'bone', 'knock', 'illness', 'unknown'];
const STATUSES: InjuryStatus[] = ['out', 'doubt', 'back', 'unknown'];

const DAY_MS = 86_400_000;
/** His last game counts as where he got injured if the first report is within this long of it. */
export const INJURED_WITHIN_DAYS = 7;

/** What the brief request gives for one injury. */
export interface InjuryReading {
  area?: string;
  type: InjuryType;
  side?: 'left' | 'right';
  status: InjuryStatus;
  /** The club or the manager said it. */
  byClub: boolean;
  /** A claim says it happened in training, not in a game. */
  inTraining?: boolean;
  /** The return period as reported ("four to six weeks"). */
  estimate?: string;
  /** The claim the estimate came from. */
  estimateClaim?: number;
  /** Claims about this injury. */
  claims: number[];
}

/** One row of the table. */
export interface Injury {
  storylineId: number;
  n: number;
  entity: string;
  /** From entities, when loaded for the script. */
  name?: string;
  area?: string;
  type: InjuryType;
  side?: 'left' | 'right';
  claims: number[];
  /** Hurt in training: never dated to his last game. */
  inTraining: boolean;
  firstReportedAt: string;
  injuredMatchId?: string;
  injuredAt: string;
  dateBasis: 'match' | 'first_report';
  returnEstimate?: string;
  returnFrom?: string;
  returnTo?: string;
  returnBand?: ReturnBand;
  claimedStatus: InjuryStatus;
  status: InjuryStatus;
  confirmed: boolean;
  returnedMatchId?: string;
  returnedAt?: string;
  daysOut?: number;
  gamesMissed?: number;
  locked: boolean;
}

/** A counted Hearts game (tally_runs): its id ("<date>|<home>|<away>") and kick-off. */
export interface Game {
  id: string;
  date: string;
}

/** The games counted, and who played in which (by entity), for working out the dates. */
export interface LineUps {
  games: Game[];
  played: Map<string, Set<string>>;
  /** The first day our count covers (tally_since): before it there are no line-ups to go on. */
  since?: string;
}

// ---- The brief request's part ----

const S = { type: 'string' };
/** Added to each brief in BRIEF_SCHEMA; only injury storylines about a player fill it. */
export const INJURY_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      area: S,
      type: { type: 'string', enum: TYPES },
      side: { type: 'string', enum: ['left', 'right', 'unknown'] },
      status: { type: 'string', enum: STATUSES },
      byClub: { type: 'boolean' },
      inTraining: { type: 'boolean' },
      estimate: S,
      estimateClaim: S,
      claims: { type: 'array', items: S },
    },
    required: ['area', 'status', 'claims'],
  },
};

export const INJURY_INSTRUCTIONS = `- injuries: only for a storyline marked "injury" that is about one player; otherwise leave it out. One entry per separate injury he has had, oldest first. Records we already hold are listed under the storyline as i1, i2…: give them again in that order (corrected if the claims now say more), then any new one. Start a new entry only for a different part of the body, or a fresh setback after he had played again; anything else is the same injury. For each:
  area: the part of the body, one of ${AREAS.join(', ')}, or "unknown" when the claims don't say ("a knock" is unknown);
  type: muscle (a strain or tear of a muscle, like a hamstring), ligament (ACL, a sprain), bone (a break or fracture), knock, illness, or unknown;
  side: left, right or unknown;
  status: from the latest claims: out (ruled out, sidelined, injured, or expected back only at some later date), doubt (a doubt, a race to be fit, being assessed), back (fit again, back in training or playing), or unknown;
  byClub: true only if the club or the manager or coach said it, not just a newspaper;
  inTraining: true only if a claim says he was hurt in training;
  estimate: how long he's expected to be out or when he's expected back, copied word for word from a claim, and estimateClaim the ref of that claim; empty if no claim gives one (never a period the claims don't give);
  claims: the refs of the claims about this injury, like ["c12", "c15"].`;

const asClaimId = (ref: unknown) => {
  const m = /^\s*c?\s*(\d+)\s*$/i.exec(String(ref ?? ''));
  return m ? Number(m[1]) : undefined;
};

/** The brief reply's injuries for one storyline, kept to its own claims and the values we know. */
export function parseInjuries(raw: unknown, s: Storyline): InjuryReading[] {
  if (!Array.isArray(raw)) return [];
  const own = new Set(s.claims.map((c) => c.id));
  const out: InjuryReading[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const claims = [...new Set((Array.isArray(r.claims) ? r.claims : []).map(asClaimId).filter((id): id is number => id != null && own.has(id)))];
    const area = String(r.area ?? '').trim().toLowerCase().replace(/s$/, '');
    const estimate = String(r.estimate ?? '').trim();
    const estimateClaim = asClaimId(r.estimateClaim);
    out.push({
      ...(AREAS.includes(area) ? { area } : {}),
      type: TYPES.includes(r.type as InjuryType) ? (r.type as InjuryType) : area === 'illness' ? 'illness' : 'unknown',
      ...(r.side === 'left' || r.side === 'right' ? { side: r.side } : {}),
      status: STATUSES.includes(r.status as InjuryStatus) ? (r.status as InjuryStatus) : 'unknown',
      byClub: r.byClub === true || r.byClub === 'true',
      ...(r.inTraining === true || r.inTraining === 'true' ? { inTraining: true } : {}),
      ...(estimate && !/^(none|unknown|n\/a)$/i.test(estimate) ? { estimate } : {}),
      ...(estimateClaim != null && own.has(estimateClaim) ? { estimateClaim } : {}),
      claims,
    });
  }
  // An injury with no claims of its own gets the storyline's, when it's the only one.
  if (out.length === 1 && !out[0].claims.length) out[0].claims = s.claims.filter((c) => c.status !== 'replaced').map((c) => c.id);
  return out.filter((i) => i.claims.length);
}

/** What the brief request sees under an injury storyline: our records so far, and the games he has played in. */
export function injuryNotes(existing: Injury[], lineUps: LineUps, entity: string): string {
  const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(iso));
  const played = lineUps.played.get(entity) ?? new Set();
  const games = lineUps.games.slice(-12).map((g) => `${day(g.date)} ${played.has(g.id) ? 'played' : 'did not play'}`);
  const records = existing.map((i) => `  i${i.n}: ${i.area ?? 'unknown area'}, ${i.status}; claims ${i.claims.map((c) => `c${c}`).join(', ')}`);
  return [
    records.length ? `Injury records so far:\n${records.join('\n')}` : 'Injury records so far: none.',
    games.length ? `Hearts games in our count: ${games.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---- Working out the dates ----

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, fortnight: 14, month: 30 };
const NUM = `(\\d+|${Object.keys(WORDS).join('|')})`;
const UNIT = '(day|week|fortnight|month)s?';
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);

const bandOf = (days: number): ReturnBand => (days <= 21 ? 'short' : days <= 56 ? 'medium' : 'long');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export interface ReturnPeriod {
  from?: string;
  to?: string;
  band?: ReturnBand;
  /** The words it was read from ("four to six weeks"). */
  said?: string;
}

/**
 * A reported return period as dates counted from the claim's date: "four to six weeks" from 1 Nov is 29 Nov to 13 Dec;
 * "until the New Year" is 1 January. Vague ones get only a band: "a few days" short, "weeks" medium, "months" or
 * "long-term" long, "the rest of the season" season.
 */
export function parseReturn(text: string | undefined, from: string): ReturnPeriod {
  if (!text) return {};
  const t = text.toLowerCase().replace(/[‐-―−]/g, '-').replace(/\ba couple of\b/g, 'couple');
  const at = (days: number) => new Date(Date.parse(from) + days * DAY_MS).toISOString();
  const fixed = (iso: string, said: string): ReturnPeriod => ({ from: iso, to: iso, band: bandOf((Date.parse(iso) - Date.parse(from)) / DAY_MS), said });
  const season = /\b(?:the )?(?:rest of the |whole )?(season|campaign)\b/.exec(t);
  if (season) return { band: 'season', said: season[0] };
  const range = new RegExp(`\\b${NUM}\\s*(?:-|to|or)\\s*${NUM}\\s+${UNIT}\\b`).exec(t);
  if (range) {
    const [lo, hi, unit] = [num(range[1]), num(range[2]), UNIT_DAYS[range[3]]];
    if (lo && hi && hi >= lo) return { from: at(lo * unit), to: at(hi * unit), band: bandOf(hi * unit), said: range[0] };
  }
  const one = new RegExp(`\\b${NUM}\\s+${UNIT}\\b`).exec(t) ?? /\b(a )?(fortnight)\b/.exec(t);
  if (one) {
    const days = num(one[1] ?? 'a') * UNIT_DAYS[one[2]];
    if (days) return { from: at(days), to: at(days), band: bandOf(days), said: one[0] };
  }
  // "until the New Year", "after New Year": 1 January. "until January", "back in March": the 1st of that month next.
  const year = /\b(?:until |after |into )?(?:the )?new year\b/.exec(t);
  const start = new Date(from);
  if (year) return fixed(new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1)).toISOString(), year[0]);
  const month = new RegExp(`\\b(?:until|till|in|by|after|before|end of|early|late|mid-?)\\s+(${MONTHS.join('|')})\\b`).exec(t);
  if (month) {
    const m = MONTHS.indexOf(month[1]);
    const y = m > start.getUTCMonth() ? start.getUTCFullYear() : start.getUTCFullYear() + 1;
    return fixed(new Date(Date.UTC(y, m, 1)).toISOString(), month[0]);
  }
  const band = (b: ReturnBand, re: RegExp): ReturnPeriod | undefined => {
    const m = re.exec(t);
    return m ? { band: b, said: m[0] } : undefined;
  };
  return (
    band('long', /\b(long[- ]term|(?:several |a few |a couple of )?months|a year)\b/) ??
    band('medium', /\b(?:a few |several |a number of |for )?weeks\b/) ??
    band('short', /\b((?:a few )?days|short[- ]term|next (?:game|match|week)|this week(?:end)?)\b/) ??
    {}
  );
}

/** The words of a claim, squashed for checking an estimate came from it. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Outlets that count towards "two separate sources": the ones read (not just a headline), leaving out shows. */
function outletsOf(claims: Claim[], shows: ReadonlySet<string>): Set<string> {
  return new Set(claims.flatMap((c) => c.sources.filter((x) => !x.corroboration && !shows.has(x.outlet)).map((x) => x.outlet)));
}

export interface ReadingContext {
  /** Outlets that are the club itself (its website, its TV channel). */
  clubOutlets: ReadonlySet<string>;
  /** Fan shows: their word alone confirms nothing. */
  shows: ReadonlySet<string>;
}

/**
 * A row from what the brief request read: the claims, when it was first reported, the expected return, and whether
 * it's confirmed (the club or the manager said it, or two separate outlets report it). The dates come from settle().
 */
export function fromReading(r: InjuryReading, n: number, s: Storyline, ctx: ReadingContext): Omit<Injury, 'injuredAt' | 'dateBasis' | 'status'> | undefined {
  if (!s.entity) return undefined;
  const claims = s.claims.filter((c) => r.claims.includes(c.id));
  if (!claims.length) return undefined;
  const firstReportedAt = claims.map((c) => c.firstSeen).sort()[0];
  const standing = claims.filter((c) => c.status !== 'replaced');
  const outlets = outletsOf(standing, ctx.shows);
  const confirmed = r.byClub || standing.some((c) => c.status === 'confirmed') || outlets.size >= 2 || [...outlets].some((o) => ctx.clubOutlets.has(o));
  // The expected return is the newest claim's that gives a period, counted from that claim. Failing that, the model's
  // words, but only if they are a claim's (a model will copy an example from its instructions), kept as said.
  const fromClaims = [...standing].reverse().map((c) => parseReturn(c.text, c.firstSeen)).find((p) => p.band);
  const said = r.estimate && standing.find((c) => squash(c.text).includes(squash(r.estimate!)));
  const ret = fromClaims ?? (said ? { ...parseReturn(r.estimate, said.firstSeen), said: r.estimate } : {});
  return {
    storylineId: s.id,
    n,
    entity: s.entity,
    ...(r.area ? { area: r.area } : {}),
    type: r.type,
    ...(r.side ? { side: r.side } : {}),
    claims: claims.map((c) => c.id),
    inTraining: Boolean(r.inTraining),
    firstReportedAt,
    ...(ret.said ? { returnEstimate: ret.said } : {}),
    ...(ret.from ? { returnFrom: ret.from, returnTo: ret.to } : {}),
    ...(ret.band ? { returnBand: ret.band } : {}),
    claimedStatus: r.status,
    confirmed,
    locked: false,
  };
}

/**
 * The dates, from our line-ups count. He got injured in his last game before the first report, if that was within a
 * week of it (unless the reports say it was in training); otherwise on the day it was first reported. He's back the first time he plays after that, and the games
 * he missed are the counted Hearts games in between (or up to now). Playing again overrides whatever the claims said.
 */
export function settle(i: Omit<Injury, 'injuredAt' | 'dateBasis' | 'status'> & Partial<Injury>, lineUps: LineUps, now: Date): Injury {
  const first = Date.parse(i.firstReportedAt);
  const played = lineUps.played.get(i.entity) ?? new Set<string>();
  const games = [...lineUps.games].sort((a, b) => a.date.localeCompare(b.date));
  const last = i.inTraining
    ? undefined
    : games.filter((g) => played.has(g.id) && Date.parse(g.date) <= first && first - Date.parse(g.date) <= INJURED_WITHIN_DAYS * DAY_MS).at(-1);
  const injuredAt = last?.date ?? i.firstReportedAt;
  const t = Date.parse(injuredAt);
  const back = games.find((g) => played.has(g.id) && Date.parse(g.date) > t && Date.parse(g.date) <= now.getTime());
  const until = back ? Date.parse(back.date) : now.getTime();
  const missed = games.filter((g) => Date.parse(g.date) > t && Date.parse(g.date) < until).length;
  const {
    injuredMatchId: _a,
    returnedMatchId: _b,
    returnedAt: _c,
    ...rest
  } = i;
  return {
    ...rest,
    ...(last ? { injuredMatchId: last.id } : {}),
    injuredAt,
    dateBasis: last ? 'match' : 'first_report',
    status: back ? 'back' : i.claimedStatus,
    ...(back ? { returnedMatchId: back.id, returnedAt: back.date } : {}),
    daysOut: Math.max(0, Math.round((until - t) / DAY_MS)),
    gamesMissed: missed,
  };
}

// ---- What the script is given ----

export interface InjuryList {
  /** Out, a doubt, or unclear: one per player (his latest injury). */
  current: Injury[];
  /** Back in the last week. */
  back: Injury[];
}

const BACK_DAYS = 7;

/** The list for a bulletin: who's injured now, and who has just come back. Rows must have names. */
export function injuryList(rows: Injury[], now: Date): InjuryList {
  const latest = new Map<string, Injury>();
  for (const r of [...rows].sort((a, b) => a.injuredAt.localeCompare(b.injuredAt))) latest.set(r.entity, r);
  const all = [...latest.values()].filter((r) => r.name);
  return {
    current: all.filter((r) => r.status !== 'back').sort((a, b) => (a.status === b.status ? a.injuredAt.localeCompare(b.injuredAt) : a.status === 'out' ? -1 : b.status === 'out' ? 1 : 0)),
    // Back without a game missed by our count is a doubt that came to nothing, or an injury we've dated wrong: not news.
    back: all.filter((r) => r.status === 'back' && r.returnedAt && (r.gamesMissed ?? 0) > 0 && now.getTime() - Date.parse(r.returnedAt) <= BACK_DAYS * DAY_MS),
  };
}

const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }).format(new Date(iso));
const opponentOf = (matchId: string, club: string) => {
  const [, home, away] = matchId.split('|');
  return home === club ? away : home;
};

const BAND_TEXT: Record<ReturnBand, string> = { short: 'a short-term absence', medium: 'several weeks', long: 'a long-term absence', season: 'the rest of the season' };

function expectedBack(i: Injury): string {
  if (i.returnFrom && i.returnTo) {
    const when = i.returnFrom === i.returnTo ? `around ${dayLabel(i.returnFrom)}` : `between ${dayLabel(i.returnFrom)} and ${dayLabel(i.returnTo)}`;
    return `expected back ${when} ("${i.returnEstimate}")`;
  }
  if (i.returnBand) return `expected out for ${BAND_TEXT[i.returnBand]}${i.returnEstimate ? ` ("${i.returnEstimate}")` : ''}`;
  return i.returnEstimate ? `expected back "${i.returnEstimate}" (no date given)` : 'no return date reported';
}

/** "Stephen Kingsley: hamstring, OUT (confirmed), injured v Motherwell on 25 October, expected back…; 3 games missed so far" */
export function injuryFact(i: Injury, club: string): string {
  const status =
    i.status === 'out' ? (i.confirmed ? 'out (confirmed)' : 'reported to be out (not confirmed: say "reported")') : i.status === 'doubt' ? 'a doubt' : 'fitness unclear';
  const since = i.dateBasis === 'match' && i.injuredMatchId ? `injured against ${opponentOf(i.injuredMatchId, club)} on ${dayLabel(i.injuredAt)}` : `first reported ${dayLabel(i.firstReportedAt)}`;
  const area = [i.side, i.area ?? 'injury (area not reported)'].filter(Boolean).join(' ');
  const missed = i.gamesMissed != null ? `; ${i.gamesMissed} ${i.gamesMissed === 1 ? 'game' : 'games'} missed so far` : '';
  return `${i.name}: ${area}, ${status}, ${since}, ${expectedBack(i)}${missed}`;
}

/** The DATA block for the script and the fact check. */
export function injuryFacts(list: InjuryList | undefined, club: string): string {
  if (!list) return '';
  const out = list.current.filter((i) => i.status === 'out');
  const confirmed = out.filter((i) => i.confirmed).length;
  const doubts = list.current.filter((i) => i.status === 'doubt').length;
  const areas = new Map<string, number>();
  for (const i of list.current) if (i.area) areas.set(i.area, (areas.get(i.area) ?? 0) + 1);
  const areaText = [...areas.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ');
  const back = list.back.map((i) => `${i.name} (back against ${opponentOf(i.returnedMatchId!, club)} on ${dayLabel(i.returnedAt!)}, after ${i.gamesMissed} ${i.gamesMissed === 1 ? 'game' : 'games'} out)`);
  return `${club} injury list (our own record from the reports and our line-ups count; these counts are true, say them exactly, and say "reported" for anyone not confirmed):
Out: ${out.length} (${confirmed} confirmed by the club or two outlets, ${out.length - confirmed} only reported); doubts: ${doubts}${areaText ? `; by area: ${areaText}` : ''}
${list.current.map((i) => `- ${injuryFact(i, club)}`).join('\n') || '- (nobody injured)'}${back.length ? `\nJust back: ${back.join('; ')}` : ''}`;
}

/** The Match Centre's template line for a build-up: who's missing. */
export function missingLine(list: InjuryList | undefined): string | undefined {
  const out = list?.current.filter((i) => i.status === 'out') ?? [];
  if (!out.length) return undefined;
  const names = out.slice(0, 4).map((i) => i.name);
  const more = out.length - names.length;
  const said = more > 0 ? `${names.join(', ')} and ${more} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const reported = out.some((i) => !i.confirmed);
  return `On the injury front, ${out.length === 1 ? 'one player is' : `${out.length} players are`} ${reported ? 'out or reported to be out' : 'out'}: ${said}.`;
}

/** The club's own outlets, by source id and name (a claim's outlet is its publisher or its source): its website and its TV channel. */
export function clubOutlets(club: { sources: { id: string; name: string; kind: string; fan?: boolean }[] }): Set<string> {
  const own = club.sources.filter((s) => s.kind === 'official' || (s.kind === 'video' && !s.fan));
  return new Set(own.flatMap((s) => [s.id, s.name, s.name.replace(/ \(.*\)$/, '')]));
}
