import './moments.css';
import { SEGMENT_LABEL } from '../gfx/labels';
import { BREAKING_MS, IDENT_MS, STING_MS } from '../gfx/overlay';
import type { SponsorKind } from '../gfx/sponsor';
import type { FrameState, Mode } from '../render/state';

const easeOut = (v: number) => 1 - (1 - v) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** One SD pixel on the 320-wide screen is 100 / 320 em of the HD frame; the timings below are the SD ones, in ms. */
const SD_PX = 100 / 320;
/** The wipe off the breaking card, as SD's. */
const WIPE_MS = 260;
/** The channel's name when there is no bulletin to ask (OFF AIR). */
const DEFAULT_NAME = 'HEARTS NEWS 24';

const TAG: Record<SponsorKind, string> = { open: 'HEARTS NEWS 24', in: 'BACK AFTER THIS', out: 'WELCOME BACK' };

/** The 7×6 heart logo as crisp rectangles: the SD one's shape at any size. */
const HEART_PATH = 'M1 0h2v1h-2zM4 0h2v1h-2zM0 1h7v2h-7zM1 3h5v1h-5zM2 4h3v1h-3zM3 5h1v1h-1z';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.append(e);
  return e;
}

function heart(cls: string, parent: HTMLElement): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 7 6');
  svg.setAttribute('class', `heart ${cls}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', HEART_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  parent.append(svg);
  return svg;
}

/** "HEARTS NEWS 24" as the white name and the gold number. */
function splitName(name: string): [string, string] {
  const m = /^(.*?)\s*(\d+)$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

/**
 * Writes to the DOM only what has changed since last time: a style value or some text, each under a key. A frame in which
 * nothing moved costs a few comparisons.
 */
class Writes {
  private readonly seen = new Map<string, string>();

  style(key: string, e: HTMLElement | SVGElement, prop: string, value: string): void {
    if (this.seen.get(key) === value) return;
    this.seen.set(key, value);
    e.style.setProperty(prop, value);
  }

  text(key: string, e: HTMLElement, value: string): void {
    if (this.seen.get(key) === value) return;
    this.seen.set(key, value);
    e.textContent = value;
  }

  flag(key: string, e: HTMLElement, cls: string, on: boolean): void {
    const v = on ? '1' : '0';
    if (this.seen.get(key) === v) return;
    this.seen.set(key, v);
    e.classList.toggle(cls, on);
  }

  hide(key: string, e: HTMLElement, hidden: boolean): void {
    const v = hidden ? '1' : '0';
    if (this.seen.get(key) === v) return;
    this.seen.set(key, v);
    e.hidden = hidden;
  }

  /** Forget what was written under keys starting `prefix`, e.g. after the elements they were written to are replaced. */
  forget(prefix: string): void {
    for (const k of this.seen.keys()) if (k.startsWith(prefix)) this.seen.delete(k);
  }
}

/** The channel name in two colours, typed out left to right while the whole of it holds its place so it never shifts. */
class Name {
  readonly root: HTMLElement;
  private readonly typed: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly num: HTMLElement;

  constructor(cls: string, parent: HTMLElement, private readonly w: Writes, private readonly key: string) {
    this.root = el('div', `name ${cls}`, parent);
    this.typed = el('span', 'w', this.root);
    this.rest = el('span', 'ghost', this.root);
    this.num = el('span', 'n', this.root);
  }

  /** `chars` of the white part showing; `showNum` brings the gold number in. */
  set(name: string, chars: number, showNum: boolean): void {
    const [main, num] = splitName(name);
    const n = Math.max(0, Math.min(main.length, chars));
    this.w.text(`${this.key}.t`, this.typed, main.slice(0, n));
    this.w.text(`${this.key}.r`, this.rest, main.slice(n));
    this.w.text(`${this.key}.n`, this.num, num ? ` ${num}` : '');
    this.w.style(`${this.key}.nv`, this.num, 'visibility', showNum ? 'visible' : 'hidden');
  }
}

/**
 * The HD full-screen moments (#86): the splash, the ident, the Marshall's Chunky Chicken card, the segment sting and the
 * breaking flash, as HTML over the frame in the stack's style. The same ideas, timings (IDENT_MS, STING_MS, BREAKING_MS, the
 * player's jingle clock) and sounds as SD's. The splash, ident and sponsor card cover the frame; the sting and the flash
 * play over whatever HD picture is under them. Like the furniture, `draw` only writes what has changed.
 */
export class HdMoments {
  private readonly root: HTMLDivElement;
  private readonly w = new Writes();
  private readonly screens = new Map<Mode, HTMLElement>();

  // Splash
  private readonly splashName: Name;
  private readonly splashStatus: HTMLElement;

  // Ident
  private readonly identHeart: SVGElement;
  private readonly identName: Name;
  private readonly identTag: HTMLElement;
  private readonly identFade: HTMLElement;

  // Sponsor
  private readonly spRays: HTMLElement;
  private readonly spTag: HTMLElement;
  private readonly spLogoBox: HTMLElement;
  private readonly spLogo: HTMLImageElement;
  private readonly spFallback: HTMLElement;
  private readonly spChamp: HTMLElement;

  // Sting
  private readonly stScrim: HTMLElement;
  private readonly stBand: HTMLElement;
  private readonly stLabel: HTMLElement;
  private readonly stTitle: HTMLElement;

  // Breaking
  private readonly bkCard: HTMLElement;
  private readonly bkShake: HTMLElement;
  private readonly bkPanel: HTMLElement;
  private readonly bkHeart: HTMLElement;
  private readonly bkWord: HTMLElement;
  private bkLines: HTMLElement[] = [];
  private readonly bkStrip: HTMLElement;
  private readonly bkStripName: HTMLElement;
  private readonly bkFlash: HTMLElement;
  private readonly bkEdge: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = el('div', 'hdm', parent);
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;
    this.root = root;
    const screen = (mode: Mode, cls: string) => {
      const s = el('div', `scr ${cls}`, root);
      s.hidden = true;
      this.screens.set(mode, s);
      return s;
    };

    // Splash: the channel's heart and name, the status blinking under them and the keys.
    const splash = screen('splash', 'maroon splash');
    heart('gold lg', splash);
    this.splashName = new Name('big', splash, this.w, 'sn');
    this.splashStatus = el('div', 'status', splash);
    const keys = el('div', 'keys', splash);
    el('div', '', keys).textContent = 'M MUTE   C CAPTIONS   > SKIP   F FULLSCREEN   T RETRO TV';
    // HD's own keys, which SD doesn't have.
    el('div', '', keys).textContent = 'H HD   S SIDE COLUMN';

    // Ident: the heart pops in, the name types out, the line under it, then a fade to black.
    const ident = screen('ident', 'maroon ident');
    this.identHeart = heart('gold', ident);
    this.identName = new Name('big', ident, this.w, 'in');
    this.identTag = el('div', 'tagline', ident);
    this.identTag.textContent = 'ROLLING NEWS FROM GORGIE';
    this.identFade = el('div', 'fade', ident);

    // Sponsor: the painted badge on rays, under a bar with the break's tag.
    const sponsor = screen('sponsor', 'sponsor');
    this.spRays = el('div', 'rays', sponsor);
    const bar = el('div', 'bar', sponsor);
    this.spTag = el('span', '', bar);
    this.spLogoBox = el('div', 'logobox', sponsor);
    this.spLogo = el('img', 'logo', this.spLogoBox);
    this.spLogo.alt = '';
    this.spLogo.draggable = false;
    // Without the painted logo: the name in lettering, as the SD fallback has it.
    this.spFallback = el('div', 'fallback', this.spLogoBox);
    el('div', 'one', this.spFallback).textContent = "MARSHALL'S";
    el('div', 'two', this.spFallback).textContent = 'CHUNKY CHICKEN';
    this.spChamp = el('div', 'champ', sponsor);
    this.spChamp.textContent = 'CHAMPION CHICKEN';

    // Sting: a maroon band sweeps across the picture with the segment's label and title.
    const sting = screen('sting', 'sting');
    this.stScrim = el('div', 'scrim', sting);
    this.stBand = el('div', 'band px', sting);
    this.stLabel = el('div', 'label', this.stBand);
    this.stTitle = el('div', 'title', this.stBand);

    // Breaking: the maroon card with the word on the left, the gold panel and heart on the right.
    const breaking = screen('breaking', 'breaking');
    this.bkCard = el('div', 'card', breaking);
    this.bkShake = el('div', 'shake', this.bkCard);
    this.bkPanel = el('div', 'panel', this.bkShake);
    el('div', 'edge', this.bkPanel);
    el('div', 'gold', this.bkPanel);
    el('div', 'shine', this.bkPanel);
    const hb = el('div', 'hbox', this.bkPanel);
    this.bkHeart = hb;
    heart('dark', hb);
    this.bkWord = el('div', 'word', this.bkShake);
    this.bkStrip = el('div', 'strip', this.bkCard);
    heart('gold tiny', this.bkStrip);
    this.bkStripName = el('span', '', this.bkStrip);
    this.bkFlash = el('div', 'flash', this.bkCard);
    this.bkEdge = el('div', 'wipe-edge', breaking);
  }

  remove(): void {
    this.root.remove();
  }

  /** The bulletin couldn't be loaded: the splash says OFF AIR. */
  offAir(): void {
    this.root.hidden = false;
    this.show('splash');
    this.splash(DEFAULT_NAME, 'OFF AIR', 0);
  }

  /** Whether a mode is one of the full-screen ones: they cover the frame, so the HD picture needn't be drawn under them. */
  static covers(mode: Mode): boolean {
    return mode === 'splash' || mode === 'ident' || mode === 'sponsor';
  }

  draw(s: FrameState, now: number): void {
    const mode = s.mode;
    const on = mode !== 'show';
    this.w.hide('root', this.root, !on);
    if (!on) return;
    this.show(mode);
    const age = s.modeAge;
    switch (mode) {
      case 'splash': return this.splash(s.channel, s.status, now / 1000);
      case 'ident': return this.ident(s.channel, age);
      case 'sponsor': return this.sponsor(s, age);
      case 'sting': return this.sting(s, age);
      case 'breaking': return this.breaking(s, age);
    }
  }

  private show(mode: Mode): void {
    for (const [m, e] of this.screens) this.w.hide(`scr.${m}`, e, m !== mode);
  }

  private splash(channel: string, status: string, t: number): void {
    this.splashName.set(channel, Infinity, true);
    this.w.text('sp.status', this.splashStatus, status);
    // Blinks as SD's does: on for 0.8 s of every 1.2.
    this.w.style('sp.blink', this.splashStatus, 'visibility', t % 1.2 < 0.8 ? 'visible' : 'hidden');
  }

  /** Heart popping in over 0.5 s (a size in eighths, as SD's whole pixels), the name typing from 0.6 s, the number at 1.6, the line at 2.1, the fade over the last 0.3. */
  private ident(channel: string, age: number): void {
    const pop = clamp01(age / 500);
    const s = Math.max(1, Math.round(8 * (pop < 1 ? easeOut(pop) * 1.15 : 1)));
    this.w.style('id.heart', this.identHeart, 'transform', `translate(-50%, -50%) scale(${s / 8})`);
    const [main] = splitName(channel);
    this.identName.set(channel, Math.floor(clamp01((age - 600) / 900) * main.length), age > 1600);
    this.w.style('id.tag', this.identTag, 'visibility', age > 2100 ? 'visible' : 'hidden');
    const fade = age > IDENT_MS - 300 ? clamp01((age - (IDENT_MS - 300)) / 300) : 0;
    this.w.style('id.fade', this.identFade, 'opacity', String(Math.round(fade * 6) / 6));
  }

  /**
   * The card for an ad break or the opening. The badge drops in over 0.35 s and bobs on the jingle's beat; the rays turn
   * slowly, then at jingle speed (carrying on from where they were, rather than jumping as SD's formula does); the
   * line under comes in after 0.9 s.
   */
  private sponsor(s: FrameState, age: number): void {
    const jingle = s.jingleAge;
    const logo = s.sponsorLogo;
    if (logo && this.spLogo.getAttribute('src') !== logo.src) this.spLogo.src = logo.src;
    const has = Boolean(logo);
    this.w.flag('sp.logo', this.root, 'nologo', !has);
    this.w.text('sp.tag', this.spTag, TAG[s.sponsorKind]);

    const spin = jingle >= 0 ? (age - jingle) / 2400 + jingle / 500 : age / 2400;
    const deg = Math.round(((spin * 180) / Math.PI / 3) % 30) * 3;
    this.w.style('sp.rays', this.spRays, 'transform', `translate(-50%, -50%) rotate(${deg}deg)`);

    const pop = easeOut(clamp01(age / 350));
    const bob = jingle >= 0 ? Math.round(Math.abs(Math.sin(jingle / 177)) * -4) : 0;
    const drop = Math.round((1 - pop) * -150) + bob;
    this.w.style('sp.drop', this.spLogoBox, 'transform', `translate(-50%, ${(drop * SD_PX).toFixed(3)}em)`);
    this.w.style('sp.champ', this.spChamp, 'visibility', age > 900 ? 'visible' : 'hidden');
  }

  /** Sweeps in over 0.35 s from the left, holds, and leaves to the right over the last 0.35, as SD's panel. */
  private sting(s: FrameState, age: number): void {
    const seg = s.seg;
    if (seg) {
      this.w.text('st.label', this.stLabel, SEGMENT_LABEL[seg.kind]);
      this.w.text('st.title', this.stTitle, seg.title);
      // Long titles drop a size rather than run off; the box clamps to two lines.
      const n = seg.title.length;
      this.w.style('st.size', this.stTitle, 'font-size', n <= 16 ? '4.2em' : n <= 26 ? '3.2em' : '2.4em');
    }
    const inT = easeOut(clamp01(age / 350));
    const outT = clamp01((age - (STING_MS - 350)) / 350);
    const x = -1 + inT + outT * outT;
    this.w.style('st.x', this.stBand, 'transform', `translateX(${(Math.round(x * 80) / 80) * 100}%)`);
    this.w.style('st.scrim', this.stScrim, 'opacity', String((Math.round(Math.min(inT, 1 - outT) * 8) / 8) * 0.55));
  }

  /**
   * The break-in card, SD's timeline: the gold panel slides in from the right over 0.24 s with a white flash and a shake that
   * dies over the first half second, the word types in from 0.2 s over 0.3, the heart beats every 0.35 s, the channel strip
   * rises, and for the last 0.26 s the card wipes off to the right to show the picture under it.
   */
  private breaking(s: FrameState, age: number): void {
    const flash = s.breakingFlash;
    if (flash !== this.seenFlash) this.setWord(flash);

    const wipe = clamp01((age - (BREAKING_MS - WIPE_MS)) / WIPE_MS);
    this.w.style('bk.clip', this.bkCard, 'clip-path', `inset(0 0 0 ${(Math.round(wipe * 40) / 40) * 100}%)`);
    this.w.style('bk.edge', this.bkEdge, 'opacity', wipe > 0 && wipe < 1 ? '1' : '0');
    this.w.style('bk.edgex', this.bkEdge, 'left', `${(Math.round(wipe * 40) / 40) * 100 - 1}%`);

    const shake = Math.max(0, 1 - age / 500) * 5;
    const dx = Math.round(Math.sin(age * 0.9) * shake) * SD_PX;
    const dy = Math.round(Math.cos(age * 1.3) * shake * 0.6) * SD_PX;
    this.w.style('bk.shake', this.bkShake, 'transform', `translate(${dx.toFixed(3)}em, ${dy.toFixed(3)}em)`);

    const slide = Math.round((1 - easeOut(clamp01(age / 240))) * 140);
    this.w.style('bk.slide', this.bkPanel, 'transform', `translateX(${((slide / 320) * 100).toFixed(2)}%)`);
    this.w.flag('bk.beat', this.bkHeart, 'big', Math.floor(age / 350) % 2 === 0);

    // The word types in a character at a time, a line per word.
    const total = this.bkLines.reduce((n, l) => n + (l.dataset.text ?? '').length, 0);
    let left = Math.ceil(total * clamp01((age - 200) / 300));
    this.bkLines.forEach((l, i) => {
      const text = l.dataset.text ?? '';
      this.w.text(`bk.l${i}`, l, text.slice(0, Math.max(0, left)));
      left -= text.length;
    });

    const strip = easeOut(clamp01((age - 100) / 200));
    this.w.style('bk.strip', this.bkStrip, 'transform', `translateY(${Math.round((1 - strip) * 4) * 25}%)`);
    this.w.text('bk.name', this.bkStripName, s.channel || DEFAULT_NAME);
    // White on impact, fading out over 0.18 s in four steps.
    const white = age < 180 ? Math.ceil((1 - age / 180) * 4) / 4 : 0;
    this.w.style('bk.flash', this.bkFlash, 'opacity', String(white));
  }

  private seenFlash?: string;

  /** Lay out the word: a line per space, sized so the longest fits the card's left side. */
  private setWord(flash: string): void {
    this.seenFlash = flash;
    this.bkWord.replaceChildren();
    const lines = flash.split(' ');
    const longest = Math.max(1, ...lines.map((l) => l.length));
    this.bkWord.style.fontSize = `${Math.min(14, 62 / longest).toFixed(2)}em`;
    this.bkLines = lines.map((text) => {
      const l = el('div', 'ln', this.bkWord);
      l.dataset.text = text;
      return l;
    });
    this.w.forget('bk.l');
  }
}
