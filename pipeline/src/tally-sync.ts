// Our own appearances and goals count (tally.ts, issue #35): `npm run tally` seeds it from London Hearts the first time
// and counts any finished game not yet counted; `-- --reseed` starts again from their list; `-- --audit` compares our
// figures with their latest ones and prints where we've drifted (it changes nothing). The ingest counts games by itself.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, parsePlayerRecords } from './collectors/londonhearts.ts';
import { collectBbcMatchData } from './collectors/bbc.ts';
import { fetchText } from './http.ts';
import { storeFromEnv } from './store.ts';
import { auditTally, countGames, findMilestones, loadPlayers, loadTotals, seedTally } from './tally.ts';
import type { ClubConfig } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('No STORE_TOKEN set: nothing to count into.');
  const flags = new Set(process.argv.slice(2));
  const now = new Date();
  const records = () => fetchText(`${BASE}/newplayers/aaplayersbirth.html`, 60_000).then(parsePlayerRecords);

  if (flags.has('--audit')) {
    const a = await auditTally(store, await records());
    console.log(`London Hearts runs to ${a.upTo}; we seeded at ${a.since} and counted ${a.counted} games since. ${a.checked} players compared.`);
    if (!a.drift.length) console.log('No drift: every total matches.');
    for (const d of a.drift) console.log(`  ${d.name} ${d.field}: we have ${d.ours}, they have ${d.theirs}`);
    return;
  }

  const roster = await loadPlayers(store);
  const seeded = await seedTally(store, await records(), roster, now, flags.has('--reseed'));
  if (seeded) console.log(`Seeded ${seeded.seeded} players from London Hearts, who run to ${seeded.since}. Not on their list: ${seeded.unlisted.join(', ') || '–'}.`);

  const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
  const { last } = await collectBbcMatchData(club, now);
  const counted = await countGames(store, club, last, now);
  for (const g of counted) console.log(`Counted ${g.id}: ${g.played} played, ${g.scored} goals${g.unmatched.length ? `, unmatched: ${g.unmatched.join(', ')}` : ''}`);
  if (!counted.length) console.log('No new games to count.');

  for (const m of findMilestones(await loadTotals(store))) console.log(`  ${m.name}: ${m.total} ${m.kind}, ${m.reached ? `reached ${m.mark}` : `${m.to} from ${m.mark}`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
