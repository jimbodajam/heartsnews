import '@fontsource/press-start-2p/latin-400.css';
import './furniture.css';
import { SEGMENT_LABEL } from '../gfx/labels';
import type { TickerItem } from '../gfx/overlay';
import type { FrameState, Renderer } from '../render/state';

/** The art grid the furniture is sized on: 480 wide, so one art pixel is a 480th of the frame. */
const ART_W = 480;
/** Ticker speed in art pixels per second. */
const TICKER_SPEED = 30;
/** How long a name strap stays up, unless it is held for the line (as the SD one). */
const STRAP_MS = 5000;

/** Makes an element with a class and text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The first word of the channel name over the rest, large: "HEARTS" over "NEWS 24". */
function splitChannel(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}

/**
 * The HD look's on-screen furniture, as HTML over the 16:9 frame: brand block, clock, segment label, headline or
 * caller bar, name strap, captions and the ticker. It draws nothing itself; `draw` only touches the DOM when a value
 * has changed, so a quiet frame costs a few comparisons.
 */
export class HdFurniture implements Renderer {
  private root?: HTMLDivElement;
  private resize?: ResizeObserver;
  /** One em in px (frame width / 100) and one art pixel in px. */
  private em = 0;
  private art = 0;

  private brandName?: HTMLElement;
  private brandSub?: HTMLElement;
  private demo?: HTMLElement;
  private tab?: HTMLElement;
  private headin?: HTMLElement;
  private logo?: HTMLElement;
  private clock?: HTMLElement;
  private win?: HTMLElement;
  private track?: HTMLElement;
  private strap?: HTMLElement;
  private strapName?: HTMLElement;
  private strapRole?: HTMLElement;
  private cap?: HTMLElement;
  private capWho?: HTMLElement;
  private capText?: HTMLElement;

  // What is on the page now, to see what has changed.
  private channel = '';
  private shown: Record<'off' | 'ad' | 'demoHidden' | 'capHidden' | 'strap' | 'goal', boolean> = {
    off: true, ad: false, demoHidden: true, capHidden: true, strap: false, goal: false,
  };
  private tabText = '';
  private headKey = '';
  private clockText = '';
  private strapKey = '';
  private capKey = '';
  private capWords = -1;
  /** The current line's words with where each ends in the text. */
  private words: { word: string; end: number }[] = [];

  // Ticker: its scroll position is ours, so items can change under it without the text jumping.
  private tickKey = '';
  private pos = 0;
  private last?: number;
  /** Width of one run of the items in art px; 0 until measured. */
  private period = 0;
  private remeasure = true;
  private moved = NaN;

  mount(container: HTMLElement): void {
    const root = el('div', 'hdf off');
    root.setAttribute('aria-hidden', 'true');

    this.cap = el('div', 'cap px hidden');
    this.capWho = el('b');
    this.capText = el('span');
    const box = el('div', 'box');
    box.append(this.capText);
    this.cap.append(this.capWho, box);

    this.strap = el('div', 'strap');
    this.strapName = el('div', 'n px');
    this.strapRole = el('div', 'r');
    this.strap.append(this.strapName, this.strapRole);

    this.tab = el('div', 'tab');
    this.demo = el('div', 'demo hidden', 'DEMO BULLETIN');

    const stack = el('div', 'stack');
    const top = el('div', 'top');
    const brand = el('div', 'brand');
    this.brandName = el('i');
    this.brandSub = el('span');
    const name = el('div', 'name');
    name.append(this.brandSub, this.brandName);
    brand.append(el('div', 'mark', 'H24'), name);
    const head = el('div', 'head');
    this.headin = el('div', 'headin');
    head.append(this.headin);
    top.append(brand, head);

    const tick = el('div', 'tick');
    this.logo = el('div', 'logo', 'H24');
    this.clock = el('div', 'clock', '00:00');
    this.win = el('div', 'win');
    this.track = el('div', 'track');
    this.win.append(this.track);
    tick.append(this.logo, this.clock, this.win);
    stack.append(top, tick);

    root.append(this.cap, this.strap, this.demo, this.tab, stack);
    container.append(root);
    this.root = root;

    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(root);
    this.measure();
    // The ticker's widths change once the font is in.
    void document.fonts?.ready.then(() => (this.remeasure = true));
  }

