import type { Bulletin, Graphic, IconId, Line, Segment, Sidebar, TableRow } from '../../../shared/bulletin.ts';
import { statsCard } from '../../../shared/live.ts';
import type { Story, StoryCategory } from '../stories.ts';
import { truncate } from '../text.ts';
import { scorerLabels } from '../matchday.ts';
import { predictionRecord } from '../memory.ts';
import { adBreaks, loadAdverts } from './adverts.ts';
import { faceFor, loadFaces } from './faces.ts';
import { formOf, headToHeadGraphic } from './opponent.ts';
import type { Debate, Draft, Feature } from './draft.ts';
import { expertFor, firstName, isUs, presenter, runningOrder, teamName, type Facts } from './facts.ts';
import { spokenList } from '../time.ts';
import { historyHost, historySegment } from './history.ts';
import { deskSignature } from './quiet.ts';

const ICON: Record<StoryCategory, IconId> = { transfer: 'contract', contract: 'contract', injury: 'medical', discipline: 'whistle', match: 'ball', news: 'mic' };

const FACES = loadFaces();
const ADVERTS = loadAdverts();

/** Going into an ad break, in turn. */
const BREAK_LINES = ["We'll take a short break now. Stay with us.", "Time for a quick break. Don't go anywhere."];

/** A story's headline card, with the portrait of whoever it's about when we have one. */
function headlineGraphic(s: Story): Graphic {
  const face = faceFor(s.title, FACES) ?? faceFor(s.summary, FACES);
  return { type: 'headline', title: s.title, source: s.sources[0], icon: ICON[s.category], face };
}

/** "UEFA Conference League" → "Conference League", to fit a panel title. */
const shortCompetition = (c: string) => c.replace(/^UEFA\s+/i, '');

/** The `size` rows of a table around us, rather than always the top. */
function rowsAroundUs(f: Facts, rows: Facts['table'], size: number): TableRow[] {
  const at = Math.max(0, rows.findIndex((t) => isUs(f.club, t.team)));
  const start = Math.min(Math.max(0, at - 2), Math.max(0, rows.length - size));
  return rows.slice(start, start + size).map((t) => ({ pos: t.pos, team: teamName(f.club, t.team), played: t.played, gd: t.gd, pts: t.pts }));
}

/** A reply from the AI sometimes starts with the speaker's id ("kirsty | That's right…"): that mustn't be read out. */
function stripSpeakerPrefix(text: string, ids: string[]): string {
  const m = /^\s*([\w-]+)\s*\|\s*/.exec(text);
  return m && ids.includes(m[1].toLowerCase()) ? text.slice(m[0].length) : text;
}

