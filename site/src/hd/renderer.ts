import { panelGraphic, SdRenderer } from '../render/sd';
import type { FrameState, Mode, Renderer, Shot } from '../render/state';
import type { Graphic, Segment } from '../../../shared/bulletin';
import { COLUMN_SHIFT, SideColumn } from './column';
import { ASIDE, canSeat, drawDeskScene, drawStudioBackdrop, loadSeatedCast, type SeatedCast } from './desk';
import { GraphicBox, isNative } from './graphics';
import { HdMoments } from './moments';
import { drawHdAdvert, hdAdvert, preloadBreaks } from './advert';
import { canMuseum, drawMuseum, loadMuseum, museumGraphic, type MuseumArt } from './museum';
import { loadSet, type StudioSet } from './set';
import { canScene, drawScene, loadScene, screenGraphic, type SceneArt } from './touchscreen';

/** The HD art, once it has loaded. */
type Art = Readonly<{ set: StudioSet; cast: SeatedCast; museum?: MuseumArt; touch?: SceneArt; transfer?: SceneArt; wall?: SceneArt }>;

/**
 * How a frame is drawn. `hd`: the HD desk, with the line's graphic beside the presenter in a close-up (HD's own, else the
 * SD panel) or the side column. `hd-full`: a full-screen HD graphic over the dimmed studio (#87). `sd-scene`: the SD scene
 * without its bars (or an ad break's advert), under the HD furniture. `moment`: no picture, for the full-screen moments
 * (splash, ident, sponsor card: #86) that cover the frame, and a sting or break-in with nothing yet under it. `museum`: On
 * This Day at the HD museum with its standing presenter (#88): no side column, the line's graphic on the left. `touch`: the Match
 * Centre's HD touchscreen with its standing presenter (#92): the line's graphic on the screen.
 */
export type View = 'hd' | 'hd-full' | 'museum' | 'touch' | 'advert' | 'sd-scene' | 'moment';

/** The team sheet's cards: on the videowall, HD shows them full screen (teamNewsCard). */
const TEAM_NEWS: ReadonlySet<Graphic['type']> = new Set(['formation', 'bench', 'player']);

/**
 * The team news fallback (#87): when the videowall's HD scene can't be drawn (no standing art for the presenter), a videowall segment's team-news card
 * (the line's, else the segment's last, as the SD wall keeps it up) plays full screen over the dimmed HD studio instead
 * of the SD videowall. Undefined when there's no such card HD draws (a line before the first card): then the SD scene
 * shows as before.
 */
export function teamNewsCard(s: FrameState): Graphic | undefined {
  if (s.seg?.scene !== 'videowall') return undefined;
  const card = s.graphic ?? s.segGraphic;
  return card && TEAM_NEWS.has(card.type) && isNative(card) ? card : undefined;
}

/** What a full-screen HD view (`hd-full`) shows: the team-news card on the videowall, else the line's graphic. */
const fullGraphic = (s: FrameState) => teamNewsCard(s) ?? s.graphic;

/**
 * Which view this frame gets (#85, #87, #86). `moment` for the moments that cover the frame (splash, ident, sponsor), and
 * when there's no segment yet. The sting and the break-in flash play over the picture the segment would have had in a
 * show frame, so they get its view. The SD scene under the HD furniture for ad breaks, scenes HD can't draw (
 * pitchside, the touchscreen without standing art, and the videowall without a team-news card), a full-screen graphic HD doesn't draw yet, a
 * desk with someone who has no seated HD art, and anything until the art has loaded. `hd-full` for a
 * full-screen graphic HD draws and for the videowall's team-news cards (teamNewsCard). `museum` for the museum when its
 * backdrops have loaded and the presenter has standing art (else the SD museum). Otherwise HD.
 */
export function chooseView(s: FrameState, art: Art | undefined): View {
  if (HdMoments.covers(s.mode) || !s.seg) return 'moment';
  if (!art) return 'sd-scene';
  if (s.seg.kind === 'adverts') return hdAdvert(s) ? 'advert' : 'sd-scene';
  // The videowall's own HD scene (#92) when it can be drawn; else the team-news card full screen.
  if (s.seg.scene === 'videowall' && canScene(art.wall, s.onScreen)) return 'touch';
  if (teamNewsCard(s)) return 'hd-full';
  if (s.seg.scene === 'museum') return canMuseum(art.museum, s.onScreen) ? 'museum' : 'sd-scene';
  if (s.seg.scene === 'touchscreen') return canScene(art.touch, s.onScreen) ? 'touch' : 'sd-scene';
  if (s.seg.scene === 'transfer') return canScene(art.transfer, s.onScreen) ? 'touch' : 'sd-scene';
  if (s.seg.scene !== 'desk') return 'sd-scene';
  if (s.shot === 'full') return isNative(s.graphic) ? 'hd-full' : 'sd-scene';
  return canSeat(art.set, art.cast, s.onScreen) ? 'hd' : 'sd-scene';
}

