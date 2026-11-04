import type { Graphic, Line, Presenter, Segment, Sidebar } from '../../../shared/bulletin';
import type { Speaking } from '../audio/voice';
import type { Ticker, TickerItem } from '../gfx/overlay';
import type { SponsorKind } from '../gfx/sponsor';
import type { Ground } from '../gfx/stadium';

export type Shot = 'wide' | 'single' | 'full';

export type Mode = 'splash' | 'ident' | 'sting' | 'show' | 'breaking' | 'sponsor';

/**
 * What's on air this frame, as the player hands it to a renderer. Ages are in ms at the frame's `now`.
 * Read-only: a renderer draws from it and never changes playback.
 */
export type FrameState = Readonly<{
  mode: Mode;
  modeAge: number;
  /** The splash's message, e.g. CLICK TO TUNE IN. */
  status: string;
  channel: string;
  demo: boolean;
  captions: boolean;

  seg?: Segment;
  line?: Line;
  /** Since the current line started. */
  lineAge: number;
  shot: Shot;
  /** `hold` keeps it up for the whole line, e.g. the venue strap at the ground. */
  strap?: Readonly<{ name: string; role: string; age: number; hold?: boolean }>;
  /** The voice on air now (a presenter's line, the sponsor's announcer or its jingle), if any. */
  speaking?: Speaking;
  /** The presenter speaking the current line, while they're speaking. */
  talking?: string;

  /** The current line's graphic, and how long it has been up. */
  graphic?: Graphic;
  graphicAge: number;
  /** The last graphic shown in this segment: a close-up without its own stays on the story rather than the sidebar. */
  segGraphic?: Graphic;
  sidebar?: Sidebar;

  /** Its scroll position lives in the instance, so drawing it moves it on. */
  ticker: Ticker;
  tickerItems: TickerItem[];
  /** Where our reporter is: whose end, floodlights, weather. */
  ground: Ground;
  /** The break-in's flash text, or '' when there's no breaking news on air. */
  breakingFlash: string;
  sponsorKind: SponsorKind;
  /** Since the sponsor's jingle started, or -1 before it has. */
  jingleAge: number;

  /** The programme's cast, in bulletin order (each one's idle sway is phased by its place). */
  cast: Presenter[];
  /** The current segment's presenters, resolved (breaking news brings its own). */
  onScreen: Presenter[];
  /** Who speaks the current line, resolved. */
  speaker?: Presenter;

  /** Optional painted studio background; `classicStudio` switches back to the code-drawn set. */
  studioImage?: HTMLImageElement;
  classicStudio: boolean;
  museum: Readonly<{ front?: HTMLImageElement; inside?: HTMLImageElement }>;
  sponsorLogo?: HTMLImageElement;
}>;

/** Draws the programme. Owns its own page elements (its canvas, any HTML overlay) inside the screen container. */
export interface Renderer {
  /** Create this renderer's elements inside `container`. */
  mount(container: HTMLElement): void;
  /** Remove them again, e.g. when another renderer takes over mid-show. */
  unmount(): void;
  draw(state: FrameState, now: number): void;
  /** Optional: start fetching art for these segments ahead of time (called once the bulletin loads, and when this renderer takes over). */
  preload?(segments: readonly Segment[]): void;
}
