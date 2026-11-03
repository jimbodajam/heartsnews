import type { Graphic, Presenter, Segment } from '../../../shared/bulletin';
import { drawGraphic, drawSidePanel } from '../gfx/graphics';
import { SEGMENT_LABEL } from '../gfx/labels';
import {
  drawBreaking, drawBug, drawCaption, drawClock, drawHeadlineBar, drawIdent, drawSplash, drawSting, drawStrap,
  drawCallerBar,
} from '../gfx/overlay';
import { drawPresenter, gestureLift, idlePose, SEATED_DESK_Y, STANDING_H } from '../gfx/presenter';
import { drawAdvert } from '../gfx/adverts';
import { drawSponsor } from '../gfx/sponsor';
import { C } from '../gfx/palette';
import type { Ctx } from '../gfx/screen';
import { createScreen, H, rect, W } from '../gfx/screen';
import {
  drawDesk, drawDeskBackground, drawGraphicBackground, drawImageStudio, drawStudioLife, drawHands, drawIdleScreen, drawPodium, drawTouchBackground,
  drawTransferBackground, drawWallBackground, drawWallClock, drawWallSeams, sweep, WALL,
} from '../gfx/studio';
import { drawPressDesk, drawStadium } from '../gfx/stadium';
import type { FrameState, Renderer } from './state';

/** A desk close-up's side panel, beside the presenter: x, y, w, h on the 320×180 screen. */
export const SIDE_PANEL = [168, 22, 142, 80] as const;

/**
 * A desk close-up's side panel: the line's graphic, else the segment's last one (the caller has his own bar instead),
 * else the bulletin's sidebar.
 */
export function drawSdPanel(g: Ctx, s: FrameState, now: number): void {
  const [x, y, w, h] = SIDE_PANEL;
  const panel = panelGraphic(s);
  if (panel) drawGraphic(g, panel, x, y, w, h, s.graphic ? s.graphicAge : Infinity, now);
  else if (s.sidebar) drawSidePanel(g, s.sidebar, x, y, w, h, now);
}

/** Whether drawSdPanel draws anything. */
export function hasSdPanel(s: FrameState): boolean {
  return Boolean(panelGraphic(s) ?? s.sidebar);
}

function panelGraphic(s: FrameState): Graphic | undefined {
  const shown = s.graphic ?? s.segGraphic;
  return shown?.type === 'caller' ? undefined : shown;
}

/** The original look: everything drawn in code onto one 320×180 canvas, scaled up with crisp pixels. */
export class SdRenderer implements Renderer {
  private canvas?: HTMLCanvasElement;
  private g?: Ctx;
  private unfit?: AbortController;

  mount(container: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'tv';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Hearts News 24 broadcast');
    container.append(canvas);
    this.unfit = new AbortController();
    this.g = createScreen(canvas, this.unfit.signal);
    this.canvas = canvas;
  }

  unmount(): void {
    this.unfit?.abort();
    this.canvas?.remove();
    this.canvas = this.g = this.unfit = undefined;
  }

  focus(): void {
    this.canvas?.focus();
  }

  /** The bulletin couldn't be loaded: there's no programme to draw. */
  offAir(): void {
    if (this.g) drawSplash(this.g, 0, 'HEARTS NEWS 24', 'OFF AIR');
  }

