# Hearts News 24 — Build Plan

A 24-hour rolling sports news channel for Heart of Midlothian, styled after Sky Sports News: pixel-art presenters,
a studio, a breaking-news ticker and spoken bulletins. Everything is generated automatically from news sites, forums,
podcasts and YouTube. Live at https://jimbodajam.github.io/heartsnews/.

**Work is tracked in [GitHub Issues](https://github.com/jimbodajam/heartsnews/issues)** (labels: `live-match`, `idea`,
`chore`). This file keeps the decisions, the architecture and where things stand.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Public website, built just for fun |
| Budget | As close to £0 as possible |
| Stack | TypeScript end to end (Node pipeline + browser front end) |
| Hosting | GitHub runs the channel and the home PC helps when it's on (#29): the Cloudflare Worker's cron is the clock and queues jobs in D1; the PC (`npm run agent`) claims them for GPU voices, otherwise GitHub Actions builds them. Both publish to gh-pages |
| Scripting | Mixed: templates for the ticker, scores and table; a free-tier LLM writes each segment |
| AI | Free only. Use a provider interface so Gemini, Groq or a later paid Claude key can be swapped in |
| Voices | Real text-to-speech (Kokoro, on the PC's GPU) |
| Art | Pixel art drawn in code, with no sprite files to make by hand |
| Tone | Neutral, straight news, so it extends to every SPFL club |
| Facts | Only what the sources say: no invented quotes, scores or details. Every AI bulletin is fact-checked before voicing |
| Fans | Forum posts are opinion, summarised as mood; never name, quote or identify posters |

## Architecture

```
Worker cron (every minute) queues programmes (:00 and :30) and breaking news → home PC (npm run agent) or GitHub Actions
  └─ pipeline (Node/TS)
       1. collect    → RSS, YouTube feeds + transcripts, Kickback forum, BBC fixtures/results/tables → items[]
       2. stories    → cluster the same story across sources, weight (importance, matchday, fan buzz, freshness)
       3. facts      → matchday phase (normal / preview / live / reaction), opponent focus, in-depth articles
       4. script     → one Gemini request per segment (pieces.ts), then a links pass; templates stand in for any piece that fails
       5. check      → fact-check every line against the sources
       6. voice      → Kokoro per line → audio clips
       7. publish    → site + bulletin → gh-pages
Browser
  └─ Vite + TS + Canvas 2D player: loads bulletin.json and loops it like rolling news
```

The repo stays lean: audio is built during each run and published, not committed to git.

### Sources

| Kind | Source | Method |
|---|---|---|
| Press | BBC Sport, Edinburgh Evening News, Daily Record, Scotsman | RSS, plus article text for the top stories |
| Aggregator | Google News RSS search | RSS. Its links can't be read, so its stories don't get in-depth packages |
| Official | heartsfc.co.uk news | RSS or HTML |
| YouTube | Hearts TV + Hearts Standard | Channel RSS, plus transcripts fetched at home (`npm run snapshot`) |
| Forums | Jambos Kickback | Hot threads and recent posts, from home (it returns 403 to GitHub's servers). Fan Zone only |
| Forums, whole threads | Jambos Kickback | The crawler (`kickback/`, #62) keeps whole threads in D1. The forum's Cloudflare bot check turns away Workers but not a home IP, so the Worker decides (cursor, 2-3s pacing, caps per 5 minutes and per day, any 403/429/503 stops it for a cool-off) and a small loop on the Pi (`tools/pi/`) fetches and reports. Viewer at `/admin?kickback=1` |
| Fixtures/table | BBC Sport team pages (`__INITIAL_DATA__`) | Fixtures, results with scorers, live status, tables, line-ups |

Each collector is isolated. If one fails, it is logged and skipped, and the bulletin still builds. Reddit blocks the
collector. Don't try to get around a site's block.

### Script generation

- **Segment by segment** (`pipeline/src/script/pieces.ts`): headlines, Match Centre, Transfer Centre, each in-depth
  package, Fan Zone and The Debate are separate small requests, each with only the data it needs, three at a time
  (`SCRIPT_CONCURRENCY`). A final "links" request writes "still to come", the hand-overs and the sign-off from what the
  segments actually say. A failed piece gets a second go, then its template stands in on its own.
- **Checks:** `mergeDraft` keeps only well-formed parts that refer to real stories, genuine quotes and scorers that add up.
- **Presenter brains:** personas and leanings in `channel.json`; memory (what aired, takes, predictions, every
  collected item) in the D1 store behind the live Worker (`pipeline/src/store.ts`, schema in `worker/migrations/`).
  Each presenter has a notebook (`pipeline/src/script/notebook.ts`): takes saved against storylines and people, dated
  and with how strongly held, briefed alongside the shared facts. Beats in `channel.json` say who picks up which
  storyline, so the same presenter covers it each time.
- **Gemini quota:** `gemini-flash-latest` (3.8 Flash) allows only 20 free requests a day and a bulletin makes about 13,
  so most bulletins are written by Flash-Lite. Once Flash is out for the day, a run skips it.
- **Club config:** `clubs/hearts.json`. Covering the SPFL later means adding config files, not new code.

### Front end (the "TV")

- Fixed 320×180 canvas scaled up with nearest-neighbour, so it looks pixel-perfect at any size.
- Palette-indexed sprites in TS, maroon and white house colours. Presenters bob, blink and lip-sync from the voice track.
- On screen: channel bug, clock, "LIVE" badge, name straps, ticker, Sky-style side panel, story graphics with pixel
  portraits, Transfer Centre board, Fan Zone sentiment meter, Match Centre tables, pixel-pitch line-ups, ad breaks.
- A "Click to tune in" splash is required, because browsers block audio autoplay.

## Status (22 Oct 2026)

Done: the full pipeline, automation, hybrid hosting, presenter personalities and memory, The Debate with predictions,
matchday phases, opposition focus and line-ups, YouTube transcripts, fact-checking, pixel portraits, ad breaks, the
side panel, segment-by-segment writing.

Next up: **live matchday coverage** (issues #1–#6). A score bug fed by a Cloudflare Worker, then breaking-news cuts to a
pitchside reporter for goals, red cards, kick-off, half-time and full-time, with rebuilds only at HT and FT.
`npm run record` saves a match's BBC data for building and testing against it; the first recording is Trabzonspor v
Hearts on 22 Oct.
