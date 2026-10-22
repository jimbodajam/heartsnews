// Records a match from BBC Sport, to build and test the live matchday features against real data: the match page's
// data (live text, events, line-ups) and the team page's scores, saved every time they change. Starts 15 minutes
// before kick-off and stops 20 minutes after full time.
// Usage: npm run record [-- --every 30]
//   --every N   seconds between polls (default 30)
// Saves to pipeline/out/recordings/<date>-<home>-<away>/: <UTC time>-match.json, <UTC time>-team.json, and the raw
// match page HTML every 10 minutes it changes (to find where BBC loads its live text from, if it isn't in the data).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, collectBbcMatchData, eventsIn, initialData, toFixture } from './collectors/bbc.ts';
import { fetchText } from './http.ts';
import type { ClubConfig } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const every = (Number(args[args.indexOf('--every') + 1]) || 30) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, '');

async function main() {
  const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;
  if (!club.bbc) throw new Error('no bbc config for club');
  const match = await collectBbcMatchData(club);
  const fixture = match.next[0];
  if (!fixture?.link) throw new Error('no upcoming match with a BBC match page');
  const kickOff = Date.parse(fixture.date);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = resolve(ROOT, 'pipeline/out/recordings', `${fixture.date.slice(0, 10)}-${slug(fixture.home)}-${slug(fixture.away)}`);
  await mkdir(dir, { recursive: true });
  console.log(`Recording ${fixture.home} against ${fixture.away} (${fixture.competition}), kick-off ${new Date(kickOff).toLocaleTimeString('en-GB')}`);
  console.log(`  into ${dir}`);

  const start = kickOff - 15 * 60_000;
  if (Date.now() < start) {
    console.log(`Waiting until ${new Date(start).toLocaleTimeString('en-GB')}…`);
    await sleep(start - Date.now());
  }

  const last: Record<string, string> = {};
  let lastHtmlAt = 0;
  let fullTimeAt: number | undefined;
  const hardStop = kickOff + 4 * 3_600_000;
  while (Date.now() < hardStop && !(fullTimeAt && Date.now() - fullTimeAt > 20 * 60_000)) {
    const t = stamp();
    let status = '?';
    try {
      const html = await fetchText(`https://www.bbc.co.uk${fixture.link}`);
      const json = JSON.stringify(initialData(html));
      const hash = createHash('sha1').update(json).digest('hex');
      if (hash !== last.match) {
        last.match = hash;
        await writeFile(resolve(dir, `${t}-match.json`), json);
        if (Date.now() - lastHtmlAt > 10 * 60_000) {
          lastHtmlAt = Date.now();
          await writeFile(resolve(dir, `${t}-match.html`), html);
        }
      }
    } catch (err) {
      console.warn(`  ${t} match page: ${(err as Error).message}`);
    }
    try {
      const data = initialData(await fetchText(`${BASE}/${club.bbc.team}/scores-fixtures`));
      const json = JSON.stringify(data);
      const hash = createHash('sha1').update(json).digest('hex');
      if (hash !== last.team) {
        last.team = hash;
        await writeFile(resolve(dir, `${t}-team.json`), json);
      }
      const now = eventsIn(data).map(toFixture).find((f) => f.date === fixture.date);
      if (now) {
        status = `${now.status} ${now.period ?? ''} ${now.homeScore ?? '-'}-${now.awayScore ?? '-'} ${now.scorers?.map((s) => `${s.player} ${s.minute}`).join(', ') ?? ''}`;
        if (now.status === 'done') fullTimeAt ??= Date.now();
      }
    } catch (err) {
      console.warn(`  ${t} team page: ${(err as Error).message}`);
    }
    console.log(`${t} ${status}`);
    await sleep(every);
  }
  console.log('Recording finished.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