  draw(s: FrameState, now: number): void {
    const { g } = this;
    if (!g) return;
    const t = now / 1000;
    const age = s.modeAge;
    const name = s.channel;

    if (s.mode === 'splash') return drawSplash(g, t, name, s.status);
    if (s.mode === 'ident') return drawIdent(g, age, name);
    if (s.mode === 'sponsor') return drawSponsor(g, age, s.jingleAge, s.sponsorKind, s.sponsorLogo);
    const seg = s.seg!;

    // An ad break fills the screen: no channel logo, clock, straps or ticker, just the advert (and subtitles).
    if (seg.kind === 'adverts') {
      this.drawScene(g, s, seg, now);
      if (s.captions && s.speaking && s.line) drawCaption(g, s.line.text, s.speaking.progress(now));
      if (s.mode === 'sting') drawSting(g, age, SEGMENT_LABEL[seg.kind], seg.title);
      if (s.mode === 'breaking') drawBreaking(g, age, s.breakingFlash);
      return;
    }

    this.drawScene(g, s, seg, now);
    drawBug(g, name, s.demo);
    drawClock(g, new Date(), t);
    if (s.strap) drawStrap(g, s.strap.name, s.strap.role, s.strap.age, s.strap.hold ? Infinity : undefined);
    if (s.captions && s.speaking && s.line) drawCaption(g, s.line.text, s.speaking.progress(now));
    const graphic = s.graphic;
    if (graphic?.type === 'caller') drawCallerBar(g, graphic.name, graphic.from, graphic.topic, now, s.graphicAge);
    else drawHeadlineBar(g, SEGMENT_LABEL[seg.kind], graphic?.type === 'headline' ? graphic.title : seg.strap);
    s.ticker.draw(g, s.tickerItems, now);

    if (s.mode === 'sting') drawSting(g, age, SEGMENT_LABEL[seg.kind], seg.title);
    if (s.mode === 'breaking') drawBreaking(g, age, s.breakingFlash);
  }

  /** Only the scene, without the channel's bars: the HD renderer puts its own furniture over it. */
  drawSceneOnly(s: FrameState, now: number): void {
    if (this.g && s.seg) this.drawScene(this.g, s, s.seg, now);
  }

  /** Only a desk close-up's side panel (drawSdPanel), on a cleared canvas, for the HD renderer to put beside its presenter. */
  drawPanelOnly(s: FrameState, now: number): void {
    const { g } = this;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    drawSdPanel(g, s, now);
  }

