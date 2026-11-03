import { SdRenderer } from '../render/sd';
import type { FrameState, Mode, Renderer, Shot } from '../render/state';
import type { Segment } from '../../../shared/bulletin';
import { canSeat, drawDeskScene, loadSeatedCast, type SeatedCast } from './desk';
import { loadSet, type StudioSet } from './set';

/** The HD art, once it has loaded. */
type Art = Readonly<{ set: StudioSet; cast: SeatedCast }>;

/**
 * Whether HD can't draw this frame, so the whole SD frame goes in its place: anything but a show frame (splash, ident, sponsor,
 * sting, breaking), ad breaks, scenes other than the desk, a desk with someone who has no HD art (Ross in the debate),
 * the full-screen graphic shot, and everything until the art has loaded. Stand-in until the per-scene fallback in #85.
 */
export function needsSdFrame(s: FrameState, art: Art | undefined): boolean {
  if (!art || s.mode !== 'show' || !s.seg) return true;
  if (s.seg.kind === 'adverts' || s.seg.scene !== 'desk' || s.shot === 'full') return true;
  return !canSeat(art.set, art.cast, s.onScreen);
}

const STYLE = `
.hd-frame { position: relative; aspect-ratio: 16 / 9; width: min(100vw, 100vh * 16 / 9); overflow: hidden; background: #0e0c10;
  font-size: calc(min(100vw, 100vh * 16 / 9) / 100); line-height: normal; }
.hd-scene { display: block; width: 100%; height: 100%; image-rendering: pixelated; transform-origin: 0 0; }
.hd-sd, .hd-layer { position: absolute; inset: 0; }
/* The SD renderer sizes its canvas to the window: here it fills the frame instead. */
.hd-sd > canvas { display: block; width: 100% !important; height: 100% !important; }
.hd-frame [hidden] { display: none !important; }
`;

/**
 * The HD look (#83): a 16:9 frame holding the 480×270 scene canvas, with HTML layers (the furniture, #84) above it. The frame's
 * font-size is a hundredth of its width, so layers can size themselves in em. Until its art has loaded, and for anything it
 * can't draw yet (needsSdFrame), it shows the SD renderer's frame in its place.
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
  /** What the SD-or-HD choice was made for: it's only made again when the mode, segment or shot changes, so it never flips mid-line. */
  private shown?: { mode: Mode; seg?: Segment; shot: Shot; sd: boolean };
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
    this.showSd(true);

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

  /** Add an HTML layer above the scene, e.g. the furniture. It's drawn after the scene each frame and hidden while the SD frame shows. */
  addLayer(layer: Renderer): void {
    const l = { layer };
    this.layers.push(l);
    if (this.frame) this.mountLayer(l);
  }

  focus(): void {
    if (this.shown?.sd === false) this.canvas?.focus();
    else this.sd.focus();
  }

  /** The bulletin couldn't be loaded: there's no programme to draw. */
  offAir(): void {
    this.showSd(true);
    this.sd.offAir();
  }

  draw(s: FrameState, now: number): void {
    if (!this.frame) return;
    const { shown } = this;
    if (!shown || shown.mode !== s.mode || shown.seg !== s.seg || shown.shot !== s.shot) {
      const sd = needsSdFrame(s, this.art);
      this.shown = { mode: s.mode, seg: s.seg, shot: s.shot, sd };
      this.showSd(sd);
    }
    if (this.shown!.sd) return this.sd.draw(s, now);

    const transform = drawDeskScene(this.g!, this.art!.set, this.art!.cast, s, now);
    if (transform !== this.transform) this.canvas!.style.transform = this.transform = transform;
    for (const l of this.layers) l.layer.draw(s, now);
  }

  private async load(): Promise<void> {
    try {
      const set = await loadSet(this.dir);
      this.art = { set, cast: await loadSeatedCast(set) };
    } catch (err) {
      // Stays on the SD frame.
      console.error(err);
    }
  }

  private mountLayer(l: { layer: Renderer; box?: HTMLDivElement }): void {
    const box = document.createElement('div');
    box.className = 'hd-layer';
    box.hidden = this.shown?.sd !== false;
    this.frame!.append(box);
    l.layer.mount(box);
    l.box = box;
  }

  /** Show the SD frame, or the HD scene and its layers. */
  private showSd(sd: boolean): void {
    if (this.canvas) this.canvas.hidden = sd;
    if (this.sdBox) this.sdBox.hidden = !sd;
    for (const l of this.layers) if (l.box) l.box.hidden = sd;
    if (this.shown) this.shown.sd = sd;
  }
}
