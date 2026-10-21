# Hearts News 24

A rolling 24-hour pixel-art sports news channel for Heart of Midlothian. See [PLAN.md](PLAN.md) for the roadmap.

## Layout

| Path | What |
|---|---|
| `clubs/hearts.json` | Club config: names, colours, keywords, source feeds, TheSportsDB ids |
| `pipeline/` | Node/TS: collects news (`npm run collect`) → `pipeline/out/items.json` + `match.json` |
| `shared/bulletin.ts` | The `bulletin.json` format the pipeline writes and the player reads |
| `site/` | Vite + Canvas player. Plays `site/public/bulletins/latest.json` |

## Commands (run inside WSL)

```bash
npm install
npm run collect     # scrape all sources for Hearts
npm run dev         # player at http://localhost:5173
npm run build       # static site → site/dist
npm run typecheck
```

Player URL options: `?segment=match` jumps straight to a segment, and `?bulletin=bulletins/x.json` plays another file.
Keys: **M** mute, **C** captions, **→** skip, **F** fullscreen.
