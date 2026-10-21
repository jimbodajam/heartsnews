import type { Graphic } from '../../../shared/bulletin';
import { drawText, drawTextCentred, drawTextRight, fit, LINE_H, measure, wrap } from './font';
import { drawIcon } from './icons';
import { C } from './palette';
import { clamp01, frame, rect, type Ctx } from './screen';

const easeOut = (v: number) => 1 - (1 - v) ** 3;

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
      drawIcon(g, gr.icon ?? 'ball', x + 6, top + 1, iconS);
      const tx = x + 12 + 8 * iconS;
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
      const top = panel(g, x, y, w, h, gr.competition);
      const ns = big ? 2 : 1;
      const ss = big ? 4 : 3;
      drawTextCentred(g, fit(gr.home, w / 2 - 10, ns), x + w / 4, top + 4, C.white, ns);
      drawTextCentred(g, fit(gr.away, w / 2 - 10, ns), x + (3 * w) / 4, top + 4, C.white, ns);
      const sy = top + 4 + 5 * ns + 6;
      drawTextCentred(g, String(gr.homeScore), x + w / 4, sy, C.gold, ss);
      drawTextCentred(g, '-', cx, sy, C.gold, ss);
      drawTextCentred(g, String(gr.awayScore), x + (3 * w) / 4, sy, C.gold, ss);
      drawTextCentred(g, 'FULL TIME', cx, sy + 5 * ss + 4, C.grey);
      (gr.scorers ?? []).forEach((s, i) => drawTextCentred(g, fit(s, w - 12), cx, sy + 5 * ss + 13 + i * 7, C.light));
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

    case 'quote': {
      // The speaker goes in the title bar: the bottom of the panel is often under the subtitles.
      const top = panel(g, x, y, w, h, `IN QUOTES: ${gr.author}`);
      drawText(g, '"', x + 6, top, C.gold, 3);
      const s = big ? 2 : 1;
      const lines = wrap(gr.text, w - 30, s);
      const maxLines = Math.floor((y + h - 4 - top) / (LINE_H * s));
      lines.slice(0, maxLines).forEach((l, i) => drawText(g, l, x + 22, top + 2 + i * LINE_H * s, C.white, s));
      break;
    }
  }

  g.restore();
}
