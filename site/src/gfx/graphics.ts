import type { Graphic, Sidebar } from '../../../shared/bulletin';
import { drawText, drawTextCentred, drawTextRight, fit, LINE_H, measure, wrap } from './font';
import { drawIcon } from './icons';
import { C } from './palette';
import { clamp01, frame, rect, type Ctx } from './screen';

const easeOut = (v: number) => 1 - (1 - v) ** 3;

/** Two lines of subtitles start around here; keep must-read text above it. */
const CAPTION_SAFE_BOTTOM = 106;

/** Navy panel with a gold border and optional title bar. Returns the y where content starts. */
function panel(g: Ctx, x: number, y: number, w: number, h: number, title?: string): number {
  rect(g, x, y, w, h, C.navyDark);
  frame(g, x, y, w, h, C.gold);
  if (!title) return y + 4;
  rect(g, x + 1, y + 1, w - 2, 9, C.maroon);
  rect(g, x + 1, y + 10, w - 2, 1, C.goldDark);
  drawText(g, fit(title, w - 8), x + 4, y + 3, C.gold);
  return y + 14;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}  ${time}`;
}

function moodWord(score: number): string {
  if (score < -0.6) return 'RAGING';
  if (score < -0.2) return 'UNEASY';
  if (score < 0.2) return 'MIXED';
  if (score < 0.6) return 'UPBEAT';
  return 'BUZZING';
}

const STATUS: Record<'rumour' | 'talks' | 'medical' | 'done', [string, string]> = {
  rumour: ['RUMOUR', C.gold],
  talks: ['IN TALKS', C.blue],
  medical: ['MEDICAL', C.amber],
  done: ['DONE DEAL', C.green],
};

/** "KICK-OFF IN 2H 14M", "IN PROGRESS", or the day and time further out. */
function countdown(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return ms > -2.25 * 3_600_000 ? 'IN PROGRESS' : '';
  if (ms < 24 * 3_600_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `KICK-OFF IN ${h ? `${h}H ` : ''}${m}M`;
  }
  return shortDate(iso);
}

const PAGE_MS = 6000;

// Pixel portraits (24×24, from `npm run faces`) load on first use; until then the icon shows instead.
const FACE_PX = 24;
const faceCache = new Map<string, HTMLImageElement>();
function faceImage(path?: string): HTMLImageElement | undefined {
  if (!path) return undefined;
  let img = faceCache.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    faceCache.set(path, img);
  }
  return img.complete && img.naturalWidth ? img : undefined;
}

/** A portrait in a small gold frame. Returns its width. */
function drawFace(g: Ctx, img: HTMLImageElement, x: number, y: number, scale: number): number {
  const size = FACE_PX * scale;
  rect(g, x - 1, y - 1, size + 2, size + 2, C.gold);
  rect(g, x, y, size, size, C.navy);
  g.drawImage(img, x, y, size, size);
  return size;
}

/**
 * The Sky-style info panel beside a presenter in close-up when there's no story graphic: it rotates between
 * the next match (with a countdown), the last result and the league table around us.
 */
export function drawSidePanel(g: Ctx, sb: Sidebar, x: number, y: number, w: number, h: number, now: number): void {
  const pages = [sb.next && 'next', sb.last && 'last', sb.table?.length && 'table'].filter(Boolean) as ('next' | 'last' | 'table')[];
  if (!pages.length) return;
  const page = pages[Math.floor(now / PAGE_MS) % pages.length];
  const age = now % PAGE_MS;
  const cx = x + w / 2;
  if (page === 'next' && sb.next) {
    const n = sb.next;
    panel(g, x, y, w, h, 'NEXT MATCH');
    drawTextCentred(g, fit(n.home, w - 10, 2), cx, y + 16, C.white, 2);
    drawTextCentred(g, 'V', cx, y + 29, C.grey);
    drawTextCentred(g, fit(n.away, w - 10, 2), cx, y + 37, C.white, 2);
    drawTextCentred(g, fit(n.competition, w - 10), cx, y + 52, C.grey);
    drawTextCentred(g, countdown(n.date), cx, y + 62, C.gold);
  } else if (page === 'last' && sb.last) {
    const r = sb.last;
    drawGraphic(g, { type: 'result', home: r.home, away: r.away, homeScore: r.homeScore, awayScore: r.awayScore, competition: 'LAST RESULT' }, x, y, w, h, age, now);
  } else if (page === 'table' && sb.table) {
    drawGraphic(g, { type: 'table', title: sb.tableTitle ? `${sb.tableTitle} TABLE` : 'LEAGUE TABLE', rows: sb.table, highlight: sb.highlight }, x, y, w, h, age, now);
  }
}

/**
 * Draws an on-screen graphic into the box (x, y, w, h). `age` is ms since it first appeared,
 * used for wipe-in and counting animations; `now` drives blinking.
 */
export function drawGraphic(g: Ctx, gr: Graphic, x: number, y: number, w: number, h: number, age: number, now: number): void {
  const reveal = easeOut(clamp01(age / 280));
  g.save();
  g.beginPath();
  g.rect(x, y, Math.ceil(w * reveal), h);
  g.clip();

  const big = w >= 180;
  const cx = x + w / 2;

  switch (gr.type) {
    case 'headline': {
      const top = panel(g, x, y, w, h, 'LATEST');
      const s = big ? 2 : 1;
      const iconS = big ? 3 : 2;
      const portrait = faceImage(gr.face);
      const pictureW = portrait ? drawFace(g, portrait, x + 6, top + 1, big ? 2 : 1) : (drawIcon(g, gr.icon ?? 'ball', x + 6, top + 1, iconS), 8 * iconS);
      const tx = x + 12 + pictureW;
      const maxLines = Math.floor((y + h - 14 - top) / (LINE_H * s));
      wrap(gr.title, x + w - 6 - tx, s)
        .slice(0, maxLines)
        .forEach((l, i) => drawText(g, l, tx, top + 2 + i * LINE_H * s, C.white, s));
      if (gr.source) drawText(g, fit(`SOURCE: ${gr.source}`, w - 12), x + 6, y + h - 9, C.gold);
      break;
    }

    case 'transfer': {
      const top = panel(g, x, y, w, h, 'TRANSFER CENTRE');
      const s = measure(gr.player, 2) <= w - 12 ? 2 : 1;
      drawTextCentred(g, fit(gr.player, w - 12, s), cx, top + 3, C.white, s);
      const row = top + 3 + 5 * s + 7;
      drawTextCentred(g, fit(`${gr.from}  >  ${gr.to}`, w - 12), cx, row, C.light);
      const [label, colour] = STATUS[gr.status];
      const sw = measure(label, 2) + 12;
      const sy = row + 11;
      const flash = gr.status === 'done' && Math.floor(now / 400) % 2 === 0;
      rect(g, cx - sw / 2, sy, sw, 16, flash ? C.white : colour);
      drawTextCentred(g, label, cx, sy + 3, C.ink, 2);
      if (gr.fee) drawTextCentred(g, fit(`FEE: ${gr.fee}`, w - 12), cx, sy + 22, C.gold);
      break;
    }

    case 'sentiment': {
      const top = panel(g, x, y, w, h, 'FAN ZONE: SUPPORTER MOOD');
      const mx = x + 10;
      const mw = w - 20;
      const my = top + 6;
      const bands = [C.red, C.amber, C.gold, '#8bc34a', C.green];
      bands.forEach((c, i) => rect(g, mx + (i * mw) / 5, my, mw / 5 + 1, 7, c));
      const shown = gr.score * easeOut(clamp01(age / 1400));
      const nx = Math.round(mx + ((shown + 1) / 2) * (mw - 1));
      rect(g, nx - 2, my - 4, 5, 1, C.white);
      rect(g, nx - 1, my - 3, 3, 1, C.white);
      rect(g, nx, my - 2, 1, 11, C.white);
      drawText(g, 'RAGING', mx, my + 10, C.grey);
      drawTextRight(g, 'BUZZING', mx + mw, my + 10, C.grey);
      drawTextCentred(g, moodWord(gr.score), cx, my + 10, C.white, big ? 2 : 1);
      let ty = my + (big ? 26 : 20);
      drawText(g, 'TALKING POINTS', x + 8, ty, C.gold);
      ty += 8;
      for (const topic of gr.topics) {
        if (ty + 5 > y + h - 3) break;
        drawText(g, `> ${fit(topic, w - 26)}`, x + 8, ty, C.white);
        ty += 8;
      }
      break;
    }

    case 'table': {
      const top = panel(g, x, y, w, h, gr.title);
      const teamX = x + 22;
      const pR = x + w - 52;
      const gdR = x + w - 30;
      const ptsR = x + w - 8;
      drawText(g, 'TEAM', teamX, top, C.grey);
      drawTextRight(g, 'P', pR, top, C.grey);
      drawTextRight(g, 'GD', gdR, top, C.grey);
      drawTextRight(g, 'PTS', ptsR, top, C.grey);
      const visible = Math.floor(age / 90);
      const maxRows = Math.floor((y + h - top - 10) / 9);
      gr.rows.slice(0, Math.min(visible, maxRows)).forEach((r, i) => {
        const ry = top + 9 + i * 9;
        const mine = r.team === gr.highlight;
        rect(g, x + 2, ry - 2, w - 4, 9, mine ? C.maroon : i % 2 ? C.navyDark : C.navy);
        const col = mine ? C.gold : C.white;
        drawTextRight(g, String(r.pos), x + 14, ry, col);
        drawText(g, fit(r.team, pR - 14 - teamX), teamX, ry, col);
        drawTextRight(g, String(r.played), pR, ry, col);
        drawTextRight(g, r.gd > 0 ? `+${r.gd}` : String(r.gd), gdR, ry, col);
        drawTextRight(g, String(r.pts), ptsR, ry, col);
      });
      break;
    }

    case 'fixtures': {
      const top = panel(g, x, y, w, h, gr.title);
      // Only a couple of fixtures: make them big rather than leave the panel empty.
      const s = big && gr.fixtures.length <= 2 ? 2 : 1;
      const rowH = s === 2 ? 30 : 17;
      gr.fixtures.forEach((f, i) => {
        const fy = top + 2 + i * rowH;
        if (fy + 5 * s + 7 > y + h) return;
        drawText(g, fit(`${f.home} V ${f.away}`, w - 12, s), x + 6, fy, C.white, s);
        drawText(g, fit(`${shortDate(f.date)}  ${f.competition}`, w - 12), x + 6, fy + 5 * s + 3, C.gold);
      });
      break;
    }

    case 'result': {
      const status = gr.status ?? 'FULL TIME';
      const live = /live/i.test(status);
      const top = panel(g, x, y, w, h, gr.competition);
      // Status sits in the title bar, right-aligned; a live score blinks red.
      if (!live || Math.floor(now / 500) % 2) drawTextRight(g, status, x + w - 5, y + 3, live ? C.red : C.gold);
      const hasScorers = Boolean(gr.homeScorers?.length || gr.awayScorers?.length);
      const ns = big ? 2 : 1;
      const ss = big && !hasScorers ? 4 : 3;
      drawTextCentred(g, fit(gr.home, w / 2 - 10, ns), x + w / 4, top + 4, C.white, ns);
      drawTextCentred(g, fit(gr.away, w / 2 - 10, ns), x + (3 * w) / 4, top + 4, C.white, ns);
      const sy = top + 4 + 5 * ns + 6;
      drawTextCentred(g, String(gr.homeScore), x + w / 4, sy, C.gold, ss);
      drawTextCentred(g, '-', cx, sy, C.gold, ss);
      drawTextCentred(g, String(gr.awayScore), x + (3 * w) / 4, sy, C.gold, ss);
      // Scorers under each team, as many as fit above the subtitles, then "+N MORE".
      const sTop = sy + 5 * ss + 6;
      const room = Math.max(0, Math.floor((Math.min(y + h - 3, CAPTION_SAFE_BOTTOM) - sTop) / 7));
      ([['home', gr.homeScorers], ['away', gr.awayScorers]] as const).forEach(([side, list]) => {
        const scorers = list ?? [];
        const colX = side === 'home' ? x + w / 4 : x + (3 * w) / 4;
        const shown = scorers.length > room ? scorers.slice(0, Math.max(0, room - 1)) : scorers;
        shown.forEach((s, i) => drawTextCentred(g, fit(s, w / 2 - 8), colX, sTop + i * 7, C.light));
        if (shown.length < scorers.length) drawTextCentred(g, `+${scorers.length - shown.length} MORE`, colX, sTop + shown.length * 7, C.grey);
      });
      break;
    }

    case 'predictions': {
      const top = panel(g, x, y, w, h, 'PREDICTIONS');
      drawTextCentred(g, fit(gr.fixture, w - 12), cx, top + 1, C.light);
      const colW = w / Math.max(1, gr.picks.length);
      const ns = big ? 2 : 1;
      const ps = big ? 4 : 3;
      gr.picks.forEach((p, i) => {
        const pcx = x + colW * i + colW / 2;
        const ny = top + 12;
        const py = ny + 5 * ns + 5;
        drawTextCentred(g, fit(p.name, colW - 8, ns), pcx, ny, C.gold, ns);
        drawTextCentred(g, p.pick, pcx, py, C.white, ps);
        if (p.record) drawTextCentred(g, fit(p.record, colW - 8), pcx, py + 5 * ps + 4, C.grey);
      });
      break;
    }

    case 'form': {
      const top = panel(g, x, y, w, h, `${gr.team}: LAST ${gr.results.length}`);
      const colour = { W: C.green, D: C.gold, L: C.red };
      gr.results.forEach((r, i) => {
        const ry = top + 1 + i * 10;
        if (ry + 8 > y + h - 2) return;
        rect(g, x + 6, ry - 1, 8, 8, colour[r.outcome]);
        drawText(g, r.outcome, x + 8, ry + 1, C.ink);
        drawText(g, fit(`${r.score}  ${r.venue === 'H' ? 'V' : 'AT'} ${r.against}`, w - 26), x + 19, ry + 1, C.white);
      });
      break;
    }

    case 'formation': {
      const top = panel(g, x, y, w, h, `${gr.label}: ${gr.team} ${gr.formation}`);
      const px = x + 4;
      const py = top - 1;
      const pw = w - 8;
      // Keep every player above the subtitles.
      const ph = Math.min(y + h - 3, CAPTION_SAFE_BOTTOM) - py;
      // Striped grass and faint white markings, attacking left to right.
      for (let i = 0; i < 10; i++) rect(g, px + (i * pw) / 10, py, pw / 10 + 1, ph, i % 2 ? '#2a7135' : '#2f7d3b');
      g.globalAlpha = 0.45;
      frame(g, px, py, pw, ph, C.white);
      rect(g, px + pw / 2, py, 1, ph, C.white);
      frame(g, px + pw / 2 - 6, py + ph / 2 - 6, 13, 13, C.white);
      frame(g, px, py + ph * 0.25, Math.round(pw * 0.12), Math.round(ph * 0.5), C.white);
      frame(g, px + pw - Math.round(pw * 0.12), py + ph * 0.25, Math.round(pw * 0.12), Math.round(ph * 0.5), C.white);
      g.globalAlpha = 1;
      // Players: one column per line of the formation, spread evenly down the pitch, surname underneath.
      const cols = gr.rows.length;
      const kit = gr.ours ? C.maroonLight : C.light;
      gr.rows.forEach((row, i) => {
        const cx = px + (pw * (i + 0.5)) / cols;
        row.forEach((name, j) => {
          const cy = Math.round(py + (ph * (j + 0.5)) / row.length - 5);
          rect(g, cx - 3, cy, 6, 6, C.ink);
          rect(g, cx - 2, cy + 1, 4, 4, kit);
          const surname = name.split(' ').pop() ?? name;
          drawTextCentred(g, fit(surname, pw / cols - 2), cx, cy + 7, C.white);
        });
      });
      break;
    }

    case 'quote': {
      // The speaker goes in the title bar: the bottom of the panel is often under the subtitles.
      const top = panel(g, x, y, w, h, `IN QUOTES: ${gr.author}`);
      // The speaker's portrait if we have it, otherwise a big quote mark.
      const portrait = faceImage(gr.face);
      const indent = portrait ? drawFace(g, portrait, x + 6, top + 1, big ? 2 : 1) + 12 : 22;
      if (!portrait) drawText(g, '"', x + 6, top, C.gold, 3);
      const s = big ? 2 : 1;
      const lines = wrap(gr.text, w - indent - 8, s);
      const maxLines = Math.floor((y + h - 4 - top) / (LINE_H * s));
      lines.slice(0, maxLines).forEach((l, i) => drawText(g, l, x + indent, top + 2 + i * LINE_H * s, C.white, s));
      break;
    }
  }

  g.restore();
}
