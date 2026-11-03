// The SD/HD choice (#65): remembered per browser, and the badge in the screen's corner that flips it.

export type Look = 'sd' | 'hd';

const KEY = 'heartsnews.look';

/** ?hd=1 / ?hd=0 win for this load; otherwise what this browser last chose, else SD. Storage may be blocked, so it fails safe. */
export function chosenLook(params: URLSearchParams): Look {
  const q = params.get('hd');
  if (q === '1') return 'hd';
  if (q === '0') return 'sd';
  try {
    return localStorage.getItem(KEY) === 'hd' ? 'hd' : 'sd';
  } catch {
    return 'sd';
  }
}

/** Remember the viewer's choice (not the URL override, which is only for the one load). */
export function rememberLook(look: Look): void {
  try {
    localStorage.setItem(KEY, look);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

const STYLE = `
.look-badge { position: absolute; top: 9%; right: 1.5%; z-index: 20; margin: 0; padding: 7px 9px 6px; border: 2px solid #e0b13a;
  border-radius: 3px; background: #120f22; color: #e0b13a; font: bold 11px/1 'Press Start 2P', ui-monospace, monospace;
  letter-spacing: 0; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.4s; touch-action: manipulation; }
.look-badge.shown, .look-badge:focus-visible { opacity: 1; pointer-events: auto; }
.look-badge:hover { background: #6d1a2a; }
.look-badge:focus-visible { outline: 2px solid #f2efe6; outline-offset: 2px; }
.look-badge.busy { cursor: progress; }
@media (pointer: coarse) { .look-badge { padding: 12px 14px 11px; } }
`;

/** How long the badge stays up after the pointer last moved over the screen. */
const SHOW_MS = 3000;
/** How long a message (HD UNAVAILABLE) holds the badge before it goes back to its label. */
const NOTE_MS = 4000;

/**
 * A small badge in the screen's top-right corner, like a video player's controls: it appears when the pointer moves over the
 * screen and fades after a few seconds. It says which picture is on (HD or SD) and clicking it switches to the other. Clicks on it don't
 * reach the screen, so they don't tune in.
 */
export class LookBadge {
  private readonly button = document.createElement('button');
  private look: Look = 'sd';
  private hide?: number;
  private note?: number;

  constructor(
    private readonly screen: HTMLElement,
    /** Asked to switch; resolves once it has or hasn't. */
    private readonly onSwitch: (to: Look) => Promise<void>,
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    const { button } = this;
    button.type = 'button';
    button.className = 'look-badge';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.onSwitch(this.look === 'hd' ? 'sd' : 'hd');
    });
    this.label();
    screen.append(button);
    // Pointer events cover mouse and touch: a tap on the screen brings the badge up too.
    screen.addEventListener('pointermove', () => this.show());
    screen.addEventListener('pointerdown', () => this.show());
  }

  /** The look now on screen: the badge offers the other one. */
  set(look: Look): void {
    this.look = look;
    this.label();
  }

  /** Busy while HD loads. */
  busy(on: boolean): void {
    this.button.classList.toggle('busy', on);
    this.button.setAttribute('aria-busy', String(on));
  }

  /** Show a short message in the badge (it holds the badge up), then go back to the label. */
  say(text: string): void {
    this.button.textContent = text;
    this.button.setAttribute('aria-label', text);
    this.show(NOTE_MS);
    clearTimeout(this.note);
    this.note = window.setTimeout(() => this.label(), NOTE_MS);
  }

  /** Keep the badge the last child of the screen so Tab reaches the picture first, whichever renderer was mounted last. */
  toEnd(): void {
    this.screen.append(this.button);
  }

  private label(): void {
    const now = this.look.toUpperCase();
    const to = this.look === 'hd' ? 'SD' : 'HD';
    this.button.textContent = now;
    this.button.setAttribute('aria-label', `Picture is ${now}. Switch to ${to}`);
  }

  private show(ms = SHOW_MS): void {
    this.button.classList.add('shown');
    clearTimeout(this.hide);
    this.hide = window.setTimeout(() => this.dim(), ms);
  }

  private dim(): void {
    this.button.classList.remove('shown');
  }
}