  unmount(): void {
    this.resize?.disconnect();
    this.root?.remove();
    this.root = this.resize = undefined;
    this.channel = this.tabText = this.headKey = this.clockText = this.strapKey = this.capKey = this.tickKey = '';
    this.shown = { off: true, ad: false, demoHidden: true, capHidden: true, strap: false, goal: false };
    this.capWords = -1;
    this.words = [];
    this.last = undefined;
    this.period = 0;
    this.remeasure = true;
    this.moved = NaN;
  }

  /** Sets the em from the frame's width, so everything scales with it. */
  private measure(): void {
    const root = this.root;
    if (!root) return;
    const w = root.clientWidth;
    if (!w) return;
    this.em = w / 100;
    this.art = w / ART_W;
    root.style.fontSize = `${this.em}px`;
    this.remeasure = true;
  }

  draw(s: FrameState, now: number): void {
    const root = this.root;
    if (!root) return;
    const seg = s.seg;
    const off = s.mode !== 'show' || !seg;
    const ad = seg?.kind === 'adverts';
    this.flag(root, 'off', 'off', off);
    if (off) {
      this.last = undefined;
      return;
    }
    this.flag(root, 'ad', 'ad', ad);

    // Subtitles stay up in an ad break, as the SD ones do.
    this.drawCaption(s, now);
    if (ad) return;

    if (s.channel !== this.channel) {
      this.channel = s.channel;
      const [first, rest] = splitChannel(s.channel);
      this.brandSub!.textContent = rest ? first : '';
      this.brandName!.textContent = rest || first;
    }
    this.flag(this.demo!, 'demoHidden', 'hidden', !s.demo);

    const label = SEGMENT_LABEL[seg.kind];
    if (label !== this.tabText) {
      this.tabText = label;
      this.tab!.textContent = label;
    }
    this.drawHeadline(s);
    this.drawStrap(s);
    this.drawClock();
    this.drawTicker(s, now);
  }

  /** Toggles a class on an element when `on` differs from what we last set under `key`. */
  private flag(e: HTMLElement, key: keyof HdFurniture['shown'], cls: string, on: boolean): void {
    if (this.shown[key] === on) return;
    this.shown[key] = on;
    e.classList.toggle(cls, on);
  }

  /** The headline graphic's title, else the segment strap; a caller bar replaces it. It wipes on when it changes. */
  private drawHeadline(s: FrameState): void {
    const g = s.graphic;
    const caller = g?.type === 'caller' ? g : undefined;
    const text = caller ? '' : g?.type === 'headline' ? g.title : s.seg!.strap;
    const key = caller ? `c|${caller.name}|${caller.from}|${caller.topic}` : `h|${text}`;
    if (key === this.headKey) return;
    this.headKey = key;
    const h = this.headin!;
    h.replaceChildren();
    if (caller) {
      const who = el('div', 'who');
      const wave = el('span', 'wave');
      for (let i = 0; i < 5; i++) wave.append(el('i'));
      who.append(wave, el('span', '', `${caller.name} IN ${caller.from}`));
      h.append(who, el('span', 'txt', caller.topic));
    } else {
      h.append(el('span', 'txt', text));
    }
    // Restart the wipe.
    h.classList.remove('wipe');
    void h.offsetWidth;
    h.classList.add('wipe');
  }

  /** Name and role for 5 s from when it starts, or for the whole line when held. */
  private drawStrap(s: FrameState): void {
    const st = s.strap;
    const on = Boolean(st) && (st!.hold === true || st!.age < STRAP_MS);
    if (st) {
      const key = `${st.name}|${st.role}`;
      if (key !== this.strapKey) {
        this.strapKey = key;
        this.strapName!.textContent = st.name;
        this.strapRole!.textContent = st.role;
      }
    }
    this.flag(this.strap!, 'strap', 'on', on);
  }

