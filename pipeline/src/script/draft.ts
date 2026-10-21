import { dayPhrase, partOfDay, spokenList, spokenOrdinal, timePhrase } from '../time.ts';
import { truncate } from '../text.ts';
import { firstName, presenter, teamName, type Facts } from './facts.ts';

/** The words of a bulletin, before it is laid out into segments, speakers and graphics. */
export interface Draft {
  welcome: string;
  headlines: { storyId: string; text: string }[];
  matchHandoff: string;
  result?: string;
  table?: string;
  next?: string;
  transferIntro: string;
  transfers: {
    storyId: string;
    text: string;
    card?: { player: string; from: string; to: string; status: 'rumour' | 'talks' | 'medical' | 'done' };
  }[];
  /** In-depth packages: the lead anchor steers, the expert (analyst, reporter or co-anchor) adds detail. */
  features: Feature[];
  fans: { text: string; score: number; topics: string[] };
  /** Two pundits arguing a talking point in character, ending with score predictions. AI only. */
  debate?: Debate;
  /** New opinions voiced in this bulletin, so presenters stay consistent next time. AI only. */
  opinions?: { speaker: string; topic: string; view: string }[];
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
  if (f.lastResult) {
    const r = f.lastResult;
    result = `Thanks ${firstName(anchorA)}. The last result: ${name(r.home)} ${r.homeScore}, ${name(r.away)} ${r.awayScore}, in the ${r.competition}.`;
  }

  let table: string | undefined;
  const us = f.table.find((r) => r.team === club.name);
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

  return {
    welcome: `Good ${partOfDay(now)}, and welcome to ${channel.spokenName}. Here are the latest headlines.`,
    headlines: f.pool.slice(0, 4).map((s) => ({ storyId: s.id, text: `${sentence(s.title)} ${attribution(s.sources)}` })),
    matchHandoff: `Let's go over to ${firstName(analyst)} in the Match Centre.`,
    result,
    table,
    next,
    transferIntro: f.transfers.length ? `${windowLine} Here's what's being talked about.` : `${windowLine} It's quiet on the transfer front at the moment.`,
    transfers: f.transfers.map((s) => ({ storyId: s.id, text: `${sentence(s.title)} ${attribution(s.sources)}` })),
    // Without AI there's no safe way to rewrite an article, so packages use the outlet's own feed summary.
    features: f.features
      .map((s): Feature | undefined => {
        const standfirst = s.items.map((i) => i.summary).find((t) => t.length > 40);
        if (!standfirst) return undefined;
        return {
          storyId: s.id,
          lines: [
            { role: 'lead', text: `Let's take a closer look at one of today's main stories. ${sentence(s.title)}` },
            { role: 'expert', text: `${sentence(truncate(standfirst, 300))} ${attribution(s.sources)}` },
          ],
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
