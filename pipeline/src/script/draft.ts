import { dayPhrase, partOfDay, spokenList, spokenOrdinal, timePhrase } from '../time.ts';
import { truncate } from '../text.ts';
import { scorerLabels } from '../matchday.ts';
import { howItsGone } from '../reading.ts';
import { describeXI, formOf } from './opponent.ts';
import { firstName, isUs, presenter, teamName, type Facts, type Story } from './facts.ts';
import { historyDraft, type HistoryDraft } from './history.ts';

/** The words of a bulletin, before it is laid out into segments, speakers and graphics. */
export interface Draft {
  welcome: string;
  headlines: { storyId: string; text: string }[];
  /** The lead anchor's "still to come" after the headlines. AI only; the layout has a plain fallback. */
  comingUp?: string;
  /** Spoken hand-overs into each segment (by segment id), by someone already on screen. AI only. */
  transitions?: { to: string; speaker: string; text: string }[];
  matchHandoff: string;
  result?: string;
  table?: string;
  /** Our place in the table of the competition we're building up to, when that isn't the league (e.g. Europe). */
  competitionTable?: string;
  /** What the team stats say about the game on now or just played, with them on screen. */
  stats?: string;
  next?: string;
  transferIntro: string;
  transfers: {
    storyId: string;
    text: string;
    card?: { player: string; from: string; to: string; status: 'rumour' | 'talks' | 'medical' | 'done' };
  }[];
  /** In-depth packages: the lead anchor steers, the expert (analyst, reporter or co-anchor) adds detail. */
  features: Feature[];
  /**
   * The Fan Zone: `text` opens on the overall mood, then `lines` go through the busiest threads ("T1"…) and the
   * supporters' channel shows ("V1"…) as a conversation between the anchors.
   */
  fans: { text: string; score: number; topics: string[]; lines?: { speaker: string; text: string; ref?: string }[] };
  /** Two pundits arguing a talking point in character, ending with score predictions. AI only. */
  debate?: Debate;
  /**
   * New opinions voiced in this bulletin, so presenters stay consistent next time: on a story when it's about one, and
   * how strongly held (1 in passing, 2 firmly, 3 staked their name on it). AI only.
   */
  opinions?: { speaker: string; topic: string; view: string; storyId?: string; strength?: number }[];
  /** The analyst on the next opponent's form and both XIs (build-up days). */
  opponent?: { form: string; theirXI?: string; ourXI?: string };
  /** On This Day at the museum. Template only (script/history.ts), so the history is always as the records have it. */
  history?: HistoryDraft;
  outro: string;
}

export interface Debate {
  topic: string;
  lines: { speaker: string; text: string }[];
  predictions: { speaker: string; homeGoals: number; awayGoals: number }[];
}

export interface Feature {
  storyId: string;
  lines: { role: 'lead' | 'expert'; text: string }[];
  /** A direct quote, copied word for word from the article. */
  quote?: { text: string; by: string };
  /** For a match report: the score and scorers, shown as a result card. */
  result?: StoryResult;
}

export interface StoryResult {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  competition?: string;
  homeScorers?: string[];
  awayScorers?: string[];
}

/** "Match Report: Celtic Women 2-4 Hearts Women" → the score, so a match report can show a result card. */
export function scoreFromTitle(title: string): StoryResult | undefined {
  const team = "[A-Z][\\w'.&]*(?: [A-Z][\\w'.&]*){0,3}";
  const re = new RegExp(`^(${team}) (\\d{1,2}) ?[-–] ?(\\d{1,2}) (${team})$`);
  for (const part of title.split(/[:|]/).map((p) => p.trim())) {
    const m = re.exec(part);
    if (m) return { home: m[1], away: m[4], homeScore: Number(m[2]), awayScore: Number(m[3]) };
  }
  return undefined;
}

const POSITIVE = /\b(brilliant|great|class|delighted|buzzing|superb|quality|love|excellent|happy|positive|belief|proud|magic|unreal|fantastic|confident|promising|outstanding|deserved)\b/gi;
const NEGATIVE = /\b(shambles|disgrace\w*|embarrass\w*|awful|terrible|rubbish|sack\w*|angry|raging|humiliat\w*|worst|pathetic|useless|dreadful|shocking|joke|clueless|worried|concern\w*|thrash\w*|hammer\w*|abysmal|woeful)\b/gi;

