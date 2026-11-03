import { hasSdPanel, SdRenderer } from '../render/sd';
import type { FrameState, Mode, Renderer, Shot } from '../render/state';
import type { Segment } from '../../../shared/bulletin';
import { canSeat, drawDeskScene, loadSeatedCast, type SeatedCast } from './desk';
import { loadSet, type StudioSet } from './set';

/** The HD art, once it has loaded. */
type Art = Readonly<{ set: StudioSet; cast: SeatedCast }>;

/**
 * How a frame is drawn. `hd`: the HD desk, with the SD side panel beside the presenter in a close-up. `sd-scene`: the SD
 * scene without its bars (or an ad break's advert), under the HD furniture. `sd-frame`: the whole SD frame, bars and all.
 */
export type View = 'hd' | 'sd-scene' | 'sd-frame';

/**
 * Which view this frame gets (#85). The whole SD frame for anything but a show frame (splash, ident, sponsor, sting,
 * breaking flash) until #86. The SD scene under the HD furniture for ad breaks, scenes HD can't draw (transfer,
 * touchscreen, videowall, pitchside, museum), a desk with someone who has no HD art (Ross in the debate), the full-screen
 * graphic shot until #87, and the desk until the art has loaded. Otherwise HD.
 */
export function chooseView(s: FrameState, art: Art | undefined): View {
  if (s.mode !== 'show' || !s.seg) return 'sd-frame';
  if (s.seg.kind === 'adverts' || s.seg.scene !== 'desk' || s.shot === 'full' || !art) return 'sd-scene';
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

/**
 * The HD look (#83): a 16:9 frame holding the 480×270 scene canvas, with HTML layers (the furniture, #84) above it. The frame's
 * font-size is a hundredth of its width, so layers can size themselves in em. The SD renderer's 320×180 canvas sits between
 * them, filling the same frame, for whatever HD can't draw yet (chooseView): a whole SD frame, an SD scene, or just a panel.
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
  /** What the view was chosen for: it's only chosen again when the mode, segment or shot changes, so it never flips mid-line. */
  private shown?: { mode: Mode; seg?: Segment; shot: Shot; view: View };
  private transform = '';

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
    frame.append(canvas, sdBox);
    container.append(frame);
    this.sd.mount(sdBox);
    this.frame = frame;
    this.canvas = canvas;
    this.sdBox = sdBox;
    for (const l of this.layers) this.mountLayer(l);
    this.shown = undefined;
    this.show('sd-frame', 'wide');

    this.loading ??= this.load();
  }

  unmount(): void {
    for (const l of this.layers) {
      l.layer.unmount();
      l.box?.remove();
      l.box = undefined;
    }
    this.sd.unmount();
    this.frame?.remove();
    this.style?.remove();
    this.frame = this.canvas = this.sdBox = this.g = this.style = this.shown = undefined;
    this.transform = '';
  }

  /** Add an HTML layer above the scene, e.g. the furniture. It's drawn after the scene each frame and hidden while the whole SD frame shows. */
  addLayer(layer: Renderer): void {
    const l = { layer };
    this.layers.push(l);
    if (this.frame) this.mountLayer(l);
  }

  focus(): void {
    if (this.shown?.view === 'hd') this.canvas?.focus();
    else this.sd.focus();
  }

  /** The bulletin couldn't be loaded: there's no programme to draw. */
  offAir(): void {
    this.show('sd-frame', 'wide');
    this.sd.offAir();
  }

  draw(s: FrameState, now: number): void {
    if (!this.frame) return;
    const { shown } = this;
    if (!shown || shown.mode !== s.mode || shown.seg !== s.seg || shown.shot !== s.shot) {
      const view = chooseView(s, this.art);
      this.shown = { mode: s.mode, seg: s.seg, shot: s.shot, view };
      this.show(view, s.shot);
    }
    const { view } = this.shown!;
    if (view === 'sd-frame') return this.sd.draw(s, now);

    if (view === 'sd-scene') {
      this.sd.drawSceneOnly(s, now);
    } else {
      // A close-up's side panel goes on the SD canvas over the scene, so the camera's zoom doesn't take it, and the
      // camera moves the presenter left to make room.
      const panel = s.shot === 'single' && hasSdPanel(s);
      const transform = drawDeskScene(this.g!, this.art!.set, this.art!.cast, s, now, panel);
      if (transform !== this.transform) this.canvas!.style.transform = this.transform = transform;
      if (s.shot === 'single') this.sd.drawPanelOnly(s, now);
    }
    for (const l of this.layers) l.layer.draw(s, now);
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
      this.art = { set, cast: await loadSeatedCast(set) };
    } catch (err) {
      // Stays on the SD scenes.
      console.error(err);
    }
  }

  private mountLayer(l: { layer: Renderer; box?: HTMLDivElement }): void {
    const box = document.createElement('div');
    box.className = 'hd-layer';
    box.hidden = !this.shown || this.shown.view === 'sd-frame';
    this.frame!.append(box);
    l.layer.mount(box);
    l.box = box;
  }

  /** Show what `view` draws on: the HD scene or the SD canvas (both for an HD close-up's panel), and the layers unless it's the whole SD frame. */
  private show(view: View, shot: Shot): void {
    if (this.canvas) this.canvas.hidden = view !== 'hd';
    if (this.sdBox) this.sdBox.hidden = view === 'hd' && shot !== 'single';
    for (const l of this.layers) if (l.box) l.box.hidden = view === 'sd-frame';
    if (this.shown) this.shown.view = view;
  }
}