/** Lay a draft out as segments: who says each line, on which set, with which graphic. */
export function assemble(f: Facts, draft: Draft, generatedBy: string): Bulletin {
  const { club, channel, now } = f;
  const [a, b] = channel.cast.anchors;
  const analyst = channel.cast.analyst;
  const reporter = channel.cast.transfers;
  const name = (n: string) => teamName(club, n);
  const story = (id: string) => f.pool.find((s) => s.id === id) ?? f.transfers.find((s) => s.id === id);
  const next = f.nextFixtures[0];
  const nextLabel = next
    ? `${name(next.home)} v ${name(next.away)} - ${new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' }).format(new Date(next.date))}`
    : undefined;

  const hasMatch = Boolean(draft.result || draft.table || draft.next);
  const segments: Segment[] = [];

  // Headlines at the desk: the two anchors take turns.
  const headlineLines: Line[] = [{ speaker: a, text: draft.welcome, link: 'welcome' }];
  draft.headlines.forEach((h, i) => {
    const s = story(h.storyId);
    headlineLines.push({ speaker: i % 2 === 0 ? b : a, text: h.text, graphic: s ? headlineGraphic(s) : undefined });
  });
  const lead =story(draft.headlines[0]?.storyId ?? '');
  segments.push({
    id: 'headlines',
    kind: 'headlines',
    title: 'The Headlines',
    strap: lead ? truncate(lead.title, 70) : `${club.shortName} latest`,
    scene: 'desk',
    presenters: [a, b],
    lines: headlineLines,
  });

  // Match Centre on the touchscreen.
  if (hasMatch) {
    const lines: Line[] = [];
    // During a game the card shows the live score; otherwise the last result.
    const live = f.phase.kind === 'live' ? f.phase.fixture : undefined;
    const liveScore = live && live.homeScore !== undefined && live.awayScore !== undefined;
    const r = live ?? f.lastResult;
    if (draft.result && live && !liveScore) {
      // Kicked off but no score in the feed yet: say so rather than show a made-up 0-0.
      lines.push({
        speaker: analyst,
        text: draft.result,
        graphic: { type: 'headline', title: `${name(live.home)} v ${name(live.away)}: in progress`, source: live.competition, icon: 'whistle' },
      });
    } else if (draft.result && r) {
      lines.push({
        speaker: analyst,
        text: draft.result,
        graphic: {
          type: 'result',
          home: name(r.home),
          away: name(r.away),
          homeScore: r.homeScore ?? 0,
          awayScore: r.awayScore ?? 0,
          competition: r.competition,
          status: live ? `LIVE ${live.period && /\d|HT/.test(live.period) ? live.period : ''}`.trim() : 'FULL TIME',
          homeScorers: scorerLabels(r, 'home'),
          awayScorers: scorerLabels(r, 'away'),
        },
      });
    }
    const ms = f.matchStats;
    if (draft.stats && ms) {
      const x = ms.fixture;
      lines.push({
        speaker: analyst,
        text: draft.stats,
        graphic: statsCard(
          {
            home: name(x.home),
            away: name(x.away),
            homeScore: x.homeScore ?? 0,
            awayScore: x.awayScore ?? 0,
            competition: x.competition,
            status: ms.final ? 'FULL TIME' : x.period === 'HT' ? 'HALF TIME' : `LIVE ${x.period}`,
          },
          ms.stats,
        ),
      });
    }
    if (draft.milestones) lines.push({ speaker: analyst, text: draft.milestones });
    if (draft.table && f.table.length) {
      // The screen fits six rows: show the ones around us rather than always the top six.
      lines.push({
        speaker: analyst,
        text: draft.table,
        graphic: { type: 'table', title: 'League Table', highlight: club.shortName, rows: rowsAroundUs(f, f.table, 6) },
      });
    }
    // On a European (or cup group) matchday, that competition's table too.
    const ct = f.competitionTable;
    if (draft.competitionTable && ct) {
      lines.push({
        speaker: analyst,
        text: draft.competitionTable,
        graphic: { type: 'table', title: `${shortCompetition(ct.competition)} Table`, highlight: club.shortName, rows: rowsAroundUs(f, ct.rows, 6) },
      });
    }
    if (draft.next && f.nextFixtures.length) {
      // Building up to a game, the card is that game alone, big; otherwise the next few.
      const upcoming = f.phase.kind === 'preview' ? [f.phase.fixture] : f.nextFixtures;
      lines.push({
        speaker: analyst,
        text: draft.next,
        graphic: {
          type: 'fixtures',
          title: upcoming.length > 1 ? 'Coming Up' : 'Next Match',
          fixtures: upcoming.map((x) => ({ date: x.date, home: name(x.home), away: name(x.away), competition: x.competition })),
        },
      });
    }
    segments.push({
      id: 'match',
      kind: 'match',
      title: 'Match Centre',
      strap: live
        ? liveScore
          ? `LIVE: ${name(live.home)} ${live.homeScore}-${live.awayScore} ${name(live.away)}`
          : `LIVE: ${name(live.home)} v ${name(live.away)}`
        : (nextLabel ?? `${club.shortName} results and table`),
      scene: 'touchscreen',
      presenters: [analyst],
      lines,
    });
  }

  // Transfer Centre.
  const windowText = f.window.open ? `Transfer window closes in ${f.window.days} days` : `Transfer window opens in ${f.window.days} days`;
  const transferLines: Line[] = [
    { speaker: reporter, text: draft.transferIntro, graphic: { type: 'headline', title: windowText, icon: 'contract' } },
  ];
  for (const t of draft.transfers) {
    const s = story(t.storyId);
    transferLines.push({
      speaker: reporter,
      text: t.text,
      graphic: t.card ? { type: 'transfer', ...t.card } : s ? headlineGraphic(s) : undefined,
    });
  }
  segments.push({
    id: 'transfers',
    kind: 'transfers',
    title: 'Transfer Centre',
    strap: windowText,
    scene: 'transfer',
    presenters: [reporter],
    lines: transferLines,
  });

  // Fan Zone back at the desk: the mood, then the busiest threads and the supporters' channel one by one, then the sign-off.
  const fanCard = (ref?: string): Graphic | undefined => {
    const i = Number(ref?.slice(1)) - 1;
    const thread = ref?.startsWith('T') ? f.fans[i] : undefined;
    if (thread) return { type: 'headline', title: thread.title, source: `${thread.sourceName}: ${thread.engagement ?? 0} replies`, icon: 'chat' };
    const video = ref?.startsWith('V') ? f.fanVideos[i] : undefined;
    if (video) return { type: 'headline', title: video.title, source: video.sourceName.replace(/\s*\(.*?\)/, ''), icon: 'mic' };
    return undefined;
  };
  segments.push({
    id: 'fans',
    kind: 'fans',
    title: 'Fan Zone',
    strap: 'What the supporters are saying',
    scene: 'desk',
    presenters: [a, b],
    lines: [
      {
        speaker: b,
        text: draft.fans.text,
        graphic: f.fans.length ? { type: 'sentiment', score: draft.fans.score, topics: draft.fans.topics } : undefined,
      },
      ...(draft.fans.lines ?? []).map((l): Line => ({ speaker: l.speaker, text: l.text, graphic: fanCard(l.ref) })),
      { speaker: a, text: draft.outro, link: 'outro' },
    ],
  });

  const debate = draft.debate ? debateSegment(f, draft.debate) : undefined;
  if (debate) segments.push(debate);
  const opposition = draft.opponent && f.opponent ? opponentSegment(f, draft.opponent) : undefined;
  if (opposition) segments.push(opposition);
  for (const feat of draft.features) {
    const s = featureSegment(f, feat);
    if (s) segments.push(s);
  }
  const history = draft.history && historySegment(f, draft.history);
  if (history) segments.push(history);

  // Up to five in-depth packages spread between the regular segments, like a rolling news hour (see runningOrder).
  const featured = draft.features.map((x) => f.features.find((s) => s.id === x.storyId)).filter((s): s is Story => Boolean(s));
  const ordered = runningOrder(f, { features: featured, debate: Boolean(debate), match: hasMatch, history: Boolean(history) })
    .map((slot) => segments.find((s) => s.id === slot.id))
    .filter((s): s is Segment => Boolean(s));

  // "Still to come" after the headlines.
  const later = ordered.slice(1);
  const comingUp = draft.comingUp ?? defaultComingUp(f, later);
  if (comingUp) ordered[0].lines.push({ speaker: a, text: comingUp, link: 'comingUp' });

  // Ad breaks (adverts.json): the first after the debate (or halfway through), the second just before the Fan Zone.
  const breaks = ADVERTS ? adBreaks(ADVERTS, now) : [];
  const fansAt = ordered.findIndex((s) => s.id === 'fans');
  if (breaks[1] && fansAt > 0) ordered.splice(fansAt, 0, breaks[1]);
  const debateAt = ordered.findIndex((s) => s.id === 'debate');
  const firstAt = debateAt > 0 ? debateAt + 1 : Math.ceil(ordered.length / 2);
  if (breaks[0] && ordered[firstAt]?.kind !== 'adverts' && ordered[firstAt - 1]?.kind !== 'adverts') ordered.splice(firstAt, 0, breaks[0]);

  // A hand-over into every segment, said by someone on screen in the one before; around a break, "stay with us" and "welcome back".
  let breakNo = 0;
  for (let i = 1; i < ordered.length; i++) {
    const [prev, seg] = [ordered[i - 1], ordered[i]];
    const speaker = prev.presenters.includes(a) ? a : prev.presenters[0];
    if (seg.kind === 'adverts') {
      prev.lines.push({ speaker, text: BREAK_LINES[breakNo++ % BREAK_LINES.length] });
      continue;
    }
    if (prev.kind === 'adverts') {
      seg.lines.unshift({ speaker: seg.presenters[0], text: `Welcome back to ${channel.spokenName}.` });
      continue;
    }
    const written = draft.transitions?.find((t) => t.to === seg.id && prev.presenters.includes(t.speaker));
    const text = written?.text ?? (seg.id === 'match' ? draft.matchHandoff : defaultHandover(f, seg));
    if (text) prev.lines.push({ speaker: written?.speaker ?? speaker, text, link: 'handover' });
  }

  const ids = channel.presenters.map((p) => p.id);
  for (const seg of ordered) for (const l of seg.lines) l.text = stripSpeakerPrefix(l.text, ids);

  const ticker = [
    ...f.pool.slice(0, 8).map((s) => `${s.title} - ${s.sources[0]}`),
    ...(nextLabel ? [`Next: ${nextLabel}`] : []),
  ];

  return {
    version: 1,
    generatedAt: now.toISOString(),
    generatedBy,
    channel: { name: channel.name, club: club.name, colours: club.colours },
    presenters: breaks.length && ADVERTS ? [...channel.presenters, ...ADVERTS.voices] : channel.presenters,
    ticker,
    segments: ordered,
    sidebar: sidebar(f),
    desk: deskSignature(f, draft),
  };
}

