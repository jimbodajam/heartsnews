// The native HD bulletin graphics (#87): HTML panels like the bottom stack, one file per graphic type. Any type not in
// NATIVE falls back to the SD graphic (renderer.ts: the SD panel beside the presenter, or the SD scene full screen).
//
// To add a type: write <type>.ts exporting `(g: Extract<Graphic, { type: '<type>' }>, place: Place) => HTMLElement` (build
// it with `shell` from common.ts), add it to NATIVE below and give it its rules in graphics.css under `.g-<type>`.

import '@fontsource/press-start-2p/latin-400.css';
import './graphics.css';
import type { Graphic } from '../../../../shared/bulletin';
import { el, type Place } from './common';
import { fixtures } from './fixtures';
import { headline } from './headline';
import { result } from './result';
import { table } from './table';

export type { Place } from './common';

type Build<T extends Graphic['type']> = (g: Extract<Graphic, { type: T }>, place: Place) => HTMLElement;

/** Graphic type to its HD builder. */
const NATIVE: { [T in Graphic['type']]?: Build<T> } = {
  headline,
  table,
  fixtures,
  result,
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
 * One graphic on screen at a time, in its place: beside the presenter or full screen. It's rebuilt only when the graphic
 * or its place changes (the same graphic carried over a segment's close-ups stays put), and wipes on as the headline bar does.
 */
export class GraphicBox {
  private box?: HTMLElement;
  private shown?: Graphic;
  private place?: Place;

  constructor(private readonly parent: HTMLElement) {}

  /** Show `g` at `place`, or nothing. A type HD doesn't draw shows nothing here. */
  show(g: Graphic | undefined, place: Place): void {
    if (g === this.shown && place === this.place) return;
    this.shown = g;
    this.place = place;
    this.box?.remove();
    this.box = undefined;
    const inner = g && buildGraphic(g, place);
    if (!inner) return;
    const box = el('div', `gfx ${place}`);
    box.append(inner);
    this.parent.append(box);
    this.box = box;
  }

  clear(): void {
    this.show(undefined, 'beside');
  }
}