  /**
   * The scene alone, under the channel's bars (logo, clock, strap, captions, headline bar, ticker): the studio, presenters
   * and screens, or in an ad break the advert.
   */
  private drawScene(g: Ctx, s: FrameState, seg: Segment, now: number): void {
    const t = now / 1000;
    if (seg.kind === 'adverts') {
      const ad = s.line?.graphic;
      if (s.mode === 'show' && ad?.type === 'advert') drawAdvert(g, ad, s.graphicAge, t, s.lineAge);
      else rect(g, 0, 0, W, H, C.black);
      return;
    }
    const graphic = s.graphic;
    const graphicAge = s.graphicAge;
    const talking = s.talking;
    const phaseOf = (p: Presenter) => s.cast.indexOf(p) * 1.37 + 0.4;
    const pose = (p: Presenter, look = 0) => idlePose(t, phaseOf(p), p.id === talking ? s.speaking!.level(now) : 0, look);
    const lift = (p: Presenter) => gestureLift(t, phaseOf(p), p.id === talking);
    const onScreen = s.onScreen;
    const paintedStudio = Boolean(s.studioImage) && !s.classicStudio;

    switch (seg.scene) {
      case 'desk': {
        if (s.shot === 'full' && graphic) {
          drawGraphicBackground(g);
          drawGraphic(g, graphic, 12, 28, W - 24, 84, graphicAge, now);
          return;
        }
        if (s.shot === 'single' && s.line) {
          const p = s.speaker!;
          const top = 30;
          const deskY = top + SEATED_DESK_Y * 3;
          if (paintedStudio) {
            drawImageStudio(g, s.studioImage!, 'close', t);
          } else {
            // Panned so the video wall's heart logo sits off to the left, not behind the presenter's head.
            drawDeskBackground(g, 140);
            drawStudioLife(g, 140, t);
          }
          drawPresenter(g, 92, top, p.look, pose(p), 3);
          drawDesk(g, deskY, -20, W + 20);
          drawHands(g, 92, deskY, 3, p.look.skin, lift(p), p.look.suit);
          drawSdPanel(g, s, now);
          return;
        }
        const xs = onScreen.length === 1 ? [160] : [115, 205];
        const top = 40;
        const deskY = top + SEATED_DESK_Y * 2;
        if (paintedStudio) {
          drawImageStudio(g, s.studioImage!, 'wide', t);
        } else {
          drawDeskBackground(g, 0);
          drawStudioLife(g, 0, t);
        }
        // Whoever isn't talking turns to look at whoever is.
        const pair = onScreen.slice(0, 2);
        const talkerAt = pair.findIndex((p) => p.id === talking);
        const lookAt = (k: number) => (talkerAt < 0 || talkerAt === k ? 0 : Math.sign(xs[talkerAt] - xs[k]));
        pair.forEach((p, k) => drawPresenter(g, xs[k], top, p.look, pose(p, lookAt(k)), 2));
        drawDesk(g, deskY, 40, 280);
        pair.forEach((p, k) => drawHands(g, xs[k], deskY, 2, p.look.skin, lift(p), p.look.suit));
        return;
      }

      case 'transfer': {
        drawTransferBackground(g);
        drawWallClock(g, new Date());
        const p = onScreen[0];
        if (p) {
          drawPresenter(g, 66, 34, p.look, pose(p), 2);
          drawPodium(g, 66, 34 + SEATED_DESK_Y * 2, 'TRANSFER CENTRE');
        }
        if (graphic) drawGraphic(g, graphic, 130, 18, 182, 86, graphicAge, now);
        else drawIdleScreen(g, 130, 18, 182, 86, 'TRANSFER CENTRE');
        return;
      }

      case 'pitchside': {
        const top = 30;
        const deskY = top + SEATED_DESK_Y * 3;
        drawStadium(g, s.ground, t);
        const p = onScreen[0];
        if (p) drawPresenter(g, 92, top, p.look, pose(p), 3);
        drawPressDesk(g, deskY);
        if (p) drawHands(g, 92, deskY, 3, p.look.skin, lift(p), p.look.suit);
        if (graphic) drawGraphic(g, graphic, 168, 22, 142, 80, graphicAge, now);
        return;
      }

      case 'museum': {
        const p = onScreen[0];
        // The opening line outside, a small figure on the pavement by the lamp post so the museum's sign shows; the
        // rest in the gallery, close to camera in front of the display case. Feet go behind the strap in both.
        if (s.line === seg.lines[0] && s.museum.front) {
          g.drawImage(s.museum.front, 0, 0, W, H);
          if (p) drawPresenter(g, 292, 166 - STANDING_H, p.look, pose(p), 1, true);
          return;
        }
        if (s.museum.inside) g.drawImage(s.museum.inside, 0, 0, W, H);
        else drawTouchBackground(g);
        if (graphic) drawGraphic(g, graphic, 12, 32, 204, 84, graphicAge, now);
        const glance = graphic && t % 5 < 1.6 ? -1 : 0;
        if (p) drawPresenter(g, 268, 34, p.look, pose(p, glance), 3, true);
        return;
      }

      case 'videowall': {
        // The team news: each player's card in turn, then the team in formation, which stays up for the bench.
        drawWallBackground(g);
        const shown = graphic ?? s.segGraphic;
        if (shown) drawGraphic(g, shown, WALL.x, WALL.y, WALL.w, WALL.h, graphic ? graphicAge : Infinity, now);
        else drawIdleScreen(g, WALL.x, WALL.y, WALL.w, WALL.h, seg.title);
        drawWallSeams(g);
        sweep(g, WALL.x, WALL.y, WALL.w, WALL.h, t);
        const p = onScreen[0];
        // Turns to the wall as each new card comes up, and every few seconds while talking.
        const glance = graphicAge < 1100 || t % 5 < 1.2 ? -1 : 0;
        if (p) drawPresenter(g, 276, 142 - STANDING_H * 2, p.look, pose(p, glance), 2, true);
        return;
      }

      case 'touchscreen': {
        drawTouchBackground(g);
        if (graphic) drawGraphic(g, graphic, 12, 32, 204, 84, graphicAge, now);
        else drawIdleScreen(g, 12, 32, 204, 84, 'MATCH CENTRE');
        const p = onScreen[0];
        // The analyst glances across at the screen every few seconds while talking it through.
        const glance = graphic && t % 5 < 1.6 ? -1 : 0;
        if (p) drawPresenter(g, 266, 142 - STANDING_H * 2, p.look, pose(p, glance), 2, true);
        return;
      }
    }
  }
}