const names = (f: Facts, ids: string[]) => spokenList(ids.map((id) => firstName(presenter(f, id))));

/** A plain "still to come" when the AI didn't write one: the debate, Transfer Centre and Fan Zone, if they're on later. */
function defaultComingUp(f: Facts, later: Segment[]): string | undefined {
  const bits = later.flatMap((s) => {
    if (s.kind === 'debate') return [`${names(f, s.presenters)} in The Debate`];
    if (s.kind === 'transfers') return ['the latest from the Transfer Centre'];
    if (s.kind === 'history') return [`${historyHost(f)} with On This Day`];
    if (s.kind === 'fans') return ['what the supporters are saying in the Fan Zone'];
    return [];
  });
  return bits.length ? `Still to come: ${spokenList(bits)}.` : undefined;
}

/** A plain hand-over into a segment when the AI didn't write one. Packages and the opposition focus introduce themselves. */
function defaultHandover(f: Facts, seg: Segment): string | undefined {
  if (seg.kind === 'debate') return `Time for The Debate now, with ${names(f, seg.presenters)}.`;
  if (seg.kind === 'transfers') return `Let's head over to ${names(f, seg.presenters)} in the Transfer Centre.`;
  if (seg.kind === 'fans') return `Now, let's find out what the supporters are saying in the Fan Zone.`;
  if (seg.kind === 'history') return `${historyHost(f)} has been in the museum for us. Over to you, ${historyHost(f)}.`;
  return undefined;
}

