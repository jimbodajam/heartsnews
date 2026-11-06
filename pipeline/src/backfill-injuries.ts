import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ollama } from './backfill-articles.ts';
import { clubOutlets, type Injury } from './injuries.ts';
import { BRIEF_SCHEMA, briefPrompt, injuryLog, injuryRows, loadInjuryDesk, parseBriefs } from './storylines.ts';
import { injuryWrites, loadInjuryStorylines, storeFromEnv } from './store.ts';
import type { ClubConfig } from './types.ts';

// Issue #107's one-off backfill: the injury rows for every injury storyline this season, closed ones included, read on
// a local Ollama model with the same request the ingest uses for briefs (only the injuries are kept; the briefs stay as
// they are). From then on the ingest fills them as it writes briefs. Run at home, once:
//   npx tsx src/backfill-injuries.ts [--model qwen3:14b] [--storyline 17] [--write]
// Without --write it only prints the rows. Needs STORE_TOKEN (in .env) and Ollama running (OLLAMA_HOST).

const ROOT = resolve(import.meta.dirname, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('No STORE_TOKEN set.');
  const club = JSON.parse(readFileSync(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
  const model = ollama(arg('model') ?? 'qwen3:14b');
  const write = process.argv.includes('--write');
  const only = arg('storyline');
  const now = new Date();

  const storylines = (await loadInjuryStorylines(store)).filter((s) => !only || s.id === Number(only));
  const desk = await loadInjuryDesk(store, storylines);
  if (!desk) return console.log('No injury storylines about a player.');
  const fan = club.sources.filter((s) => s.fan);
  const ctx = { clubOutlets: clubOutlets(club), shows: new Set(fan.map((s) => s.id)) };
  const names = new Map(club.sources.map((s) => [s.id, s.name.replace(/ \(.*\)$/, '')]));
  console.log(`${storylines.length} injury storylines; line-ups for ${desk.lineUps.games.length} games since ${desk.lineUps.since}.`);

  const rows: Injury[] = [];
  for (const s of storylines) {
    const started = Date.now();
    try {
      // No people list: it only steers the brief's wording, which isn't kept here.
      const reply = (await model.generateJson(briefPrompt([s], names, [], now, desk.notes), BRIEF_SCHEMA)) as object;
      const [brief] = parseBriefs(reply, [s]);
      const got = injuryRows(s, brief?.injuries ?? [], desk.existing.get(s.id) ?? [], desk.lineUps, ctx, now);
      console.log(`s${s.id} ${s.title} (${s.status}, ${s.claims.length} claims, ${Math.round((Date.now() - started) / 1000)}s):`);
      for (const c of s.claims) console.log(`    c${c.id} ${c.firstSeen.slice(0, 10)} ${c.status}: ${c.text}`);
      if (!got.length) console.log(`  no injury rows: ${JSON.stringify(reply).slice(0, 300)}`);
      for (const i of got) console.log(`  ${injuryLog(i)}`);
      rows.push(...got);
    } catch (err) {
      console.log(`s${s.id} ${s.title}: failed (${(err as Error).message})`);
    }
  }
  if (!write) return console.log(`\n${rows.length} rows; not written (pass --write).`);
  if (rows.length) await store.batch(injuryWrites(rows, now));
  console.log(`\nWrote ${rows.length} injury rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