const STYLE = `
.hd-frame { position: relative; aspect-ratio: 16 / 9; width: min(100vw, 100vh * 16 / 9); overflow: hidden; background: #0e0c10;
  font-size: calc(min(100vw, 100vh * 16 / 9) / 100); line-height: normal; }
.hd-scene { display: block; width: 100%; height: 100%; image-rendering: pixelated; transform-origin: 0 0; }
.hd-sd, .hd-layer { position: absolute; inset: 0; }
/* The SD renderer sizes its canvas to the window: here it fills the frame instead, at 1.5 HD pixels to each SD one. */
.hd-sd > canvas { display: block; width: 100% !important; height: 100% !important; image-rendering: pixelated; }
.hd-frame [hidden] { display: none !important; }
`;

/** Where the shot is centred across the frame while the side column is fully in. */
const WITH_COLUMN = 0.5 - COLUMN_SHIFT / 480;

/**
 * The HD look (#83): a 16:9 frame holding the 480×270 scene canvas, with HTML layers (the furniture, #84) above it. The frame's
 * font-size is a hundredth of its width, so layers can size themselves in em. The SD renderer's 320×180 canvas sits between
 * them, filling the same frame, for whatever HD can't draw yet (chooseView): a whole SD frame, an SD scene, or just a panel.
 * The HD graphics and the side column (#87) sit above that and under the layers.
 */
export class HdRenderer implements Renderer {
  private frame?: HTMLDivElement;
  private canvas?: HTMLCanvasElement;
  /** Holds the SD renderer's canvas. */
  private sdBox?: HTMLDivElement;
  private g?: CanvasRenderingContext2D;
  private style?: HTMLStyleElement;
  private readonly sd = new SdRenderer();
  private readonly layers: { layer: Renderer; box?: HTMLDivElement }[] = [];
  private art?: Art;
  private loading?: Promise<void>;
  /**
   * What the view was chosen for: it's only chosen again when the mode, segment, shot or graphic changes, so it never
   * flips mid-line.
   */
  private shown?: { mode: Mode; seg?: Segment; shot: Shot; graphic?: Graphic; ad: boolean; view: View };
  private transform = '';

  // The HD graphics (#87): their layer, the graphic panel, the side column and what was on last frame.
  private gfxRoot?: HTMLDivElement;
  private gfxResize?: ResizeObserver;
  private box?: GraphicBox;
  private column?: SideColumn;
  /** The full-screen moments (#86), above everything else in the frame. */
  private moments?: HdMoments;
  /** Start fetching the ad breaks' HD pictures (the player calls this once the bulletin is in, and when HD takes over). */
  preload(segments: readonly Segment[]): void {
    preloadBreaks(segments);
  }

  /** The S key's choice, kept over a remount. */
  private columnOn = true;
  /** The screen box last put on the graphics layer (placeScreen). */
  private screenBox?: { x: number; y: number; w: number; h: number };
  private sdPanel = false;
  private withColumn = false;
  /** The shot, speaker and view last frame: a change is a cut, and the column cuts with it rather than sliding. */
  private camKey = '';

  /** `dir` holds the baked set (set.json and its images). */
  constructor(private readonly dir = 'hd/') {}

  mount(container: HTMLElement): void {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.append(this.style);

    const frame = document.createElement('div');
    frame.className = 'hd-frame';
    const canvas = document.createElement('canvas');
    canvas.className = 'hd-scene';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Hearts News 24 broadcast');
    canvas.width = 480;
    canvas.height = 270;
    this.g = canvas.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
    const sdBox = document.createElement('div');
    sdBox.className = 'hd-sd';
    const gfx = document.createElement('div');
    gfx.className = 'hd-layer hdg';
    gfx.setAttribute('aria-hidden', 'true');
    frame.append(canvas, sdBox, gfx);
    container.append(frame);
    this.sd.mount(sdBox);
    this.frame = frame;
    this.canvas = canvas;
    this.sdBox = sdBox;
    this.gfxRoot = gfx;
    this.box = new GraphicBox(gfx);
    this.column = new SideColumn(gfx);
    this.column.on = this.columnOn;
    // Sized in em like the furniture: a hundredth of the frame's width.
    this.gfxResize = new ResizeObserver(() => {
      if (gfx.clientWidth) gfx.style.fontSize = `${gfx.clientWidth / 100}px`;
    });
    this.gfxResize.observe(gfx);
    for (const l of this.layers) this.mountLayer(l);
    this.moments = new HdMoments(frame);
    this.shown = undefined;
    this.show('moment');

    this.loading ??= this.load();
  }

