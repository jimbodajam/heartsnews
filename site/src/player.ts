import type { BreakingPackage } from '../../shared/breaking';
import type { Bulletin, Graphic, Line, Presenter, Segment, SegmentKind } from '../../shared/bulletin';
import { playSting } from './audio/sting';
import type { Speaking, Voices } from './audio/voice';
import { isFresh } from './breaking';
import { drawGraphic, drawSidePanel } from './gfx/graphics';
import {
  BREAKING_MS, drawBreaking, drawBug, drawCaption, drawClock, drawHeadlineBar, drawIdent, drawSplash, drawSting, drawStrap, IDENT_MS,
  STING_MS, Ticker, type TickerItem,
} from './gfx/overlay';
import { type LiveScore, scoreLine } from './live';
import { drawPresenter, gestureLift, idlePose, SEATED_DESK_Y, STANDING_H } from './gfx/presenter';
import { drawAdvert, preloadAdvert } from './gfx/adverts';
import { C } from './gfx/palette';
import type { Ctx } from './gfx/screen';
import { H, rect, W } from './gfx/screen';
import {
  drawDesk, drawDeskBackground, drawGraphicBackground, drawImageStudio, drawStudioLife, drawHands, drawIdleScreen, drawPodium, drawTouchBackground,
  drawTransferBackground, drawWallClock,
} from './gfx/studio';
import { drawPressDesk, drawStadium, type Ground, isDark } from './gfx/stadium';
import { kitColours } from '../../shared/kits';

type Shot = 'wide' | 'single' | 'full';

/** The live score comes round in the ticker after every this many headlines. */
const SCORE_EVERY = 3;

const FULLSCREEN:Graphic['type'][] = ['table', 'fixtures', 'sentiment', 'result', 'transfer', 'quote', 'predictions', 'form', 'formation'];

const LABEL: Record<SegmentKind, string> = {
  headlines: 'HEADLINES',
  story: 'IN FOCUS',
  transfers: 'TRANSFER CENTRE',
  fans: 'FAN ZONE',
  match: 'MATCH CENTRE',
  debate: 'THE DEBATE',
  opponent: 'OPPOSITION FOCUS',
  adverts: 'AD BREAK',
  breaking: 'BREAKING',
};