  /** Real time with the colon blinking each second. */
  private drawClock(): void {
    const d = new Date();
    const text = `${String(d.getHours()).padStart(2, '0')}${d.getSeconds() % 2 ? ' ' : ':'}${String(d.getMinutes()).padStart(2, '0')}`;
    if (text === this.clockText) return;
    this.clockText = text;
    this.clock!.textContent = text;
  }

  /** The speaker's name and the line as far as it has been spoken, a word at a time so it doesn't jitter. */
  private drawCaption(s: FrameState, now: number): void {
    const line = s.line;
    const on = s.captions && Boolean(s.speaking) && Boolean(line);
    this.flag(this.cap!, 'capHidden', 'hidden', !on);
    if (!on || !line || !s.speaking) return;
    const who = (s.speaker?.name ?? '').toUpperCase();
    const key = `${who}|${line.text}`;
    if (key !== this.capKey) {
      this.capKey = key;
      this.capWords = -1;
      this.capWho!.textContent = who;
      this.words = [...line.text.matchAll(/\S+/g)].map((m) => ({ word: m[0], end: m.index! + m[0].length }));
    }
    // The words whose last letter has been spoken, and always the first so there's something up.
    const spoken = s.speaking.progress(now) * line.text.length;
    let n = 0;
    while (n < this.words.length && this.words[n].end <= spoken) n++;
    n = Math.max(n, 1);
    if (n === this.capWords) return;
    this.capWords = n;
    this.capText!.textContent = this.words.slice(0, n).map((w) => w.word).join(' ');
  }

  /** Items scroll at 30 art px/s in whole art pixels; the score is highlighted and a goal flashes. */
  private drawTicker(s: FrameState, now: number): void {
    const items = s.tickerItems;
    const flashing = s.ticker.flashing(now);
    if (flashing !== this.shown.goal) {
      this.shown.goal = flashing;
      this.root!.classList.toggle('goal', flashing);
      this.logo!.textContent = flashing ? 'GOAL' : 'H24';
      // As SD: a goal brings the score to the front.
      if (flashing) this.pos = 0;
    }

    const key = items.map((it) => `${it.score ? 1 : 0}${it.text}`).join('\n');
    if (key !== this.tickKey) {
      this.tickKey = key;
      this.buildTrack(items);
    }
    if (this.remeasure) this.fit();

    // Capped so it carries on where it was after an ad break rather than leaping ahead.
    this.pos += Math.min(now - (this.last ?? now), 100) * (TICKER_SPEED / 1000);
    this.last = now;
    if (!this.period) return;
    this.pos %= this.period;
    const x = -Math.floor(this.pos) * this.art;
    if (x !== this.moved) {
      this.moved = x;
      this.track!.style.transform = `translateX(${x}px)`;
    }
  }

  private buildTrack(items: TickerItem[]): void {
    const track = this.track!;
    track.replaceChildren();
    this.period = 0;
    this.moved = NaN;
    if (!items.length) return;
    const run = el('div');
    run.style.display = 'flex';
    for (const it of items) {
      const span = el('span', it.score ? 'score' : '');
      span.append(el('b', '', it.score ? 'LIVE' : 'NEWS'), it.text.toUpperCase());
      run.append(span);
    }
    track.append(run);
    this.remeasure = true;
  }

  /** Measures one run of the items, then repeats it enough to cover the window and wrap. */
  private fit(): void {
    this.remeasure = false;
    const track = this.track!;
    const run = track.firstElementChild as HTMLElement | null;
    if (!run || !this.art) return;
    while (track.children.length > 1) track.lastElementChild!.remove();
    const w = run.offsetWidth;
    if (!w) {
      this.remeasure = true;
      return;
    }
    this.period = w / this.art;
    const copies = Math.ceil(this.win!.clientWidth / w) + 1;
    for (let i = 1; i < copies; i++) track.append(run.cloneNode(true));
    this.moved = NaN;
  }
}