  unmount(): void {
    for (const l of this.layers) {
      l.layer.unmount();
      l.box?.remove();
      l.box = undefined;
    }
    this.sd.unmount();
    this.gfxResize?.disconnect();
    this.moments?.remove();
    this.frame?.remove();
    this.style?.remove();
    this.frame = this.canvas = this.sdBox = this.g = this.style = this.shown = undefined;
    this.gfxRoot = this.gfxResize = this.box = this.column = this.moments = undefined;
    this.screenBox = undefined;
    this.transform = this.camKey = '';
    this.sdPanel = this.withColumn = false;
  }

  /** Add an HTML layer above the scene, e.g. the furniture. It's drawn after the scene each frame and hidden while the whole SD frame shows. */
  addLayer(layer: Renderer): void {
    const l = { layer };
    this.layers.push(l);
    if (this.frame) this.mountLayer(l);
  }

  /** The S key: the side column on or off (it slides). */
  toggleColumn(): void {
    this.columnOn = !this.columnOn;
    if (this.column) this.column.on = this.columnOn;
  }

  focus(): void {
    if (this.shown?.view === 'hd' || this.shown?.view === 'hd-full' || this.shown?.view === 'museum' || this.shown?.view === 'touch' || this.shown?.view === 'advert') this.canvas?.focus();
    else this.sd.focus();
  }

  /** The bulletin couldn't be loaded: there's no programme to draw. */
  offAir(): void {
    this.show('moment');
    this.moments?.offAir();
  }

  draw(s: FrameState, now: number): void {
    if (!this.frame) return;
    const { shown } = this;
    // An advert's HD picture may arrive after its line starts: the view is chosen again when it has.
    const ad = s.seg?.kind === 'adverts' && Boolean(hdAdvert(s));
    if (!shown || shown.mode !== s.mode || shown.seg !== s.seg || shown.shot !== s.shot || shown.graphic !== s.graphic || shown.ad !== ad) {
      const view = chooseView(s, this.art);
      this.shown = { mode: s.mode, seg: s.seg, shot: s.shot, graphic: s.graphic, ad, view };
      this.show(view);
    }
    const { view } = this.shown!;
    const camKey = `${view}|${s.shot}|${s.speaker?.id ?? ''}`;
    const cut = camKey !== this.camKey;
    this.camKey = camKey;

    if (view === 'moment' || view === 'sd-scene') {
      this.box!.clear();
      this.column!.hide(now);
      this.setColumnClass(false);
      if (view === 'sd-scene') this.sd.drawSceneOnly(s, now);
    } else if (view === 'advert') {
      // The backdrop at 480x270 on the HD canvas; the brand panel and fine print on the SD canvas over it.
      this.box!.clear();
      this.column!.hide(now);
      this.setColumnClass(false);
      this.setTransform('');
      const shownAd = hdAdvert(s);
      if (shownAd) drawHdAdvert(this.g!, shownAd.img);
      if (!this.sdPanel) this.sdBox!.hidden = !(this.sdPanel = true);
      this.sd.drawAdvertOverlayOnly(s, now);
    } else if (view === 'museum') {
      // The gallery's graphic goes on the left, the presenter on the right; no side column in the museum. A type HD
      // doesn't draw is the SD panel on the SD canvas over the scene.
      this.column!.hide(now);
      this.setColumnClass(false);
      this.setTransform('');
      drawMuseum(this.g!, this.art!.museum!, s, now);
      const graphic = museumGraphic(s);
      const native = isNative(graphic);
      this.box!.show(native ? graphic : undefined, 'left');
      const sdPanel = Boolean(graphic) && !native;
      if (sdPanel !== this.sdPanel) this.sdBox!.hidden = !(this.sdPanel = sdPanel);
      if (sdPanel) this.sd.drawMuseumPanelOnly(s, now);
    } else if (view === 'touch') {
      // The graphic goes on the screen, the presenter on the right; no side column. A type HD doesn't draw (and the idle
      // screen) is the SD panel on the SD canvas, in the same box.
      this.column!.hide(now);
      this.setColumnClass(false);
      this.setTransform('');
      const kind = s.seg!.scene;
      const scene = kind === 'transfer' ? this.art!.transfer! : kind === 'videowall' ? this.art!.wall! : this.art!.touch!;
      const card = screenGraphic(s);
      drawScene(this.g!, scene, s, now);
      this.placeScreen(scene.data.screen);
      const native = isNative(card);
      this.box!.show(native ? card : undefined, 'screen');
      if (this.sdPanel === native) this.sdBox!.hidden = !(this.sdPanel = !native);
      if (this.sdPanel) {
        const b = scene.data.screen;
        const label = kind === 'transfer' ? 'TRANSFER CENTRE' : kind === 'videowall' ? s.seg!.title : 'MATCH CENTRE';
        this.sd.drawTouchPanelOnly(s, now, label, card, [Math.round(b.x / 1.5), Math.round(b.y / 1.5), Math.round(b.w / 1.5), Math.round(b.h / 1.5)]);
      }
    } else if (view === 'hd-full') {
      this.column!.hide(now);
      this.setColumnClass(false);
      this.setTransform(drawStudioBackdrop(this.g!, this.art!.set));
      this.box!.show(fullGraphic(s), 'full');
    } else {
      // A close-up with a graphic of its own puts it beside the presenter, who moves left (ASIDE); otherwise the side
      // column is in and the studio moves left for it. Never both: a panel waits for the column to have gone.
      const panel = s.shot === 'single' ? panelGraphic(s) : undefined;
      const q = this.column!.update(s.sidebar, !panel, now, cut);
      const rest = panel ? ASIDE : 0.5;
      this.setTransform(drawDeskScene(this.g!, this.art!.set, this.art!.cast, s, now, rest + (WITH_COLUMN - rest) * q));
      this.setColumnClass(q > 0.5);
      const up = panel && q === 0 ? panel : undefined;
      const native = isNative(up);
      this.box!.show(native ? up : undefined, 'beside');
      // A type HD doesn't draw yet: the SD panel, on the SD canvas over the scene so the camera's zoom doesn't take it.
      const sdPanel = Boolean(up) && !native;
      if (sdPanel !== this.sdPanel) this.sdBox!.hidden = !(this.sdPanel = sdPanel);
      if (sdPanel) this.sd.drawPanelOnly(s, now);
    }
    for (const l of this.layers) l.layer.draw(s, now);
    this.moments!.draw(s, now);
  }

