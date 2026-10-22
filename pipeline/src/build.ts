// Milestone 4: collect → stories → script → bulletin.json → voices. One command makes a whole bulletin.
// Usage: npm run bulletin [-- --cached] [--templates] [--no-voice]
//   --cached     reuse pipeline/out/ from the last collect instead of fetching again
//   --templates  skip the AI writer even if GEMINI_API_KEY is set
//   --no-voice   don't render Kokoro clips
// Put GEMINI_API_KEY (and optionally GEMINI_MODEL) in a .env file at the repo root.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, printReport } from './collectors/index.ts';
import { templateDraft } from './script/draft.ts';
import { assemble } from './script/assemble.ts';
import { buildFacts, FEATURE_CANDIDATES, teamName, type Channel } from './script/facts.ts';
import { geminiFromEnv, mergeDraft, writeWithModel } from './script/llm.ts';
import { remember } from './script/remember.ts';
import { fetchArticleText } from './collectors/article.ts';
import { attachTranscripts, loadTranscripts, TRANSCRIPT_CACHE } from './collectors/transcripts.ts';
import { freshness, loadMemory, settlePredictions, trimMemory } from './memory.ts';
import { addBodies, buildStories } from './stories.ts';
import type { ClubConfig, Item, MatchData } from './types.ts';
import { renderVoices } from './voice.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'pipeline/out');
const BULLETIN = resolve(ROOT, 'site/public/bulletins/latest.json');
// Deployed with the site; the next build reads it back from channel.siteUrl.
const MEMORY = resolve(ROOT, 'site/public/memory.json');

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

  const stories = buildStories(items, club, now);
  await writeFile(resolve(OUT, 'stories.json'), JSON.stringify(stories.map(({ items: _, ...s }) => s), null, 2));
  console.log(`\nTop stories:`);
  for (const s of stories.slice(0, 8)) console.log(`  ${s.score.toFixed(3)}  ${s.category.padEnd(8)} ${s.title}  [${s.sources.length} outlets]`);

  // Memory: move on from stories already on air, and settle any predictions whose result is now in.
  const { memory, from } = await loadMemory(channel.siteUrl && new URL('memory.json', channel.siteUrl).href, MEMORY);
  console.log(`\nMemory from ${from}: ${memory.aired.length} aired stories`);
  // A renamed presenter keeps their memory under the new id.
  for (const p of channel.presenters) {
    for (const old of p.formerIds ?? []) {
      if (memory.presenters[old] && !memory.presenters[p.id]) memory.presenters[p.id] = memory.presenters[old];
      delete memory.presenters[old];
    }
  }
  settlePredictions(memory, (match?.last ?? []).map((f) => ({ ...f, home: teamName(club, f.home), away: teamName(club, f.away) })));
  for (const s of stories) s.score = Math.round(s.score * freshness(memory, s) * 1000) / 1000;
  stories.sort((a, b) => b.score - a.score);

  await addBodies(stories.slice(0, FEATURE_CANDIDATES), (url) => fetchArticleText(url));
  const facts = buildFacts(club, channel, stories, items, match, now, memory);
  console.log(`Matchday mode: ${facts.phase.kind}`);
  console.log(`\nIn depth: ${facts.features.map((s) => `${s.title.slice(0, 40)}… (${s.body?.length} chars)`).join('; ') || 'none'}`);
  let draft = templateDraft(facts);
  let writer = 'templates';

  const model = flags.has('--templates') ? undefined : geminiFromEnv();
  if (model) {
    try {
      console.log(`\nWriting script with ${model.name}…`);
      draft = mergeDraft(draft, await writeWithModel(model, facts), facts);
      writer = model.name;
    } catch (err) {
      console.warn(`AI writer failed, using templates instead: ${(err as Error).message}`);
    }
  } else {
    console.log(`\nWriting script with templates (${flags.has('--templates') ? '--templates' : 'no GEMINI_API_KEY set'}).`);
  }

  const bulletin = assemble(facts, draft, writer);
  await writeFile(BULLETIN, `${JSON.stringify(bulletin, null, 2)}\n`);

  remember(facts, draft);
  trimMemory(memory, now);
  await writeFile(MEMORY, `${JSON.stringify(memory, null, 2)}\n`);
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
