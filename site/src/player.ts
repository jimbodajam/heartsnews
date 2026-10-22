import type { Bulletin, Graphic, Line, Presenter, Segment, SegmentKind } from '../../shared/bulletin';
import { playSting } from './audio/sting';
import type { Speaking, Voices } from './audio/voice';
import { drawGraphic, drawSidePanel } from './gfx/graphics';
import {
  drawBug, drawCaption, drawClock, drawHeadlineBar, drawIdent, drawSplash, drawSting, drawStrap, drawTicker,
  IDENT_MS, STING_MS,
} from './gfx/overlay';
import { drawPresenter, gestureLift, idlePose, SEATED_DESK_Y, STANDING_H } from './gfx/presenter';
import type { Ctx } from './gfx/screen';
import { W } from './gfx/screen';
import {
  drawDesk, drawDeskBackground, drawGraphicBackground, drawImageStudio, drawStudioLife, drawHands, drawIdleScreen, drawPodium, drawTouchBackground,
  drawTransferBackground, drawWallClock,
} from './gfx/studio';

type Shot = 'wide' | 'single' | 'full';

const FULLSCREEN: Graphic['type'][] = ['table', 'fixtures', 'sentiment', 'result', 'transfer', 'quote', 'predictions', 'form', 'formation'];

const LABEL: Record<SegmentKind, string> = {
  headlines: 'HEADLINES',
  story: 'IN FOCUS',
  transfers: 'TRANSFER CENTRE',
  fans: 'FAN ZONE',
  match: 'MATCH CENTRE',
  debate: 'THE DEBATE',
  opponent: 'OPPOSITION FOCUS',
};

/**
 * Plays a bulletin on a loop: ident → for each segment, a sting then each line spoken by its presenter.
 * Playback runs as an async sequence; rendering runs separately every animation frame from the current state.
 */
export class Player {
  captions = true;
  status = 'CLICK TO TUNE IN';
  /** Optional painted studio background (from `npm run pixelate`); `classicStudio` switches back to the code-drawn set. */
  studioImage?: HTMLImageElement;
  classicStudio = false;

  private mode: 'splash' | 'ident' | 'sting' | 'show' = 'splash';
  private modeAt = 0;
  private seg?: Segment;
  private line?: Line;
  /** The last graphic shown in this segment: a close-up without its own stays on the story rather than the sidebar. */
  private segGraphic?: Graphic;
  private shot: Shot = 'wide';
  private graphicAt = 0;
  private speaking?: Speaking;
  private strap?: { name: string; role: string; at: number };
  private strapped = new Set<string>();
  private cancelWait?: () => void;

  constructor(
    private g: Ctx,
    private voices: Voices,
    private bulletin: Bulletin,
    /** Where the bulletin was loaded from; clip paths are relative to it. */
    private bulletinUrl: URL,
    private reload: () => Promise<Bulletin | undefined>,
  ) {
    requestAnimationFrame(this.frame);
  }

  begin(startAt?: string): void {
    if (this.mode === 'splash') void this.loop(startAt);
  }

  skip(): void {
    this.speaking?.cancel();
    this.cancelWait?.();
  }

  private paintedStudio(): boolean {
    return Boolean(this.studioImage) && !this.classicStudio;
  }

  private presenter(id: string): Presenter {
    return this.bulletin.presenters.find((p) => p.id === id) ?? this.bulletin.presenters[0];
  }

