// Milestone 4: collect → stories → script → bulletin.json → voices. One command makes a whole bulletin.
// Usage: npm run bulletin [-- --cached] [--templates] [--no-voice] [--full]
//   --cached     reuse pipeline/out/ from the last collect instead of fetching again
//   --templates  skip the AI writer even if GEMINI_API_KEY is set
//   --no-voice   don't render Kokoro clips
//   --no-check   skip the fact-check pass
//   --full       always write the whole bulletin. Without it, a slot where nothing has changed since the last
//                programme rewrites only the links between segments (script/quiet.ts, issue #50).
//   --fresh      weigh stories as if nothing had aired yet (no cooldowns), to see the strongest bulletin.
//                Presenters keep their opinions and predictions. Nothing is written to the store.
// Put GEMINI_API_KEY (and optionally GEMINI_MODEL) in a .env file at the repo root, and STORE_TOKEN for the
// channel's memory (store.ts). Without the store a bulletin still builds, with no memory.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, printReport } from './collectors/index.ts';
import { templateDraft } from './script/draft.ts';
import { assemble, sidebar } from './script/assemble.ts';
import type { Bulletin, Line } from '../../shared/bulletin.ts';
import { buildFacts, isUs, matchNews, teamName, type Channel, type Facts } from './script/facts.ts';
import { geminiFromEnv, reportScorers, type ScriptModel } from './script/llm.ts';
import { writeInPieces, writeLinks } from './script/pieces.ts';
import { quietSlot, swapLinks, type NewLinks } from './script/quiet.ts';
import { remember } from './script/remember.ts';
import { factCheck } from './script/factcheck.ts';
import { attachTranscripts, loadTranscripts, TRANSCRIPT_CACHE } from './collectors/transcripts.ts';
import { emptyMemory, freshness, settlePredictions, type Memory } from './memory.ts';
import { storylineStories, type OnAirDesk } from './onair.ts';
import { addOwnText, boostStories, buildStories, fanThreads } from './stories.ts';
import { bigGameFor, detectPhase } from './matchday.ts';
import { collectOnThisDay } from './collectors/londonhearts.ts';
import { countGames, findMilestones, loadTotals, type Milestone } from './tally.ts';
import { collectMeetings } from './collectors/headtohead.ts';
import { headToHead } from './headtohead.ts';
import { seedEntities } from './entities.ts';
import { tagItems } from './tags.ts';
import { loadFaces } from './script/faces.ts';
import { buildLedger, checkBulletin, playedMatches, repeatedViews, type Ledger, type LedgerMatch } from './script/ledger.ts';
import { loadRoster } from './squad.ts';
import { loadMatches, loadMemory, loadOnAir, loadVideoSummaries, saveBuild, saveLedger, saveTrace, scriptOf, storeFromEnv, type CheckLog, type Trace } from './store.ts';
import type { ClubConfig, Item, MatchData } from './types.ts';
import { renderVoices } from './voice.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'pipeline/out');
const BULLETIN = resolve(ROOT, 'site/public/bulletins/latest.json');
/** The programme on air, unpacked from gh-pages before a build (jobs.ts); a local build falls back to its own last one. */
const ON_AIR = resolve(OUT, 'onair/latest.json');