/**
 * Next match, last result and the table around us, for the side panel beside presenters in close-up. Building up
 * to (or during) a European or cup group game, the table is that competition's.
 */
export function sidebar(f: Facts): Sidebar {
  const name = (n: string) => teamName(f.club, n);
  const n = f.nextFixtures[0];
  const r = f.lastResult;
  const ct = ['preview', 'live'].includes(f.phase.kind) ? f.competitionTable : undefined;
  const rows = ct?.rows ?? f.table;
  return {
    highlight: f.club.shortName,
    next: n && { date: n.date, home: name(n.home), away: name(n.away), competition: n.competition },
    last: r && { home: name(r.home), away: name(r.away), homeScore: r.homeScore ?? 0, awayScore: r.awayScore ?? 0, competition: r.competition },
    table: rows.length ? rowsAroundUs(f, rows, 5) : undefined,
    tableTitle: ct ? shortCompetition(ct.competition) : undefined,
  };
}

/** The analyst at the touchscreen on the next opponent: their form, then both XIs on a pitch. */
function opponentSegment(f: Facts, d: NonNullable<Draft['opponent']>): Segment | undefined {
  const o = f.opponent;
  if (!o) return undefined;
  const analyst = f.channel.cast.analyst;
  const label = o.confirmed ? 'CONFIRMED XI' : 'LAST XI';
  const lines: Line[] = [
    {
      speaker: analyst,
      text: d.form,
      graphic: { type: 'form', team: o.opponent, results: formOf(o).map(({ against, score, outcome, venue }) => ({ against, score, outcome, venue })) },
    },
  ];
  if (d.headToHead && o.headToHead) lines.push({ speaker: analyst, text: d.headToHead, graphic: headToHeadGraphic(o.headToHead) });
  if (d.theirXI && o.theirXI) {
    lines.push({
      speaker: analyst,
      text: d.theirXI,
      graphic: { type: 'formation', label, team: o.theirXI.team, formation: o.theirXI.formation, rows: o.theirXI.rows, ours: false },
    });
  }
  if (d.ourXI && o.ourXI) {
    lines.push({
      speaker: analyst,
      text: d.ourXI,
      graphic: { type: 'formation', label, team: o.ourXI.team, formation: o.ourXI.formation, rows: o.ourXI.rows, ours: true },
    });
  }
  return {
    id: 'opponent',
    kind: 'opponent',
    title: `Focus on ${o.opponent}`,
    strap: `${teamName(f.club, o.fixture.home)} v ${teamName(f.club, o.fixture.away)}: the opposition`,
    scene: 'touchscreen',
    presenters: [analyst],
    lines,
  };
}