  private setMode(mode: Player['mode']): void {
    this.mode = mode;
    this.modeAt = performance.now();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => {
      const done = () => {
        clearTimeout(id);
        this.cancelWait = undefined;
        res();
      };
      const id = setTimeout(done, ms);
      this.cancelWait = done;
    });
  }

  private clipUrl(line: Line): string | undefined {
    return line.audio ? new URL(line.audio, this.bulletinUrl).href : undefined;
  }

  /** Fetch every clip in the bulletin up front so lines start without a gap. */
  private preloadClips(): void {
    for (const seg of this.bulletin.segments) {
      for (const line of seg.lines) {
        const url = this.clipUrl(line);
        if (url) this.voices.preload(url).catch(() => undefined);
      }
    }
  }

  private sting(kind: 'ident' | 'segment'): void {
    if (!this.voices.muted) playSting(kind);
  }

  /** `startAt` (a segment id) skips the ident and earlier segments on the first loop only. */
  private async loop(startAt?: string): Promise<void> {
    for (;;) {
      this.preloadClips();
      const first =Math.max(0, this.bulletin.segments.findIndex((s) => s.id === startAt));
      if (!first) {
        this.setMode('ident');
        this.sting('ident');
        await this.wait(IDENT_MS);
      }
      startAt = undefined;

      for (const seg of this.bulletin.segments.slice(first)) {
        this.seg = seg;
        this.line = undefined;
        this.segGraphic = undefined;
        this.shot = 'wide';
        this.strap = undefined;
        this.strapped.clear();
        this.setMode('sting');
        this.sting('segment');
        await this.wait(STING_MS);
        this.setMode('show');
        for (let i = 0; i < seg.lines.length; i++) await this.playLine(seg, i);
        await this.wait(500);
      }

      const fresh = await this.reload();
      if (fresh) this.bulletin = fresh;
    }
  }

  private async playLine(seg: Segment, i: number): Promise<void> {
    const line = seg.lines[i];
    const p = this.presenter(line.speaker);
    if (line.graphic && line.graphic !== this.line?.graphic) this.graphicAt = performance.now();
    this.shot = this.pickShot(seg, i, line);
    this.line = line;
    if (line.graphic) this.segGraphic = line.graphic;
    if (!this.strapped.has(p.id)) {
      this.strapped.add(p.id);
      this.strap = { name: p.name, role: p.role, at: performance.now() };
    } else if (this.strap?.name !== p.name) {
      this.strap = undefined;
    }

    const speaking = this.voices.speak(line.text, p, this.clipUrl(line));
    this.speaking = speaking;
    await speaking.done;
    this.speaking = undefined;
    await this.wait(350);
  }

  private pickShot(seg: Segment, i: number, line: Line): Shot {
    if (seg.scene !== 'desk') return 'wide';
    if (line.graphic) return FULLSCREEN.includes(line.graphic.type) ? 'full' : 'single';
    if (i === 0) return 'wide';
    return i % 2 ? 'single' : 'wide';
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    this.render(now);
    requestAnimationFrame(this.frame);
  };

  private render(now: number): void {
    const { g, bulletin } = this;
    const t = now / 1000;
    const age = now - this.modeAt;
    const name = bulletin.channel.name;

    if (this.mode === 'splash') return drawSplash(g, t, name, this.status);
    if (this.mode === 'ident') return drawIdent(g, age, name);
    const seg = this.seg!;

    this.drawScene(seg, now);
    drawBug(g, name, !!bulletin.demo);
    drawClock(g, new Date(), t);
    if (this.strap) drawStrap(g, this.strap.name, this.strap.role, now - this.strap.at);
    if (this.captions && this.speaking && this.line) drawCaption(g, this.line.text, this.speaking.progress(now));
    const graphic = this.line?.graphic;
    drawHeadlineBar(g, LABEL[seg.kind], graphic?.type === 'headline' ? graphic.title : seg.strap);
    drawTicker(g, bulletin.ticker, t);

    if (this.mode === 'sting') drawSting(g, age, LABEL[seg.kind], seg.title);
  }

  private drawScene(seg: Segment, now: number): void {
    const { g } = this;
    const t = now / 1000;
    const graphic = this.line?.graphic;
    const graphicAge = now - this.graphicAt;
    const talking = this.speaking ? this.line?.speaker : undefined;
    const phaseOf = (p: Presenter) => this.bulletin.presenters.indexOf(p) * 1.37 + 0.4;
    const pose = (p: Presenter, look = 0) => idlePose(t, phaseOf(p), p.id === talking ? this.speaking!.level(now) : 0, look);
    const lift = (p: Presenter) => gestureLift(t, phaseOf(p), p.id === talking);
    const onScreen = seg.presenters.map((id) => this.presenter(id));

    switch (seg.scene) {
      case 'desk': {
        if (this.shot === 'full' && graphic) {
          drawGraphicBackground(g);
          drawGraphic(g, graphic, 12, 28, W - 24, 84, graphicAge, now);
          return;
        }
        if (this.shot === 'single' && this.line) {
          const p = this.presenter(this.line.speaker);
          const top = 30;
          const deskY = top + SEATED_DESK_Y * 3;
          if (this.paintedStudio()) {
            drawImageStudio(g, this.studioImage!, 'close', t);
          } else {
            // Panned so the video wall's heart logo sits off to the left, not behind the presenter's head.
            drawDeskBackground(g, 140);
            drawStudioLife(g, 140, t);
          }
          drawPresenter(g, 92, top, p.look, pose(p), 3);
          drawDesk(g, deskY, -20, W + 20);
          drawHands(g, 92, deskY, 3, p.look.skin, lift(p), p.look.suit);
          const shown = graphic ?? this.segGraphic;
          if (shown) drawGraphic(g, shown, 168, 22, 142, 80, graphic ? graphicAge : Infinity, now);
          else if (this.bulletin.sidebar) drawSidePanel(g, this.bulletin.sidebar, 168, 22, 142, 80, now);
          return;
        }
        const xs = onScreen.length === 1 ? [160] : [115, 205];
        const top = 40;
        const deskY = top + SEATED_DESK_Y * 2;
        if (this.paintedStudio()) {
          drawImageStudio(g, this.studioImage!, 'wide', t);
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
