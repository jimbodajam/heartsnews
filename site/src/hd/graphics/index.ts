// The native HD bulletin graphics (#87): HTML panels like the bottom stack, one file per graphic type. Any type not in
// NATIVE falls back to the SD graphic (renderer.ts: the SD panel beside the presenter, or the SD scene full screen).
//
// To add a type: write <type>.ts exporting `(g: Extract<Graphic, { type: '<type>' }>, place: Place) => HTMLElement` (build
// it with `shell` from common.ts), add it to NATIVE below and give it its rules in graphics.css under `.g-<type>`.
//
// Not here, on purpose: `caller`, which as in SD never takes a panel (panelGraphic in render/sd.ts) and is never a
// full-screen shot (player.ts); the furniture's caller bar shows it in place of the headline bar. And `advert`, which is
// an ad break's own full-screen card (the SD scene).

import '@fontsource/press-start-2p/latin-400.css';
import './graphics.css';
import type { Graphic } from '../../../../shared/bulletin';
import { bench } from './bench';
import { birthdays } from './birthdays';
import { el, type Place } from './common';
import { fixtures } from './fixtures';
import { finance } from './finance';
import { form } from './form';
import { formation } from './formation';
import { headline } from './headline';
import { headtohead } from './headtohead';
import { player } from './player';
import { predictions } from './predictions';
import { quote } from './quote';
import { result } from './result';
import { sentiment } from './sentiment';
import { stats } from './stats';
import { table } from './table';
import { transfer } from './transfer';

export type { Place } from './common';

type Build<T extends Graphic['type']> = (g: Extract<Graphic, { type: T }>, place: Place) => HTMLElement;

/** Graphic type to its HD builder. */
const NATIVE: { [T in Graphic['type']]?: Build<T> } = {
  headline,
  table,
  fixtures,
  result,
  quote,
  transfer,
  formation,
  bench,
  player,
  stats,
  form,
  headtohead,
  finance,
  predictions,
  sentiment,
  birthdays,
};

/** Whether HD draws this graphic itself (else the SD one is shown). */
export function isNative(g: Graphic | undefined): g is Graphic {
  return Boolean(g && NATIVE[g.type]);
}

/** The graphic's panel contents, or undefined for a type HD doesn't draw. */
export function buildGraphic(g: Graphic, place: Place): HTMLElement | undefined {
  const build = NATIVE[g.type] as Build<Graphic['type']> | undefined;
  return build?.(g as never, place);
}

/**
 * Types read out one after another in the same panel (the team sheet, a player at a time): the next one swaps in without
 * the panel wiping on again, and its own contents animate instead.
 */
const RUNS: ReadonlySet<Graphic['type']> = new Set(['player']);

/**
 * One graphic on screen at a time, in its place: beside the presenter or full screen. It's rebuilt only when the graphic
 * or its place changes (the same graphic carried over a segment's close-ups stays put), and wipes on as the headline bar
 * does, except the next of a run (RUNS).
 */
export class GraphicBox {
  private box?: HTMLElement;
  private shown?: Graphic;
  private place?: Place;

  constructor(private readonly parent: HTMLElement) {}

  /** Show `g` at `place`, or nothing. A type HD doesn't draw shows nothing here. */
  show(g: Graphic | undefined, place: Place): void {
    if (g === this.shown && place === this.place) return;
    const run = Boolean(this.box && g && g.type === this.shown?.type && place === this.place && RUNS.has(g.type));
    this.shown = g;
    this.place = place;
    this.box?.remove();
    this.box = undefined;
    const inner = g && buildGraphic(g, place);
    if (!inner) return;
    const box = el('div', `gfx ${place}${run ? ' run' : ''}`);
    box.append(inner);
    this.parent.append(box);
    this.box = box;
  }

  clear(): void {
    this.show(undefined, 'beside');
  }
}
