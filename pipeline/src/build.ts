// Milestone 4: collect → stories → script → bulletin.json → voices. One command makes a whole bulletin.
// Usage: npm run bulletin [-- --cached] [--templates] [--no-voice]
//   --cached     reuse pipeline/out/ from the last collect instead of fetching again
//   --templates  skip the AI writer even if GEMINI_API_KEY is set
//   --no-voice   don't render Kokoro clips
//   --no-check   skip the fact-check pass
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
import { assemble } from './script/assemble.ts';
import { buildFacts, FEATURE_CANDIDATES, FEATURE_COUNT, FEATURE_MAX_SCAN, isUs, MIN_BODY, teamName, type Channel } from './script/facts.ts';
import { geminiFromEnv, reportScorers } from './script/llm.ts';
import { writeInPieces } from './script/pieces.ts';
import { remember } from './script/remember.ts';
import { factCheck } from './script/factcheck.ts';
import { fetchArticleText } from './collectors/article.ts';
import { attachTranscripts, loadTranscripts, TRANSCRIPT_CACHE } from './collectors/transcripts.ts';
import { emptyMemory, freshness, settlePredictions, type Memory } from './memory.ts';
import { addBodies, boostStories, buildStories, fanThreads } from './stories.ts';
import { detectPhase } from './matchday.ts';
import { collectPlayers } from './collectors/sportsdb.ts';
import { seedEntities } from './entities.ts';
import { tagItems } from './tags.ts';
import { loadFaces } from './script/faces.ts';
import { loadMemory, saveBuild, storeFromEnv } from './store.ts';
import type { ClubConfig, Item, MatchData } from './types.ts';
import { renderVoices } from './voice.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'pipeline/out');
const BULLETIN = resolve(ROOT, 'site/public/bulletins/latest.json');

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
  const players = await collectPlayers(club).catch((err) => {
    console.warn(`Couldn't read the squad from SportsDB: ${(err as Error).message}`);
    return [];
  });
  const entities = seedEntities(club, match, [loadFaces(), players]);
  const tags = tagItems(items, entities);
  console.log(`Tagged ${tags.size} items against ${entities.length} people, clubs and competitions`);

  const stories = buildStories(items, club, now, tags);
  await writeFile(resolve(OUT, 'stories.json'), JSON.stringify(stories.map(({ items: _, ...s }) => s), null, 2));
  console.log(`\nTop stories:`);
  for (const s of stories.slice(0, 8)) console.log(`  ${s.score.toFixed(3)}  ${s.category.padEnd(8)} ${s.title}  [${s.sources.length} outlets]`);

  // Memory: move on from stories already on air, and settle any predictions whose result is now in.
  // A pretend time (HEARTSNEWS_NOW) or --fresh reads the store but never writes to it.
  const fresh = flags.has('--fresh');
  const store = storeFromEnv();
  const save = store && !fresh && !process.env.HEARTSNEWS_NOW ? store : undefined;
  let memory: Memory = emptyMemory();
  if (store) {
    try {
      memory = await loadMemory(store, now);
      console.log(`\nMemory from the store: ${memory.aired.length} stories aired this week`);
    } catch (err) {
      console.warn(`\nCouldn't read the store, building without memory: ${(err as Error).message}`);
    }
  } else {
    console.log('\nNo STORE_TOKEN set: building without memory.');
  }
  if (fresh) memory.aired = [];
  if (!save) console.log(`Not writing to the store${fresh ? ' (--fresh: cooldowns cleared)' : process.env.HEARTSNEWS_NOW ? ' (HEARTSNEWS_NOW set)' : ''}.`);
  // A renamed presenter keeps their memory under the new id.
  const renames = channel.presenters.flatMap((p) => (p.formerIds ?? []).map((from) => ({ from, to: p.id })));
  for (const { from, to } of renames) {
    if (memory.presenters[from] && !memory.presenters[to]) memory.presenters[to] = memory.presenters[from];
    delete memory.presenters[from];
  }
  const settled = settlePredictions(memory, (match?.last ?? []).map((f) => ({ ...f, home: teamName(club, f.home), away: teamName(club, f.away) })));
  // Weighting: matchday opponent and Kickback buzz boost a story; a recent airing cools it down for a while.
  const phase = detectPhase(match, now);
  const fixture = phase.kind === 'preview' || phase.kind === 'live' ? phase.fixture : phase.kind === 'reaction' ? phase.result : undefined;
  const opponent = fixture && (isUs(club, fixture.home) ? fixture.away : fixture.home);
  boostStories(stories, { opponent, fanThreads: fanThreads(items) });
  for (const s of stories) s.score = Math.round(s.score * freshness(memory, s, now) * 1000) / 1000;
  stories.sort((a, b) => b.score - a.score);
  console.log(`\nWeighted for this bulletin:`);
  for (const s of stories.slice(0, 8)) console.log(`  ${s.score.toFixed(3)}  ${s.title}`);

  await addBodies(stories.slice(0, FEATURE_CANDIDATES), (url) => fetchArticleText(url));
  // Not enough readable articles yet? Keep going down the order, a few at a time, until there are.
  const readable = () => stories.slice(0, FEATURE_MAX_SCAN).filter((s) => (s.body?.length ?? 0) >= MIN_BODY).length;
  for (let i = FEATURE_CANDIDATES; i < FEATURE_MAX_SCAN && readable() < FEATURE_COUNT; i += 6) {
    await addBodies(stories.slice(i, Math.min(i + 6, FEATURE_MAX_SCAN)), (url) => fetchArticleText(url));
  }
  const facts = buildFacts(club, channel, stories, items, match, now, memory);
  console.log(`Matchday mode: ${facts.phase.kind}`);
  console.log(`\nIn depth: ${facts.features.map((s) => `${s.title.slice(0, 40)}… (${s.body?.length} chars)`).join('; ') || 'none'}`);
  let draft = templateDraft(facts);
  let writer = 'templates';

  const model = flags.has('--templates') ? undefined : geminiFromEnv();
  if (model) {
    try {
      console.log(`\nWriting script segment by segment with ${model.name}…`);
      const pieces = await writeInPieces(model, facts, draft);
      // The raw replies, to see what the writer gave before the checks in mergeDraft kept or dropped it.
      await writeFile(resolve(OUT, 'ai-draft.json'), JSON.stringify(pieces.raw, null, 2));
      draft = pieces.draft;
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

  const bulletin = assemble(facts, draft, writer);

  // Second pass: check every AI-written line against the sources, fixing or dropping what doesn't hold up.
  const checker = writer === 'templates' || flags.has('--no-check') ? undefined : geminiFromEnv([150_000, 120_000]);
  if (checker) {
    try {
      console.log(`\nFact-checking with ${checker.name}…`);
      const fc = await factCheck(checker, facts, bulletin);
      console.log(`Checked ${fc.checked} lines: ${fc.fixed.length} fixed, ${fc.dropped.length} dropped`);
      for (const x of fc.fixed) console.log(`  FIXED ${x.line} (${x.reason})\n    was: ${x.was}\n    now: ${x.now}`);
      for (const x of fc.dropped) console.log(`  DROPPED ${x.line} (${x.reason})\n    was: ${x.was}`);
      bulletin.generatedBy = `${bulletin.generatedBy}, checked by ${checker.name}`;
    } catch (err) {
      console.warn(`Fact-check failed, keeping the script unchecked: ${(err as Error).message}`);
    }
  }
  await writeFile(BULLETIN, `${JSON.stringify(bulletin, null, 2)}\n`);

  if (save) {
    try {
      const bodies = new Map(stories.flatMap((s) => (s.articles ?? []).flatMap((a) => (a.item ? [[a.item, a.text] as const] : []))));
      const remembered = remember(facts, draft);
      await saveBuild(
        save,
        {
          bulletin: { id: bulletin.generatedAt, phase: facts.phase.kind, runner: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'home' },
          items,
          bodies,
          entities,
          tags,
          remembered,
          settled,
          renames,
        },
        now,
      );
      console.log(`\nSaved to the store: ${items.length} items, ${remembered.aired.length} airings, ${remembered.takes.length} takes, ${remembered.predictions.length} predictions, ${settled.length} settled`);
    } catch (err) {
      console.warn(`\nCouldn't write to the store, so this bulletin isn't remembered: ${(err as Error).message}`);
    }
  }
  console.log(`\nBulletin written (${writer}):`);
  for (const seg of bulletin.segments) {
    console.log(`  [${seg.title}]`);
    for (const l of seg.lines) console.log(`    ${l.speaker.padEnd(7)} ${l.text}`);
  }

  if (!flags.has('--no-voice')) {
    console.log('\nRendering voices…');
    await renderVoices(BULLETIN);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