/** The two pundits at the desk; their score predictions (and track records) go full screen at the end. */
function debateSegment(f: Facts, d: Debate): Segment {
  const pundits = f.channel.cast.debate ?? [f.channel.cast.anchors[1], f.channel.cast.transfers];
  const lines: Line[] = d.lines.map((l, i) => ({
    speaker: l.speaker,
    text: l.text,
    graphic: i === 0 ? { type: 'headline', title: d.topic, icon: 'mic' } : undefined,
  }));
  const next = f.nextFixtures[0];
  if (next && d.predictions.length) {
    const graphic: Graphic = {
      type: 'predictions',
      fixture: `${teamName(f.club, next.home)} v ${teamName(f.club, next.away)}`,
      picks: d.predictions.map((p) => {
        const record = f.memory.presenters[p.speaker] && predictionRecord(f.memory.presenters[p.speaker]);
        return { name: firstName(presenter(f, p.speaker)), pick: `${p.homeGoals}-${p.awayGoals}`, record };
      }),
    };
    // The closing calls are where they say their scores.
    for (const l of lines.slice(-2)) l.graphic = graphic;
  }
  return {
    id: 'debate',
    kind: 'debate',
    title: d.topic,
    strap: d.topic,
    scene: 'desk',
    presenters: pundits,
    lines,
  };
}

/** A story covered in depth at the desk: lead anchor plus the right expert, with the quote shown full screen. */
function featureSegment(f: Facts, feat: Feature): Segment | undefined {
  const s = f.features.find((x) => x.id === feat.storyId);
  if (!s) return undefined;
  const lead = f.channel.cast.anchors[0];
  const expert = expertFor(f, s);
  // The lead sometimes turns to the wrong colleague ("Kirsty, …" when Fraser is alongside): use the right name.
  const others = f.channel.presenters.filter((p) => p.id !== expert && p.id !== lead).map(firstName);
  const expertName = firstName(presenter(f, expert));
  const lines: Line[] = feat.lines.map((l, i) => ({
    speaker: l.role === 'lead' ? lead : expert,
    text: l.role === 'lead' ? l.text.replace(new RegExp(`^(${others.join('|')}),`), `${expertName},`) : l.text,
    graphic: i === 0 ? headlineGraphic(s) : undefined,
  }));
  // A match report shows the result card (with scorers) from the expert's first line; the quote goes on the next one.
  const experts = lines.filter((l, i) => i > 0 && l.speaker === expert);
  const r = feat.result;
  if (r) {
    const target = experts.shift() ?? lines[1];
    if (target) {
      target.graphic = {
        type: 'result',
        home: teamName(f.club, r.home),
        away: teamName(f.club, r.away),
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        competition: r.competition ?? 'MATCH REPORT',
        homeScorers: r.homeScorers,
        awayScorers: r.awayScorers,
      };
    }
  }
  if (feat.quote) {
    const target = experts.shift() ?? (r ? undefined : lines[1]);
    if (target) target.graphic = { type: 'quote', text: feat.quote.text, author: feat.quote.by, face: faceFor(feat.quote.by, FACES) };
  }
  return {
    id: `story-${s.id}`,
    kind: 'story',
    title: s.title,
    strap: truncate(s.title, 70),
    scene: 'desk',
    presenters: [lead, expert],
    lines,
  };
}
