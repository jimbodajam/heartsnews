# Hearts News 24 — Build Plan

A 24-hour rolling sports news channel for Heart of Midlothian, styled after Sky Sports News: pixel-art presenters,
a studio, a breaking-news ticker and spoken bulletins. Everything is generated automatically from news sites, forums,
podcasts and YouTube.

## Decisions (from the interview)

| Topic | Decision |
|---|---|
| Audience | Public website, built just for fun |
| Budget | As close to £0 as possible |
| Stack | TypeScript end to end (Node pipeline + browser front end) |
| Hosting | A scheduled GitHub Actions job builds each bulletin; GitHub Pages serves the site |
| Scripting | Mixed: templates for the ticker, scores and table; a free-tier LLM for presenter links and analysis |
| AI | Free only. Use a provider interface so Gemini, Groq or a later paid Claude key can be swapped in |
| Voices | Real text-to-speech |
| Art | Pixel art drawn in code, with no sprite files to make by hand |
| Tone | Neutral, straight news, so it extends to every SPFL club |
| Segments | Headlines + ticker, Transfer Centre, Fan Reaction, Match Centre |
| Freshness | Version 1 is one generated bulletin. Later: scheduled bulletins, then a live matchday mode |

## Architecture

```
GitHub Actions (cron)
  └─ pipeline (Node/TS)
       1. collect    → RSS, YouTube feeds, forums, fixtures/table  → items[]
       2. normalise  → {source, kind, title, summary, url, publishedAt, engagement}
       3. cluster    → merge the same story found in several sources, then rank by recency × source count × engagement
       4. classify   → headline | transfer | fan | match  (keyword rules first, LLM as tie-breaker)
       5. script     → templates + LLM → bulletin.json (timeline of segments, lines, speakers, graphics cues)
       6. voice      → Piper TTS per line → .mp3 + durations
       7. publish    → site/dist + bulletin → GitHub Pages
Browser
  └─ Vite + TS + Canvas 2D player: loads bulletin.json and loops it like rolling news
```

The repo stays lean: audio is built during each run and deployed as the Pages artifact, not committed to git.

### Sources (RSS first: free, stable, and rarely blocked)

| Kind | Source | Method |
|---|---|---|
| Press | BBC Sport Hearts team feed, Edinburgh Evening News, Daily Record, Scotsman | RSS |
| Aggregator | Google News RSS search (`"Heart of Midlothian" OR "Hearts FC"`) | RSS. It catches what the other feeds miss |
| Official | heartsfc.co.uk news | RSS if available, otherwise HTML scrape |
| YouTube | Hearts TV + fan channels | Channel RSS (`/feeds/videos.xml?channel_id=`), no API key. Titles and descriptions only in v1 |
| Podcasts | Fan podcasts | Podcast RSS: episode titles and show notes |
| Forums | Jambos Kickback, r/HeartsFC, others | Scrape hot thread titles, reply counts and the first few posts. Fan Reaction only, never quoted as fact |
| Fixtures/table | API-Football free tier (covers the Scottish Premiership) or a BBC scrape | JSON |

Each collector is isolated. If one fails, it is logged and skipped, and the bulletin still builds.

**Known risks:** YouTube transcripts, Reddit and some forums often block requests from GitHub's datacenter IPs.
Mitigation: v1 uses only feeds and titles, and transcripts are a later experiment.

### Script generation

- **Templates (deterministic, free):** ticker lines, scores, fixtures, league table reads, "coming up" stings, segment intros.
- **LLM (free tier, e.g. Gemini Flash or Groq):** the anchor's headline reads, Transfer Centre roundup, Fan Reaction summary
  ("Supporters online are divided over…"). The prompt sends only clustered facts plus source names, and the output must match
  a JSON schema.
- **Fallback:** if the LLM fails or its quota runs out, templates produce a plainer bulletin. The channel never goes off air.
- **Club config:** `clubs/hearts.json` (names, colours, nicknames, feed URLs, keywords). Covering the SPFL later means
  adding more config files, not new code.

### Voice

- **Kokoro** (82M open model) runs on the CPU through `kokoro-js` in Node, so there's no Python and no cost.
  `npm run voice` renders each line to `bulletins/audio/<hash>.mp3`, and lines that haven't changed are reused.
  Each presenter sets a Kokoro voice in `presenter.tts.voice` (Isla `bf_emma`, Fraser `bm_george`, Ally `bm_lewis`,
  Kirsty `bf_isabella`). Piper and edge-tts were compared on 21 Oct, and Kokoro was chosen.
- The browser's `speechSynthesis` is the fallback when a clip is missing (e.g. a fresh clone before `npm run voice`).

### Front end (the "TV")

- Fixed 320×180 canvas scaled up with nearest-neighbour, so it looks pixel-perfect at any size.
- Sprites are defined as palette-indexed pixel arrays in TS, with maroon and white as the house colours. Presenters have idle bob,
  blinks and mouth frames. The Web Audio `AnalyserNode` on the voice track drives the mouth, so lip sync is free.
