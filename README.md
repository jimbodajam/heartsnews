# Hearts News 24

A rolling 24-hour pixel-art sports news channel for Heart of Midlothian. See [PLAN.md](PLAN.md) for the roadmap.

## Layout

| Path | What |
|---|---|
| `channel.json` | Channel name and cast: who anchors, who runs the Transfer Centre and Match Centre, looks and voices |
| `.env` | `GEMINI_API_KEY` for AI-written scripts (copy `.env.example`). Without it, scripts come from templates |
| `clubs/hearts.json` | Club config: names, colours, keywords, source feeds, TheSportsDB ids |
| `pipeline/` | Node/TS: collects news (`npm run collect`) → `pipeline/out/items.json` + `match.json` |
| `shared/bulletin.ts` | The `bulletin.json` format the pipeline writes and the player reads |
| `shared/live.ts` | The `live.json` match feed format, built from BBC Sport (tested against a recording in `shared/test/`) |
| `site/` | Vite + Canvas player. Plays `site/public/bulletins/latest.json` |
| `worker/` | Cloudflare Worker serving `live.json` during a match: score, clock, goals, red cards, BBC live text |

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
npm test            # live.json parser against the recorded Trabzonspor v Hearts match
npm run record      # record the next match from BBC into pipeline/out/recordings/
npm run trim-recording -- <dir>   # trim a recording into a test fixture in shared/test/fixtures/
npm run worker:deploy             # deploy the live Worker (run `npx wrangler login` in worker/ first)
```

`npm run worker:dev` needs glibc 2.35+, so it won't run on an older WSL distro; deploying works anywhere.

Player URL options: `?segment=match` jumps straight to a segment, and `?bulletin=bulletins/x.json` plays another file.
On a match day the player polls the live Worker and the score and scorers come round in the ticker (gold), flashing
GOAL when the score changes. `?live=off` turns that off, `?live=<url>` reads `live.json` from elsewhere, and in dev
`?live=replay&from=17:15&speed=10` replays the recorded Trabzonspor v Hearts match (`from` is UTC; kick-off 16:45).
Keys: **M** mute, **C** captions, **→** skip, **F** fullscreen.
