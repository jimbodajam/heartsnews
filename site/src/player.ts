import type { BreakingPackage } from '../../shared/breaking';
import type { Weather } from '../../shared/weather';
import type { Bulletin, Graphic, Line, Presenter, Segment } from '../../shared/bulletin';
import { playSting } from './audio/sting';
import type { Speaking, Voices } from './audio/voice';
import { isFresh } from './breaking';
import { BREAKING_MS, breakingLook, IDENT_MS, STING_MS, Ticker, type BreakingLook, type TickerItem } from './gfx/overlay';
import { type LiveScore, scoreLine } from './live';
import { preloadAdvert } from './gfx/adverts';
import type { SponsorKind } from './gfx/sponsor';
import { C } from './gfx/palette';
import { type Ground, isDark } from './gfx/stadium';
import { kitColours } from '../../shared/kits';
import type { FrameState, Mode, Renderer, Shot } from './render/state';

/** The sponsor's announcer: a fixed line pre-rendered with Kokoro (`npm run sponsor-clip`), not one of the presenters. */
const SPONSOR_LINE = "Hearts News 24, in association with Marshall's Chunky Chicken.";
const SPONSOR_CLIP = new URL('sponsor/marshalls-bm_lewis.mp3', document.baseURI).href;
/** The jingle itself, from the old advert: three chants of 'Marshalls, the chunky chicken champions' at the show open, one around ad breaks. */
const SPONSOR_JINGLE = new URL('sponsor/jingle.mp3', document.baseURI).href;
const SPONSOR_JINGLE_SHORT = new URL('sponsor/jingle-short.mp3', document.baseURI).href;
const SPONSOR_VOICE: Presenter = {
  id: 'sponsor', name: 'Announcer', role: 'Announcer', voice: 'male', tts: { voice: 'bm_lewis' },
  look: { build: 'male', skin: '#e8b796', hair: '#3a2a1a', hairStyle: 'short', suit: '#2b3160', shirt: '#f2efe6' },
};

/** The live score comes round in the ticker after every this many headlines. */
const SCORE_EVERY = 3;

const FULLSCREEN:Graphic['type'][] = ['table', 'fixtures', 'sentiment', 'result', 'transfer', 'quote', 'predictions', 'form', 'headtohead', 'formation'];