- Persistent on-screen elements: channel bug, clock, "LIVE" badge, lower-third name straps, scrolling ticker.
- Graphics per segment: headline cards, Transfer Centre board (rumour / medical / done deal), Fan Reaction sentiment
  meter + thread titles, Match Centre fixtures/results/table.
- A "Click to tune in" splash is required, because browsers block audio autoplay.
- Cast (neutral): anchor desk pair, a Transfer Centre reporter, a Match Centre analyst at a touchscreen.

## Milestones

**Status (21 Oct 2026):** 1–6 are done. It's live at https://jimbodajam.github.io/heartsnews/, rebuilt by
`.github/workflows/bulletin.yml` every 3 hours (at :17), on every push to main, and on demand. A run takes about 2 minutes.
The Kickback returns HTTP 403 to GitHub's servers (it works from home), so Fan Zone is thin in CI. Options: a self-hosted
runner on the home PC, or asking the forum for access. Don't try to get around the block. `npm run bulletin` builds a real bulletin end to end, scripted by Gemini's free tier.
If Flash is busy (frequent 503s), it retries and then falls back to Flash-Lite; if all else fails, templates take over.
The writer sits behind `ScriptModel`, so moving to Claude (about 1–2p per bulletin with Haiku) is a small change. Sources added:
Hearts Standard (YouTube) and the Kickback's Terrace board (hot threads plus their latest posts).
Known gaps: Reddit blocks the collector (429s and empty feeds), and TheSportsDB's free key returns one event per call
plus the top 5 of the table. Template mode can't tell a Hearts transfer from another club's, so the AI writer filters those.

1. **Scaffold:** git repo, pnpm workspace (`pipeline/`, `site/`, `clubs/`), TS config, GitHub repo.
2. **Collectors:** RSS, YouTube and podcast feeds, one forum scraper, fixtures/table. Run locally, dump `items.json`, and check the quality by eye.
3. **Player with a hand-written bulletin:** pixel studio, presenters, ticker, captions, browser TTS. Built against a fake
   `bulletin.json` so the art work isn't blocked by the pipeline. Can run in parallel with 2.
4. **Script generation:** cluster, rank and classify, then templates + LLM produce a real `bulletin.json`. **This milestone delivers the "one real bulletin" goal.**
5. **Kokoro voices + lip sync:** each presenter has their own voice, and the mouth follows the clip's loudness.
6. **Automation:** GitHub Actions cron (e.g. every 3 hours) builds and deploys to Pages.
7. **Polish:** segment graphics, idents, chiptune stings, presenter rotation by time of day.
8. **Later, live matchday:** while Hearts are playing, a fast-poll job writes `live.json`. The player breaks into a "Match Centre LIVE"
   segment with goal alerts. GitHub's cron is too coarse and unreliable for this, so it will probably need a free Cloudflare Worker.
9. **Later, SPFL expansion:** add club configs, a club picker, and "around the grounds" segments.
10. **Presenter brains (done, 21 Oct):** personas live in `channel.json`, and memory in `memory.json`, published with
    the site and read back by the next hourly build. "The Debate" (Fraser against Ally) ends with score predictions,
    which are settled against results. Original notes: each presenter gets a personality profile and a memory, both fed into the
    LLM prompt when their lines are written. For example: a veteran pundit who hates VAR and harks back to old
    Tynecastle days, and a young analyst obsessed with tactics, xG and fantasy football. Memory is a small JSON
    store per presenter (past predictions, running jokes, opinions on players), updated after each bulletin, so
    they can say things like "I told you last week he'd start". This sits on top of milestone 4's script
    generation, and it's where the deliberately neutral tone picks up some character.

## Ideas backlog (saved 21 Oct 2026)

Bulletins currently run 3–6 minutes depending on news, so these also give a steadier length:

- **On This Day in Hearts history:** a short daily segment using London Hearts (londonhearts.com), which is great for
  stats and past results on this date. Fraser is the natural presenter (nostalgia).
- **Next opponent focus:** their recent results and form (BBC Sport has their team pages too), likely line-up,
  key players, and head-to-head. Fits the build-up mode and Kirsty's Match Centre.
- **Hearts tactics and line-up in the build-up:** expected XI and formation, how we're likely to set up, from
  previews and press conferences. Ally gets to talk shape and pressing; could show a pixel pitch graphic with the XI.
- **Also pending from earlier:** a fact-check pass (Flash-Lite still invents small details, e.g. "live from
  Tynecastle"), and bumping the GitHub Actions versions before the Node 20 retirement.

## Open questions

- Which forums, fan podcasts and YouTube channels exactly? Names or URLs are needed.
- Channel name and branding: "Hearts News 24"? "Jambo Sports News"?
- Which free LLM: sign up for a Gemini API key (generous free tier) or Groq?