/** Crude forum mood from word counts: -1 raging … 1 buzzing. */
export function lexiconMood(texts: string[]): number {
  const all = texts.join(' ');
  const pos = all.match(POSITIVE)?.length ?? 0;
  const neg = all.match(NEGATIVE)?.length ?? 0;
  return Math.max(-1, Math.min(1, (pos - neg) / (pos + neg + 3)));
}

export function moodWord(score: number): string {
  if (score < -0.6) return 'raging';
  if (score < -0.2) return 'uneasy';
  if (score < 0.2) return 'mixed';
  if (score < 0.6) return 'upbeat';
  return 'buzzing';
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** A story as a headline read: a storyline's latest from its brief (its title is only a label), else the headline. */
const headlineRead = (s: Story) => sentence(s.storyline?.brief?.latest || s.storyline?.brief?.known || s.title);

function attribution(sources: string[]): string {
  const spoken = sources.slice(0, 2).map((s) => s.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  return spoken.length > 1 ? `That's being reported by ${spokenList(spoken)}.` : `That's according to ${spoken[0]}.`;
}

/** A plain but always-available script built from the facts alone, no AI involved. */
export function templateDraft(f: Facts): Draft {
  const { club, channel, now } = f;
  const [anchorA] = channel.cast.anchors.map((id) => presenter(f, id));
  const analyst = presenter(f, channel.cast.analyst);
  const name = (n: string) => teamName(club, n);

  let result: string | undefined;
  const phase = f.phase;
  if (phase.kind === 'live') {
    const l = phase.fixture;
    result =
      l.homeScore !== undefined
        ? `Thanks ${firstName(anchorA)}. ${club.shortName} are in action right now. At the time of writing it's ${name(l.home)} ${l.homeScore}, ${name(l.away)} ${l.awayScore}.`
        : `Thanks ${firstName(anchorA)}. ${club.shortName} are in action right now against ${name(l.home === club.shortName ? l.away : l.home)}.`;
  } else if (f.lastResult) {
    const r = f.lastResult;
    const ours = scorerLabels(r, isUs(club, r.home) ? 'home' : 'away').map((s) => s.replace(/\s+\S+$/, ''));
    result =
      `Thanks ${firstName(anchorA)}. ${phase.kind === 'reaction' ? 'Full time' : 'The last result'}: ` +
      `${name(r.home)} ${r.homeScore}, ${name(r.away)} ${r.awayScore}, in the ${r.competition}.` +
      (ours.length ? ` Scoring for ${club.shortName}: ${spokenList([...new Set(ours)])}.` : '');
  }

  let table: string | undefined;
  const us = f.table.find((r) => isUs(club, r.team));
  if (us) {
    const leader = f.table[0];
    const second = f.table[1];
    const gap =
      us.pos === 1 && second
        ? `, ${us.pts - second.pts} points clear of ${name(second.team)}`
        : us.pos > 1
          ? `, ${leader.pts - us.pts} behind leaders ${name(leader.team)}`
          : '';
    table = `${club.shortName} are ${spokenOrdinal(us.pos)} in the league on ${us.pts} points${gap}.`;
  }

  let competitionTable: string | undefined;
  const ct = f.competitionTable;
  const usThere = ct?.rows.find((r) => isUs(club, r.team));
  if (ct && usThere) {
    competitionTable = `In the ${ct.competition}, ${club.shortName} are ${spokenOrdinal(usThere.pos)} of ${ct.rows.length} on ${usThere.pts} points.`;
  }

  let stats: string | undefined;
  const ms = f.matchStats;
  if (ms) {
    const names = { home: name(ms.fixture.home), away: name(ms.fixture.away) };
    const score = { home: ms.fixture.homeScore ?? 0, away: ms.fixture.awayScore ?? 0 };
    stats = `A look at the numbers${ms.final ? '' : ' so far'}. ${howItsGone(names, ms.stats, score, ms.minute).text}`;
  }

  let next: string | undefined;
  const n = f.nextFixtures[0];
  if (n) {
    const d = new Date(n.date);
    next = `Next up: ${name(n.home)} against ${name(n.away)} in the ${n.competition}, ${dayPhrase(d, now)} at ${timePhrase(d)}.`;
  }

  const w = f.window;
  const windowLine = w.open
    ? `The transfer window is open, with ${w.days} days to go.`
    : `The transfer window is shut for now, and reopens in ${w.days} days.`;

  const threads = f.fans.slice(0, 2).map((t) => `"${truncate(t.title, 50)}"`);
  const mood = lexiconMood(f.fans.map((t) => t.summary));
  const forum = f.fans[0]?.sourceName ?? 'the fan forums';

  const opener =
    phase.kind === 'live'
      ? ` ${club.shortName} are in action right now.`
      : phase.kind === 'preview'
        ? ` It's a big day: ${name(phase.fixture.home)} against ${name(phase.fixture.away)}, ${dayPhrase(new Date(phase.fixture.date), now)} at ${timePhrase(new Date(phase.fixture.date))}.`
        : phase.kind === 'reaction'
          ? ` Full time: ${name(phase.result.home)} ${phase.result.homeScore}, ${name(phase.result.away)} ${phase.result.awayScore}.`
          : '';

  let opponent: Draft['opponent'];
  const o = f.opponent;
  if (o) {
    const form = formOf(o);
    const wins = form.filter((r) => r.outcome === 'W').length;
    const latest = form[0];
    const xiVerb = o.confirmed ? 'start with' : 'lined up last time with';
    opponent = {
      form: form.length
        ? `Let's look at the opposition. ${o.opponent} have won ${wins} of their last ${form.length}` +
          (latest ? `, most recently ${latest.outcome === 'W' ? 'beating' : latest.outcome === 'L' ? 'losing to' : 'drawing with'} ${latest.against} ${latest.score}.` : '.')
        : `Let's look at the opposition, ${o.opponent}.`,
      theirXI: o.theirXI ? `${o.opponent} ${xiVerb} ${describeXI(o.theirXI)}.` : undefined,
      ourXI: o.ourXI ? `${club.shortName} ${o.confirmed ? 'start with' : 'went with'} ${describeXI(o.ourXI)}.` : undefined,
    };
  }

  return {
    opponent,
    history: historyDraft(f),
    welcome: `Good ${partOfDay(now)}, and welcome to ${channel.spokenName}.${opener} Here are the latest headlines.`,
    headlines: f.pool.slice(0, 4).map((s) => ({ storyId: s.id, text: `${headlineRead(s)} ${attribution(s.sources)}` })),
    matchHandoff: `Let's go over to ${firstName(analyst)} in the Match Centre.`,
    result,
    table,
    competitionTable,
    stats,
    next,
    transferIntro: f.transfers.length ? `${windowLine} Here's what's being talked about.` : `${windowLine} It's quiet on the transfer front at the moment.`,
    transfers: f.transfers.map((s) => ({ storyId: s.id, text: `${headlineRead(s)} ${attribution(s.sources)}` })),
    // Without AI there's no safe way to rewrite an article, so packages use a storyline's brief or the outlet's own
    // feed summary.
    features: f.features
      .map((s): Feature | undefined => {
        // Video descriptions end in a run of hashtags, which mustn't be read out.
        const standfirst =
          s.storyline?.brief?.known ?? s.items.map((i) => i.summary.replace(/#\w+/g, '').replace(/\s*(?:…|\.{3})\s*$/, '').trim()).find((t) => t.length > 40);
        if (!standfirst) return undefined;
        return {
          storyId: s.id,
          lines: [
            { role: 'lead', text: `Let's take a closer look at one of today's main stories. ${s.storyline ? `${s.title}.` : sentence(s.title)}` },
            { role: 'expert', text: `${sentence(truncate(standfirst, 300))} ${attribution(s.sources)}` },
          ],
          result: scoreFromTitle(s.title),
        };
      })
      .filter((x): x is Feature => Boolean(x)),
    fans: {
      text: threads.length
        ? `Over on ${forum}, the busiest threads are ${spokenList(threads)}, and the mood is ${moodWord(mood)}.`
        : `It's been quiet on the fan forums today.`,
      score: mood,
      topics: f.fans.slice(0, 4).map((t) => truncate(t.title, 40)),
    },
    outro: `That's all for now. Rolling news continues, right here on ${channel.spokenName}.`,
  };
}
