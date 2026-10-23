# Hearts News 24

A rolling 24-hour pixel-art sports news channel for Heart of Midlothian. See [PLAN.md](PLAN.md) for the roadmap.

## Layout

| Path | What |
|---|---|
| `channel.json` | Channel name and cast: who anchors, who runs the Transfer Centre and Match Centre, looks and voices |
| `.env` | `GEMINI_API_KEY` for AI-written scripts (copy `.env.example`). Without it, scripts come from templates. `STORE_TOKEN` for the channel's memory |
| `clubs/hearts.json` | Club config: names, colours, keywords, source feeds, TheSportsDB ids |
| `pipeline/` | Node/TS: collects news (`npm run collect`) → `pipeline/out/items.json` + `match.json` |
| `shared/bulletin.ts` | The `bulletin.json` format the pipeline writes and the player reads |
| `shared/live.ts` | The `live.json` match feed format, built from BBC Sport (tested against a recording in `shared/test/`) |
| `shared/breaking.ts` | The `breaking.json` format: goal and red card break-ins, written by `pipeline/src/breaking/` |
| `site/` | Vite + Canvas player. Plays `site/public/bulletins/latest.json` |
| `worker/` | Cloudflare Worker serving `live.json` during a match: score, clock, goals, red cards, BBC live text. Also `/store`, the channel's memory in D1 |

## Commands (run inside WSL)

```bash
npm install
npm run bulletin    # collect → stories → script → latest.json → voices (the whole thing)
                    #   flags: --cached (reuse last collect), --templates (no AI), --no-voice
npm run snapshot    # collect the Kickback from home and publish it for the online build
npm run pronounce   # hear every pronunciations.json entry before/after: /voice-samples/pronunciations/
npm run collect     # scrape all sources for Hearts
npm run voice       # render each bulletin line with its presenter's Kokoro voice (first run downloads ~330MB model)
npm run dev         # player at http://localhost:5173
npm run build       # static site → site/dist
npm run typecheck
npm test            # live.json parser, Worker and breaking news against the recorded Trabzonspor v Hearts match
npm run agent       # the home PC's part: claims programmes and breaking news from the queue for GPU voices, and snapshots
npm run job         # make a programme now, outside the queue (`-- --id <job id>` runs a queued job, as GitHub does)
npm run replay -- [--from 17:15] [--speed 20] [--recording <dir>] [--ai]   # replay a match through the Worker and breaking news
npm run replay -- --queue [--from 17:15] [--speed 20]   # the same match as test jobs built on GitHub, with timings
npm run breaking -- --replay [--from 17:15] [--speed 20]   # breaking news alone from the recorded match
npm run record      # record the next match from BBC into pipeline/out/recordings/
npm run trim-recording -- <dir>   # trim a recording into a test fixture in shared/test/fixtures/
npm run worker:deploy             # deploy the live Worker (run `npx wrangler login` in worker/ first)
```

`npm run worker:dev` needs glibc 2.35+, so it won't run on an older WSL distro; deploying works anywhere.

### The store (channel memory)

Every build reads the channel's memory from Cloudflare D1 at the start (what aired this week, each presenter's takes
and predictions) and writes what's new at the end in one transaction: the collected items, the bulletin, airings,
takes, predictions and the squad, clubs and competitions. The pipeline reaches it through the Worker's `/store`
endpoint with a bearer token; all its SQL is in `pipeline/src/store.ts`. If the store can't be reached the bulletin
still builds, without memory. `--fresh` and `HEARTSNEWS_NOW` builds read but never write.

Setting it up (owner, once, from `worker/` after `npx wrangler login`):

1. `npx wrangler d1 create heartsnews`, and paste the `database_id` it prints into `worker/wrangler.toml`.
2. `npx wrangler d1 migrations apply heartsnews --remote` (and again whenever `worker/migrations/` gains a file).
3. `npx wrangler secret put STORE_TOKEN` with a long random token, then `npm run worker:deploy`.
4. Add the same token as `STORE_TOKEN` to the GitHub Actions secrets and to `.env` on the home PC.
5. `npm run store:import` copies the old `memory.json` from the live site. Do this before the first build that uses
   the store publishes, as builds no longer write `memory.json`.

D1's Time Travel restores the database to any minute in the last 7 days on the free plan, 30 on paid
(`npx wrangler d1 time-travel restore heartsnews --timestamp <ISO time>`).

### Running the channel

GitHub runs the channel and the home PC helps when it's on. The live Worker is the clock: a cron trigger every minute
(`worker/src/clock.ts`) queues a job in D1 for each programme that's due (on :00 and :30, none while our match is on,
one straight after half-time and full time) and each breaking package (goals, red cards, kick-offs, half-time, full
time). When the PC has checked in within the last 90 seconds it gets first refusal: `npm run agent` claims jobs every
30 seconds and builds them with GPU voices. Otherwise, or if it hasn't claimed a job within a minute (breaking) or two
(programme), the Worker runs the `Bulletin` workflow with the job's id, and GitHub builds it with Kokoro on the CPU.
A job is claimed once, so only one runner publishes it, and the two take turns to publish through a lock in the store.
Every publish starts from what's on gh-pages, so a programme keeps the breaking news and a package keeps the programme.
A runner that goes quiet mid-job (the PC switched off) loses it after 10 minutes (breaking) or 40 (programme) and it's
queued again; stopping the agent with Ctrl+C hands its jobs straight back.

Setting it up (owner, once):

1. `npx wrangler d1 migrations apply heartsnews --remote` from `worker/` (adds the queue).
2. A fine-grained GitHub token for this repo only, with **Actions: read and write**, then
   `npx wrangler secret put GITHUB_DISPATCH_TOKEN` and `npm run worker:deploy` (which adds the cron trigger).
3. On the home PC, run `npm run agent` instead of `npm run live` whenever it's on.

To see how quickly GitHub gets breaking news out, `npm run replay -- --queue` runs the clock against the recorded match
from the PC, queueing test jobs (plain lines) that only GitHub takes. GitHub builds and voices each but never publishes
it, and at the end the replay prints how long each job took from being queued to being built.

Player URL options: `?segment=match` jumps straight to a segment, and `?bulletin=bulletins/x.json` plays another file.
On a match day the player polls the live Worker and the score and scorers come round in the ticker (gold), flashing
GOAL when the score changes. `?live=off` turns that off, `?live=<url>` reads `live.json` from elsewhere (add `&speed=N` for
a replay), and in dev `?live=replay&from=17:15&speed=10` replays the recorded Trabzonspor v Hearts match in the page
alone (`from` is UTC; kick-off 16:45).

Breaking news: for each goal and red card (either side), the Worker's clock waits up to 2 minutes for BBC's live text
description and queues a job; the runner that takes it has Gemini Flash-Lite write Gregor's line from it (plain
scorer, minute and score if there's no description or the line fails its checks), voices it and publishes
`breaking/breaking.json` with the clips. The player
polls it during the match and, after the current line, breaks in: BREAKING NEWS flash and sting, the anchor hands over,
Gregor at the ground with the score card, then back to the programme.

To watch a whole match locally, run `npm run replay -- --from 17:15` alongside `npm run dev` and open the player address
it prints. It serves `live.json` on port 8788 from the Worker's own code (`worker/src/feed.ts`), reading the recording on
a sped-up clock, and runs the breaking-news watcher against it (plain lines unless `--ai`; written to
`site/public/breaking`, never published), so the score bug and break-ins follow one timeline. It replays the committed
fixture by default, or a full recording from `pipeline/out/recordings/` with `--recording <dir>`.
Keys: **M** mute, **C** captions, **→** skip, **F** fullscreen.