/** The same graphic again (bulletin JSON has no shared objects): an advert by its id, anything else by content. */
function sameGraphic(a?: Graphic, b?: Graphic): boolean {
  if (!a || !b) return a === b;
  if (a.type === 'advert' && b.type === 'advert') return a.id === b.id;
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

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
  /** Today's match, if the live feed is on: its score comes round in the ticker. */
  live?: LiveScore;
  /** Forces the floodlights on or off at the ground (?night=1 or 0); otherwise it goes by the time of day. */
  night?: boolean;

  private ticker = new Ticker();
  private mode: 'splash' | 'ident' | 'sting' | 'show' | 'breaking' = 'splash';
  /** Breaking news waiting for the current line to finish, and the one on air now. */
  private breakingQueue: BreakingPackage[] = [];
  private breaking?: BreakingPackage;
  private modeAt = 0;
  private seg?: Segment;
  private line?: Line;
  /** The last graphic shown in this segment: a close-up without its own stays on the story rather than the sidebar. */
  private segGraphic?: Graphic;
  private shot: Shot = 'wide';
  private graphicAt = 0;
  /** When the current line started. */
  private lineAt = 0;
  private speaking?: Speaking;
  /** `hold` keeps it up for the whole line, e.g. the venue strap at the ground. */
  private strap?: { name: string; role: string; at: number; hold?: boolean };
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
    // Breaking news brings its own cast: the reporter at the ground may not be in this programme.
    return this.bulletin.presenters.find((p) => p.id === id) ?? this.breaking?.presenters.find((p) => p.id === id) ?? this.bulletin.presenters[0];
  }

  /** Breaking news has come in: it goes out after the current line. */
  queueBreaking(p: BreakingPackage): void {
    this.breakingQueue.push(p);
    for (const line of p.segments.flatMap((s) => s.lines)) if (line.audio) this.voices.preload(line.audio).catch(() => undefined);
  }

  /** Play any breaking news that's waiting, then carry on with the programme where it was. */
  private async breakIn(): Promise<void> {
    if (this.breaking) return;
    for (let p = this.breakingQueue.shift(); p; p = this.breakingQueue.shift()) {
      if (!isFresh(p)) continue;
      const was = { seg: this.seg, line: this.line, segGraphic: this.segGraphic, shot: this.shot, strap: this.strap, strapped: new Set(this.strapped) };
      this.breaking = p;
      this.setMode('breaking');
      this.sting('breaking');
      await this.wait(BREAKING_MS);
      for (const seg of p.segments) {
        this.seg = seg;
        this.line = undefined;
        this.segGraphic = undefined;
        this.strap = undefined;
        this.strapped.clear();
        this.setMode('show');
        for (let i = 0; i < seg.lines.length; i++) await this.playLine(seg, i);
      }
      await this.wait(400);
      this.breaking = undefined;
      ({ seg: this.seg, line: this.line, segGraphic: this.segGraphic, shot: this.shot, strap: this.strap } = was);
      this.strapped = was.strapped;
    }
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
        if (line.graphic?.type === 'advert') preloadAdvert(line.graphic);
      }
    }
  }

  private sting(kind: 'ident' | 'segment' | 'breaking'): void {
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
    if (line.graphic && !sameGraphic(line.graphic, this.line?.graphic)) this.graphicAt = performance.now();
    this.lineAt = performance.now();
    // In an ad break, start fetching the next line's backdrop now.
    const upcoming = seg.lines[i + 1]?.graphic;
    if (upcoming?.type === 'advert') preloadAdvert(upcoming);
    this.shot = this.pickShot(seg, i, line);
    this.line = line;
    if (line.graphic) this.segGraphic = line.graphic;
    // Voiceovers in an ad break don't get a name strap.
    if (seg.kind === 'adverts') {
      this.strap = undefined;
    } else if (seg.scene === 'pitchside') {
      // At the ground the strap says where we are, and stays up.
      const venue = this.live?.match()?.venue;
      if (this.strap?.name !== p.name) this.strap = { name: p.name, role: venue ? `LIVE: ${venue}` : 'LIVE FROM THE GROUND', at: performance.now(), hold: true };
    } else if (!this.strapped.has(p.id)) {
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
    await this.breakIn();
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

    // An ad break fills the screen: no channel logo, clock, straps or ticker, just the advert (and subtitles).
    if (seg.kind === 'adverts') {
      const ad = this.line?.graphic;
      if (this.mode === 'show' && ad?.type === 'advert') drawAdvert(g, ad, now - this.graphicAt, t, now - this.lineAt);
      else rect(g, 0, 0, W, H, C.black);
      if (this.captions && this.speaking && this.line) drawCaption(g, this.line.text, this.speaking.progress(now));
      if (this.mode === 'sting') drawSting(g, age, LABEL[seg.kind], seg.title);
      if (this.mode === 'breaking') drawBreaking(g, age, this.breaking?.flash ?? '');
      return;
    }

    this.drawScene(seg, now);
    drawBug(g, name, !!bulletin.demo);
    drawClock(g, new Date(), t);
    if (this.strap) drawStrap(g, this.strap.name, this.strap.role, now - this.strap.at, this.strap.hold ? Infinity : undefined);
    if (this.captions && this.speaking && this.line) drawCaption(g, this.line.text, this.speaking.progress(now));
    const graphic = this.line?.graphic;
    drawHeadlineBar(g, LABEL[seg.kind], graphic?.type === 'headline' ? graphic.title : seg.strap);
    this.ticker.draw(g, this.tickerItems(), now);

    if (this.mode === 'sting') drawSting(g, age, LABEL[seg.kind], seg.title);
    if (this.mode === 'breaking') drawBreaking(g, age, this.breaking?.flash ?? '');
  }

  /** A goal: the ticker jumps to the score and flashes. */
  goal(): void {
    this.ticker.goal(performance.now());
  }

  /** The bulletin's headlines, with the live score first and again after every few. */
  private tickerItems(): TickerItem[] {
    const items: TickerItem[] = this.bulletin.ticker.map((text) => ({ text }));
    const match = this.live?.match();
    if (!match) return items;
    const score = { text: scoreLine(match), score: true };
    const out: TickerItem[] = [];
    items.forEach((it, i) => {
      if (i % SCORE_EVERY === 0) out.push(score);
      out.push(it);
    });
    return out.length ? out : [score];
  }

  /** Where our reporter is: among the home fans (ours at Tynecastle), under floodlights once it's dark. */
  private ground(): Ground {
    const m = this.live?.match();
    const { primary, secondary } = this.bulletin.channel.colours;
    return {
      colours: !m || m.us === 'home' ? [primary, secondary] : (kitColours(m.home.name) ?? [C.dark, C.light]),
      night: this.night ?? isDark(new Date()),
    };
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

      case 'pitchside': {
        const top = 30;
        const deskY = top + SEATED_DESK_Y * 3;
        drawStadium(g, this.ground(), t);
        const p = onScreen[0];
        if (p) drawPresenter(g, 92, top, p.look, pose(p), 3);
        drawPressDesk(g, deskY);
        if (p) drawHands(g, 92, deskY, 3, p.look.skin, lift(p), p.look.suit);
        if (graphic) drawGraphic(g, graphic, 168, 22, 142, 80, graphicAge, now);
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