/** The same graphic again (bulletin JSON has no shared objects): an advert by its id, anything else by content. */
function sameGraphic(a?: Graphic, b?: Graphic): boolean {
  if (!a || !b) return a === b;
  if (a.type === 'advert' && b.type === 'advert') return a.id === b.id;
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Plays a bulletin on a loop: ident → for each segment, a sting then each line spoken by its presenter.
 * Playback runs as an async sequence; every animation frame the renderer draws a snapshot of the current state.
 */
export class Player {
  captions = true;
  status = 'CLICK TO TUNE IN';
  /** Optional painted studio background (from `npm run pixelate`); `classicStudio` switches back to the code-drawn set. */
  studioImage?: HTMLImageElement;
  classicStudio = false;
  /** On This Day's set (art/Museum, pixelated): the front of the museum for the opening line, then the gallery. */
  museum: { front?: HTMLImageElement; inside?: HTMLImageElement } = {};
  /** Today's match, if the live feed is on: its score comes round in the ticker. */
  live?: LiveScore;
  /** Forces the floodlights on or off at the ground (?night=1 or 0); otherwise it goes by the time of day. */
  night?: boolean;
  /** Forces the weather at the ground (?weather=rain, ?weather=snow,windy…); otherwise it's the break-in's, if it has any. */
  weather?: Pick<Weather, 'sky' | 'windy'>;

  private ticker = new Ticker();
  private mode: Mode = 'splash';
  private sponsorKind: SponsorKind = 'open';
  /** Marshall's logo (art/adverts/Marshalls, pixelated); the card draws its own badge without it. */
  sponsorLogo?: HTMLImageElement;
  private jingleAt = 0;
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
    /** The screen the renderer's elements live in. */
    private screen: HTMLElement,
    /** Already mounted in `screen`. */
    private renderer: Renderer,
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

  /** Switch to another renderer, mid-show if need be: the old one's elements make way for the new one's. */
  setRenderer(r: Renderer): void {
    if (r === this.renderer) return;
    this.renderer.unmount();
    r.mount(this.screen);
    this.renderer = r;
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
      this.sting('breaking', breakingLook(p.flash));
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

  private setMode(mode: Mode): void {
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
    this.voices.preload(SPONSOR_CLIP).catch(() => undefined);
    this.voices.preload(SPONSOR_JINGLE).catch(() => undefined);
    this.voices.preload(SPONSOR_JINGLE_SHORT).catch(() => undefined);
    for (const seg of this.bulletin.segments) {
      for (const line of seg.lines) {
        const url = this.clipUrl(line);
        if (url) this.voices.preload(url).catch(() => undefined);
        if (line.graphic?.type === 'advert') preloadAdvert(line.graphic);
      }
    }
  }

  private sting(kind: 'ident' | 'segment' | 'breaking', look?: BreakingLook): void {
    if (!this.voices.muted) playSting(kind, look);
  }

  /** Marshall's Chunky Chicken: the announcer reads the sponsor line over the card, then the jingle plays. */
  private async sponsor(kind: SponsorKind): Promise<void> {
    this.sponsorKind = kind;
    this.jingleAt = 0;
    this.setMode('sponsor');
    this.speaking = this.voices.speak(SPONSOR_LINE, SPONSOR_VOICE, SPONSOR_CLIP);
    await this.speaking.done;
    this.speaking = undefined;
    // The jingle: the full thing as the show opens, one chant of it either side of an ad break.
    this.jingleAt = performance.now();
    this.speaking = this.voices.speak('', SPONSOR_VOICE, kind === 'open' ? SPONSOR_JINGLE : SPONSOR_JINGLE_SHORT);
    await this.speaking.done;
    this.speaking = undefined;
    await this.wait(200);
    this.jingleAt = 0;
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
        await this.sponsor('open');
      }
      startAt = undefined;

      let afterBreak = false;
      for (const seg of this.bulletin.segments.slice(first)) {
        this.seg = seg;
        this.line = undefined;
        this.segGraphic = undefined;
        this.shot = 'wide';
        this.strap = undefined;
        this.strapped.clear();
        // The sponsor's card stands in for the segment sting going into and coming out of an ad break.
        if (seg.kind === 'adverts') {
          await this.sponsor('in');
        } else if (afterBreak) {
          await this.sponsor('out');
        } else {
          this.setMode('sting');
          this.sting('segment');
          await this.wait(STING_MS);
        }
        afterBreak = seg.kind === 'adverts';
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
    if (seg.kind === 'adverts' || line.speaker.startsWith('caller-')) {
      this.strap = undefined;
    } else if (seg.scene === 'pitchside') {
      // At the ground the strap says where we are, and stays up.
      const venue = this.live?.match()?.venue;
      if (this.strap?.name !== p.name) this.strap = { name: p.name, role: venue ? `LIVE: ${venue}` : 'LIVE FROM THE GROUND', at: performance.now(), hold: true };
    } else if (!this.strapped.has(p.id)) {
      this.strapped.add(p.id);
      this.strap = { name: p.name, role: seg.scene === 'videowall' ? 'TEAM NEWS' : p.role, at: performance.now() };
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
    // The caller isn't at the desk: both pundits stay in the wide shot while they talk.
    if (line.graphic?.type === 'caller') return line.speaker.startsWith('caller-') ? 'wide' : 'single';
    if (line.graphic) return FULLSCREEN.includes(line.graphic.type) ? 'full' : 'single';
    if (i === 0) return 'wide';
    return i % 2 ? 'single' : 'wide';
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    this.renderer.draw(this.state(now), now);
    requestAnimationFrame(this.frame);
  };

  /** This frame's snapshot for the renderer. */
  private state(now: number): FrameState {
    const { seg, line, strap, speaking } = this;
    return {
      mode: this.mode,
      modeAge: now - this.modeAt,
      status: this.status,
      channel: this.bulletin.channel.name,
      demo: !!this.bulletin.demo,
      captions: this.captions,
      seg,
      line,
      lineAge: now - this.lineAt,
      shot: this.shot,
      strap: strap && { name: strap.name, role: strap.role, age: now - strap.at, hold: strap.hold },
      speaking,
      talking: speaking ? line?.speaker : undefined,
      graphic: line?.graphic,
      graphicAge: now - this.graphicAt,
      segGraphic: this.segGraphic,
      sidebar: this.bulletin.sidebar,
      ticker: this.ticker,
      tickerItems: this.tickerItems(),
      ground: this.ground(),
      breakingFlash: this.breaking?.flash ?? '',
      sponsorKind: this.sponsorKind,
      jingleAge: this.jingleAt ? now - this.jingleAt : -1,
      cast: this.bulletin.presenters,
      onScreen: seg ? seg.presenters.map((id) => this.presenter(id)) : [],
      speaker: line && this.presenter(line.speaker),
      studioImage: this.studioImage,
      classicStudio: this.classicStudio,
      museum: this.museum,
      sponsorLogo: this.sponsorLogo,
    };
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
      weather: this.weather ?? this.breaking?.weather,
    };
  }
}