  /** Load the HD art (once; mount does too) and say whether it's there. The toggle (#65) stays on SD when it isn't, and a retry loads again. */
  async ready(): Promise<boolean> {
    this.loading ??= this.load();
    await this.loading;
    if (!this.art) this.loading = undefined;
    return !!this.art;
  }

  private async load(): Promise<void> {
    try {
      const set = await loadSet(this.dir);
      const cast = await loadSeatedCast(set);
      // The museum is optional: without it On This Day stays on the SD scenes.
      const museum = await loadMuseum(this.dir, set.museum, set.points).catch((err) => {
        console.error(err);
        return undefined;
      });
      const touch = await loadScene(this.dir, set.touchscreen, set.points).catch((err) => {
        console.error(err);
        return undefined;
      });
      const transfer = await loadScene(this.dir, set.transfer, set.points).catch((err) => {
        console.error(err);
        return undefined;
      });
      const wall = await loadScene(this.dir, set.videowall, set.points).catch((err) => {
        console.error(err);
        return undefined;
      });
      this.art = { set, cast, museum, touch, transfer, wall };
    } catch (err) {
      // Stays on the SD scenes.
      console.error(err);
    }
  }

  /** Put a screen scene's box (art pixels) on the graphics layer, when it changes, as --screen-* in em (4.8 art pixels each): the box the graphic goes over. */
  private placeScreen(box: { x: number; y: number; w: number; h: number }): void {
    if (box === this.screenBox || !this.gfxRoot) return;
    this.screenBox = box;
    for (const [k, v] of [['x', box.x], ['y', box.y], ['w', box.w], ['h', box.h]] as const) this.gfxRoot.style.setProperty(`--screen-${k}`, `${v / 4.8}em`);
  }

  private mountLayer(l: { layer: Renderer; box?: HTMLDivElement }): void {
    const box = document.createElement('div');
    box.className = 'hd-layer';
    box.hidden = !this.shown || this.shown.view === 'moment';
    this.frame!.append(box);
    l.layer.mount(box);
    l.box = box;
  }

  private setTransform(transform: string): void {
    if (transform !== this.transform) this.canvas!.style.transform = this.transform = transform;
  }

  /** The captions stop short of the column while it's in. */
  private setColumnClass(on: boolean): void {
    if (on === this.withColumn) return;
    this.withColumn = on;
    this.frame!.classList.toggle('hd-col', on);
  }

  /** Show what `view` draws on: the HD scene or the SD canvas (an HD close-up's SD panel is shown by draw), and the layers unless it's the whole SD frame. */
  private show(view: View): void {
    const hd = view === 'hd' || view === 'hd-full' || view === 'museum' || view === 'touch' || view === 'advert';
    if (this.canvas) this.canvas.hidden = !hd;
    if (this.sdBox) this.sdBox.hidden = hd;
    this.sdPanel = false;
    if (this.gfxRoot) this.gfxRoot.hidden = view === 'moment';
    for (const l of this.layers) if (l.box) l.box.hidden = view === 'moment';
    if (this.shown) this.shown.view = view;
  }
}
