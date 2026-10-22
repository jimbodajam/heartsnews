import type { Bulletin, Graphic, IconId, Line, Segment, Sidebar } from '../../../shared/bulletin.ts';
import type { Story, StoryCategory } from '../stories.ts';
import { truncate } from '../text.ts';
import { scorerLabels } from '../matchday.ts';
import { predictionRecord } from '../memory.ts';
import { faceFor, loadFaces } from './faces.ts';
import { formOf } from './opponent.ts';
import type { Debate, Draft, Feature } from './draft.ts';
import { expertFor, firstName, isUs, presenter, teamName, type Facts } from './facts.ts';

const ICON: Record<StoryCategory, IconId> = { transfer: 'contract', injury: 'medical', match: 'ball', news: 'mic' };

const FACES = loadFaces();

/** A story's headline card, with the portrait of whoever it's about when we have one. */
function headlineGraphic(s: Story): Graphic {
  const face = faceFor(s.title, FACES) ?? faceFor(s.summary, FACES);
  return { type: 'headline', title: s.title, source: s.sources[0], icon: ICON[s.category], face };
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
  const headlineLines: Line[] = [{ speaker: a, text: draft.welcome }];
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
    if (draft.table && f.table.length) {
      // The screen fits six rows: show the ones around us rather than always the top six.
      const at = Math.max(0, f.table.findIndex((t) => isUs(club, t.team)));
      const start = Math.min(Math.max(0, at - 2), Math.max(0, f.table.length - 6));
      lines.push({
        speaker: analyst,
        text: draft.table,
        graphic: {
          type: 'table',
          title: 'League Table',
          highlight: club.shortName,
          rows: f.table.slice(start, start + 6).map((t) => ({ pos: t.pos, team: name(t.team), played: t.played, gd: t.gd, pts: t.pts })),
        },
      });
    }
    if (draft.next && f.nextFixtures.length) {
      lines.push({
        speaker: analyst,
        text: draft.next,
        graphic: {
          type: 'fixtures',
          title: f.nextFixtures.length > 1 ? 'Coming Up' : 'Next Match',
          fixtures: f.nextFixtures.map((x) => ({ date: x.date, home: name(x.home), away: name(x.away), competition: x.competition })),
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

  // Fan Zone back at the desk, then the sign-off.
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
      { speaker: a, text: draft.outro },
    ],
  });

  // In-depth packages go between the regular segments, like a rolling news hour:
  // headlines → story → Match Centre → story → Transfer Centre → story → Fan Zone.
  // Up to five packages spread through the hour, so there's always substance between the regular segments.
  const [f1, f2, f3, f4, f5] = draft.features.map((feat) => featureSegment(f, feat)).filter((s): s is Segment => Boolean(s));
  const debate = draft.debate ? debateSegment(f, draft.debate) : undefined;
  const byId = (id: string) => segments.find((s) => s.id === id);
  const opposition = draft.opponent && f.opponent ? opponentSegment(f, draft.opponent) : undefined;
  const ordered = [byId('headlines'), f1, byId('match'), opposition, f2, debate, f3, byId('transfers'), f4, f5, byId('fans')].filter(
    (s): s is Segment => Boolean(s),
  );

  // Whoever is on air just before the Match Centre hands over to it.
  const matchAt = ordered.findIndex((s) => s.id === 'match');
  if (matchAt > 0) ordered[matchAt - 1].lines.push({ speaker: a, text: draft.matchHandoff });

  const ticker = [
    ...f.pool.slice(0, 8).map((s) => `${s.title} - ${s.sources[0]}`),
    ...(nextLabel ? [`Next: ${nextLabel}`] : []),
  ];

  return {
    version: 1,
    generatedAt: now.toISOString(),
    generatedBy,
    channel: { name: channel.name, club: club.name, colours: club.colours },
    presenters: channel.presenters,
    ticker,
    segments: ordered,
    sidebar: sidebar(f),
  };
}

/** Next match, last result and the table around us, for the side panel beside presenters in close-up. */
function sidebar(f: Facts): Sidebar {
  const name = (n: string) => teamName(f.club, n);
  const n = f.nextFixtures[0];
  const r = f.lastResult;
  const at = Math.max(0, f.table.findIndex((t) => isUs(f.club, t.team)));
  const start = Math.min(Math.max(0, at - 2), Math.max(0, f.table.length - 5));
  return {
    highlight: f.club.shortName,
    next: n && { date: n.date, home: name(n.home), away: name(n.away), competition: n.competition },
    last: r && { home: name(r.home), away: name(r.away), homeScore: r.homeScore ?? 0, awayScore: r.awayScore ?? 0, competition: r.competition },
    table: f.table.length
      ? f.table.slice(start, start + 5).map((t) => ({ pos: t.pos, team: name(t.team), played: t.played, gd: t.gd, pts: t.pts }))
      : undefined,
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
  const lines: Line[] = feat.lines.map((l, i) => ({
    speaker: l.role === 'lead' ? lead : expert,
    text: l.text,
    graphic: i === 0 ? headlineGraphic(s) : undefined,
  }));
  if (feat.quote) {
    const target = lines.find((l, i) => i > 0 && l.speaker === expert) ?? lines[1];
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