const flags = new Set(process.argv.slice(2));
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  // HEARTSNEWS_NOW pretends it's another time, for testing matchday modes (e.g. 2026-10-22T17:30Z).
  const now = process.env.HEARTSNEWS_NOW ? new Date(process.env.HEARTSNEWS_NOW) : new Date();
  const club = await readJson<ClubConfig>(resolve(ROOT, 'clubs/hearts.json'));
  const channel = await readJson<Channel>(resolve(ROOT, 'channel.json'));

  let items: Item[];
  let match: MatchData | undefined;
  if (flags.has('--cached')) {
    items = await readJson<Item[]>(resolve(OUT, 'items.json'));
    match = existsSync(resolve(OUT, 'match.json')) ? await readJson<MatchData>(resolve(OUT, 'match.json')) : undefined;
    console.log(`Using cached collection: ${items.length} items`);
  } else {
    console.log(`Collecting for ${club.name}…`);
    // In CI the workflow unpacks the `snapshots` branch here (see .github/workflows/bulletin.yml).
    const collection = await collectAll(club, now, resolve(ROOT, 'snapshots'));
    printReport(collection.report);
    ({ items, match } = collection);
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, 'items.json'), JSON.stringify(items, null, 2));
    if (match) await writeFile(resolve(OUT, 'match.json'), JSON.stringify(match, null, 2));
  }

  const transcripts = await loadTranscripts(resolve(ROOT, 'snapshots/transcripts.json'), TRANSCRIPT_CACHE);
  console.log(`Video transcripts: ${attachTranscripts(items, transcripts)} attached (of ${transcripts.length} available)`);

  // Who and what each item is about, so stories group by person (tags.ts).
  const store = storeFromEnv();
  const stored = store
    ? await loadRoster(store).catch((err) => {
        console.warn(`Couldn't read the squad from the store: ${(err as Error).message}`);
        return [];
      })
    : [];
  // On this day in Hearts history (issue #8): today's birthdays and results from London Hearts, fetched once a day.
  const history = await collectOnThisDay(now).catch((err) => {
    console.warn(`Couldn't read London Hearts' page for today: ${(err as Error).message}`);
    return undefined;
  });
  if (history) {
    console.log(`On this day: ${history.birthdays.length} birthdays, ${history.results.length} results (London Hearts)`);
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, 'onthisday.json'), JSON.stringify(history, null, 2));
  }

  // Head to head with the next opponent (issue #34): our record against them, from London Hearts' page for the team.
  if (match?.opponent) {
    const o = match.opponent;
    const meetings = await collectMeetings(o.opponent, now).catch((err) => {
      console.warn(`Couldn't read London Hearts' page for ${o.opponent}: ${(err as Error).message}`);
      return [];
    });
    o.headToHead = headToHead(o.opponent, meetings, isUs(club, o.fixture.home) ? 'home' : 'away');
    if (o.headToHead) console.log(`Head to head v ${o.opponent}: ${o.headToHead.all.won}W ${o.headToHead.all.drawn}D ${o.headToHead.all.lost}L (London Hearts)`);
  }

  const entities = seedEntities(club, match, [stored.length ? stored : loadFaces()]);
  const tags = tagItems(items, entities);
  console.log(`Tagged ${tags.size} items against ${entities.length} people, clubs and competitions`);

  // The store: the storylines the stories come from (onair.ts), what's aired, and what the presenters have said.
  // A pretend time (HEARTSNEWS_NOW) or --fresh reads the store but never writes to it.
  const fresh = flags.has('--fresh');
  const save = store && !fresh && !process.env.HEARTSNEWS_NOW ? store : undefined;
  let memory: Memory = emptyMemory();
  let desk: OnAirDesk | undefined;
  if (store) {
    try {
      [memory, desk] = await Promise.all([loadMemory(store, now), loadOnAir(store, items.map((it) => it.id), now)]);
      console.log(`\nFrom the store: ${desk.storylines.length} storylines, ${desk.airings.size} of them aired; ${memory.aired.length} headline stories aired this week`);
      // A show the ingest has read whole carries its summary, which stands in for the start of its transcript (issue #49).
      const summaries = await loadVideoSummaries(store, items.filter((it) => it.transcript).map((it) => it.id));
      for (const it of items) it.transcriptSummary = summaries.get(it.id);
      if (summaries.size) console.log(`Video summaries: ${summaries.size} from the store`);
    } catch (err) {
      console.warn(`\nCouldn't read the store, building from this collection's headlines: ${(err as Error).message}`);
    }
  } else {
    console.log('\nNo STORE_TOKEN set: building from this collection\'s headlines, with no memory.');
  }
  if (fresh) memory.aired = [];
  // The fact ledger: the past year's results from the store, and this build's feed (issue #32).
  const freshMatches = playedMatches(club, match?.last ?? [], now);
  let storedMatches: LedgerMatch[] = [];
  if (store) {
    try {
      storedMatches = await loadMatches(store, new Date(now.getTime() - 365 * 86_400_000));
    } catch (err) {
      console.warn(`Couldn't read the results from the store, checking against this build's only: ${(err as Error).message}`);
    }
  }

  // Players near a round number of Hearts appearances or goals, by our own count (issue #35).
  let milestones: Milestone[] = [];
  if (store) {
    try {
      // A game that has just finished is counted now, so a milestone reached in it can be said in the reaction.
      if (save) {
        const counted = await countGames(save, club, match?.last ?? [], now);
        for (const g of counted) console.log(`Tally: counted ${g.id} (${g.played} played, ${g.scored} goals)`);
      }
      milestones = findMilestones(await loadTotals(store));
      if (milestones.length) console.log(`Squad milestones: ${milestones.map((m) => `${m.name} ${m.reached ? 'reached' : `${m.to} from`} ${m.mark} ${m.kind}`).join('; ')}`);
    } catch (err) {
      console.warn(`Couldn't read the appearance counts from the store: ${(err as Error).message}`);
    }
  }

  const played = (match?.last ?? []).filter((f) => f.homeScore != null);
  const stories = desk ? storylineStories(desk, { club, items, tags, played, upcoming: match?.next, now, ignoreAirings: fresh }) : buildStories(items, club, now, tags);
  // No article pages are fetched: storylines carry the ingest's stored text, anything else a transcript or summary.
  addOwnText(stories);
  await writeFile(resolve(OUT, 'stories.json'), JSON.stringify(stories.map(({ items: _, ...s }) => s), null, 2));
  console.log(`\nTop stories:`);
  for (const s of stories.slice(0, 8)) console.log(`  ${s.score.toFixed(3)}  ${s.category.padEnd(8)} ${s.title}  [${s.storyline ? `${s.storyline.isNew ? 'new' : 'nothing new'}, ` : 'headlines, '}${s.sources.length} outlets]`);
  if (!save) console.log(`Not writing to the store${fresh ? ' (--fresh: cooldowns cleared)' : process.env.HEARTSNEWS_NOW ? ' (HEARTSNEWS_NOW set)' : ''}.`);
  // A renamed presenter keeps their memory under the new id.
  const renames = channel.presenters.flatMap((p) => (p.formerIds ?? []).map((from) => ({ from, to: p.id })));
  for (const { from, to } of renames) {
    if (memory.presenters[from] && !memory.presenters[to]) memory.presenters[to] = memory.presenters[from];
    delete memory.presenters[from];
  }
  const settled = settlePredictions(memory, (match?.last ?? []).map((f) => ({ ...f, home: teamName(club, f.home), away: teamName(club, f.away) })));
  // Weighting: matchday opponent and Kickback buzz boost a story; a recent airing cools it down for a while. A big
  // game's opponent is boosted more, and from three days out.
  const phase = detectPhase(match, now);
  const big = bigGameFor(club, phase, match?.next ?? [], now, matchNews(stories));
  const fixture = big?.fixture ?? (phase.kind === 'preview' || phase.kind === 'live' ? phase.fixture : phase.kind === 'reaction' ? phase.result : undefined);
  const opponent = fixture && (isUs(club, fixture.home) ? fixture.away : fixture.home);
  const names = opponent ? (club.bigGames?.opponents.find((o) => o.names.includes(opponent))?.names ?? [opponent]) : [];
  if (big) console.log(`\nBig game: ${big.billing} (${teamName(club, big.fixture.home)} against ${teamName(club, big.fixture.away)})`);
  boostStories(stories, { opponent: names, big: Boolean(big), fanThreads: fanThreads(items) });
  for (const s of stories) s.score = Math.round(s.score * freshness(memory, s, now) * 1000) / 1000;
  stories.sort((a, b) => b.score - a.score);
  console.log(`\nWeighted for this bulletin:`);
  for (const s of stories.slice(0, 8)) console.log(`  ${s.score.toFixed(3)}  ${s.title}`);

  const facts = buildFacts(club, channel, stories, items, match, now, memory, history, milestones);
  console.log(`Matchday mode: ${facts.phase.kind}`);
  console.log(`\nIn depth: ${facts.features.map((s) => `${s.title.slice(0, 40)}… (${s.body?.length} chars)`).join('; ') || 'none'}`);
  let draft = templateDraft(facts);
  let writer = 'templates';

  const model = flags.has('--templates') ? undefined : geminiFromEnv();
  // Every model used, for the bulletin's trace (issue #39).
  const used: ScriptModel[] = model ? [model] : [];
  let prompts: Record<string, string> = {};
  let failedPieces: { id: string; error: string }[] = [];
  // Nothing new since the last programme? Then only its links are rewritten (script/quiet.ts).
  const prev = await readJson<Bulletin>(existsSync(ON_AIR) ? ON_AIR : BULLETIN).catch(() => undefined);
  const forced = ['--full', '--fresh', '--templates'].find((x) => flags.has(x)) ?? (model ? undefined : 'no AI writer');
  const quiet = quietSlot(prev, facts, { forced });
  console.log(quiet.partial ? `\nQuiet slot: ${quiet.summary}: partial rewrite (welcome, links, sign-off)` : `\nFull build: ${quiet.reason}`);
  if (quiet.partial) {
    // The last programme's news stands; rewriteLinks below makes the new bulletin from it.
  } else if (model) {
    try {
      console.log(`\nWriting script segment by segment with ${model.name}…`);
      const pieces = await writeInPieces(model, facts, draft);
      // The raw replies, to see what the writer gave before the checks in mergeDraft kept or dropped it.
      await writeFile(resolve(OUT, 'ai-draft.json'), JSON.stringify(pieces.raw, null, 2));
      await writeFile(resolve(OUT, 'ai-prompts.json'), JSON.stringify(pieces.prompts, null, 2));
      await writeFile(resolve(OUT, 'ai-schemas.json'), JSON.stringify(pieces.schemas, null, 2));
      draft = pieces.draft;
      prompts = pieces.prompts;
      failedPieces = pieces.failed;
      writer = pieces.failed.length ? `${model.name}, ${pieces.failed.length} parts from templates` : model.name;
      // Match reports whose card has the score but no scorers: ask for the goals on their own.
      for (const feat of draft.features) {
        const r = feat.result;
        const s = facts.features.find((x) => x.id === feat.storyId);
        if (!r || !s?.body || r.homeScore + r.awayScore === 0 || r.homeScorers?.length || r.awayScorers?.length) continue;
        try {
          feat.result = await reportScorers(model, r, s.title, s.body);
          console.log(`Scorers for ${r.home} ${r.homeScore}-${r.awayScore} ${r.away}: ${[...(feat.result.homeScorers ?? []), ...(feat.result.awayScorers ?? [])].join(', ') || '(none that add up)'}`);
        } catch (err) {
          console.warn(`Couldn't get the scorers for ${s.title}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`AI writer failed, using templates instead: ${(err as Error).message}`);
    }
  } else {
    console.log(`\nWriting script with templates (${flags.has('--templates') ? '--templates' : 'no GEMINI_API_KEY set'}).`);
  }

  const bulletin = quiet.partial && prev ? await rewriteLinks(prev, facts, templateDraft(facts).welcome, used) : assemble(facts, draft, writer);
  const linkLines = quiet.partial ? bulletin.segments.flatMap((seg) => seg.lines.filter((l) => l.link && !l.audio)) : [];

  // Second pass: check every AI-written line against the sources, fixing or dropping what doesn't hold up.
  const checks: CheckLog[] = [];
  const checker = quiet.partial || writer === 'templates' || flags.has('--no-check') ? undefined : geminiFromEnv([150_000, 120_000]);
  if (checker) {
    used.push(checker);
    try {
      console.log(`\nFact-checking with ${checker.name}…`);
      const fc = await factCheck(checker, facts, bulletin);
      console.log(`Checked ${fc.checked} lines: ${fc.fixed.length} fixed, ${fc.dropped.length} dropped`);
      for (const x of fc.fixed) console.log(`  FIXED ${x.line} (${x.reason})\n    was: ${x.was}\n    now: ${x.now}`);
      for (const x of fc.dropped) console.log(`  DROPPED ${x.line} (${x.reason})\n    was: ${x.was}`);
      checks.push(...fc.fixed.map((x) => ({ checker: 'ai' as const, action: 'fixed' as const, ...x })), ...fc.dropped.map((x) => ({ checker: 'ai' as const, action: 'dropped' as const, ...x })));
      bulletin.generatedBy = `${bulletin.generatedBy}, checked by ${checker.name}`;
    } catch (err) {
      console.warn(`Fact-check failed, keeping the script unchecked: ${(err as Error).message}`);
    }
  }

  // Third pass, in code (issue #32): scores, results and scorers against the ledger of every result we know.
  const knownPlayers = [
    ...entities.filter((e) => e.type === 'player').map((e) => e.name),
    ...[match?.opponent?.ourXI, match?.opponent?.theirXI].flatMap((xi) => xi?.rows.flat() ?? []),
  ];
  const ledger = buildLedger(club, storedMatches, freshMatches, knownPlayers,facts.phase.kind === 'live' ? facts.phase.fixture : undefined);
  // And a presenter saying again, near word for word, a view they've already made several times over.
  const lc = quiet.partial ? checkLinks(ledger, bulletin, linkLines, now) : [...checkBulletin(ledger, bulletin, now), ...repeatedViews(facts, bulletin)];
  console.log(`\nLedger check against ${ledger.matches.length} results: ${lc.filter((x) => x.action === 'fixed').length} fixed, ${lc.filter((x) => x.action === 'dropped').length} dropped`);
  for (const x of lc) console.log(`  ${x.action.toUpperCase()} ${x.line} ${x.kind} (${x.reason})\n    was: ${x.was}${x.now ? `\n    now: ${x.now}` : ''}`);
  checks.push(...lc.map(({ line: _, ...x }) => ({ checker: 'ledger' as const, ...x })));
  await writeFile(BULLETIN, `${JSON.stringify(bulletin, null, 2)}\n`);

  if (save) {
    let saved = false;
    try {
      // A partial rewrite airs nothing afresh, so it leaves the cooldowns (and so the running order) alone.
      const remembered = quiet.partial ? { aired: [], takes: [], predictions: [] } : remember(facts, draft);
      await saveBuild(
        save,
        {
          bulletin: { id: bulletin.generatedAt, phase: facts.phase.kind, kind: quiet.partial ? 'partial' : 'full', runner: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'home' },
          items,
          entities,
          tags,
          remembered,
          settled,
          renames,
        },
        now,
      );
      console.log(`\nSaved to the store: ${items.length} items, ${remembered.aired.length} airings, ${remembered.takes.length} takes, ${remembered.predictions.length} predictions, ${settled.length} settled`);
      saved = true;
    } catch (err) {
      console.warn(`\nCouldn't write to the store, so this bulletin isn't remembered: ${(err as Error).message}`);
    }
    try {
      // The fact-check log hangs off the bulletin's row, so it goes only if that was saved.
      await saveLedger(save, freshMatches, saved ? bulletin.generatedAt : undefined, checks, now);
      console.log(`Saved to the ledger: ${freshMatches.length} results${saved ? `, ${checks.length} fact-check changes` : ''}`);
    } catch (err) {
      console.warn(`Couldn't write the results and fact checks to the store: ${(err as Error).message}`);
    }
    if (saved) {
      try {
        // Why the bulletin said what it did (issue #39): the requests, the prompts, the script. A batch of its own, so
        // a store without the trace table yet still remembers the bulletin.
        const trace: Trace = {
          writer: bulletin.generatedBy ?? writer,
          meta: { mode: quiet.partial ? 'partial' : 'full', why: quiet.partial ? quiet.summary : quiet.reason, ...(failedPieces.length ? { failed: failedPieces } : {}) },
          calls: used.flatMap((m) => m.log ?? []),
          prompts,
          script: scriptOf(bulletin),
        };
        await saveTrace(save, bulletin.generatedAt, trace, now);
        console.log(`Saved the trace: ${trace.calls.length} model requests, ${Object.keys(prompts).length} prompts`);
      } catch (err) {
        console.warn(`Couldn't write the bulletin's trace to the store: ${(err as Error).message}`);
      }
    }
  }
  console.log(`\nBulletin written (${bulletin.generatedBy ?? writer}):`);
  for (const seg of bulletin.segments) {
    console.log(`  [${seg.title}]`);
    for (const l of seg.lines) console.log(`    ${l.speaker.padEnd(7)} ${l.text}`);
  }

  if (!flags.has('--no-voice')) {
    console.log('\nRendering voices…');
    await renderVoices(BULLETIN);
  }
}

/** A quiet slot: the last programme with its links reworded (one Flash-Lite request), the ticker and side panel current. */
async function rewriteLinks(prev: Bulletin, facts: Facts, greeting: string, used: ScriptModel[]): Promise<Bulletin> {
  const lite = geminiFromEnv(undefined, ['gemini-flash-lite-latest'])!;
  used.push(lite);
  let links: NewLinks = { welcome: greeting, handovers: [] };
  let how = 'links rewritten';
  try {
    console.log(`\nRewriting the links with ${lite.name}…`);
    links = await writeLinks(lite, facts, prev);
  } catch (err) {
    // Keep the old links, but the welcome still has to be right for the time of day.
    console.warn(`Couldn't rewrite the links, keeping the last programme's: ${(err as Error).message}`);
    how = 'links kept, greeting only';
  }
  const { bulletin } = swapLinks(prev, links);
  bulletin.generatedAt = facts.now.toISOString();
  bulletin.generatedBy = `${lite.name}, quiet slot: ${how}`;
  bulletin.ticker = assemble(facts, templateDraft(facts), 'templates').ticker;
  bulletin.sidebar = sidebar(facts);
  if (bulletin.desk) bulletin.desk.kind = 'partial';
  return bulletin;
}

/** The ledger check on the new link lines alone: a line it fixes is put right, one it drops goes back to its old wording. */
function checkLinks(ledger: Ledger, bulletin: Bulletin, lines: Line[], now: Date) {
  const probe: Bulletin = { ...bulletin, segments: [{ id: 'links', kind: 'headlines', title: 'Links', strap: '', scene: 'desk', presenters: [], lines: lines.map((l) => ({ ...l })) }] };
  const checks = checkBulletin(ledger, probe, now);
  for (const l of lines) {
    const kept = probe.segments[0].lines.find((x) => x.speaker === l.speaker && (x.text === l.text || checks.some((c) => c.was === l.text && c.now === x.text)));
    if (kept) l.text = kept.text;
  }
  return checks;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
