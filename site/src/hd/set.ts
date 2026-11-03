// The baked HD studio set (#81): site/public/hd/set.json and the images it names.

/** A camera: zoom `z`, centred on art point (`x`, `y`) landing on screen row `sy`. The tight shot's `x` is the seat. */
export type Camera = { z: number; x: number | 'seat'; y: number; sy: number };

export type Prop = { sheet: [number, number, number, number]; s: number; side: number };

/** set.json as baked by tools/bake. Positions are art pixels on the 480×270 canvas. */
export type SetData = {
  w: number;
  h: number;
  backdrop: { file: string; x: number; y: number };
  /** Drawn over the seated figures; rows above `top` are transparent. */
  desk: { file: string; x: number; y: number; w: number; h: number; lip: number; top: number };
  props: {
    file: string;
    /** The scene row props stand on. */
    base: number;
    slotSide: number;
    tightScale: number;
    laptopTight: number;
    laptopLift: number;
    default: Record<string, string>;
    items: Record<string, Prop>;
  };
  seated: {
    /** The sprite row that meets the desk's back edge. */
    hcut: number;
    propx: number;
    /** Seat centres: both at the desk, the speaker's in a tight shot, and one presenter alone. */
    seats: { wide: Record<string, number>; tight: Record<string, number>; alone: number };
    /** Presenter id to the baked seated sheet, relative to the site root. */
    presenters: Record<string, string>;
  };
  /** Art rows taken by the bottom stack: the scene is lifted by this much so the desk front clears it. */
  stack: number;
  camera: { wide: Camera; tight: Camera };
};

/** The set with its images loaded. */
export type StudioSet = SetData & { backdropImg: HTMLImageElement; deskImg: HTMLImageElement; propsImg: HTMLImageElement };

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });

/** Fetch set.json from `dir` (e.g. 'hd/') and its images. */
export async function loadSet(dir: string): Promise<StudioSet> {
  const res = await fetch(`${dir}set.json`);
  if (!res.ok) throw new Error(`Could not load the HD set (${res.status})`);
  const data = (await res.json()) as SetData;
  const [backdropImg, deskImg, propsImg] = await Promise.all(
    [data.backdrop.file, data.desk.file, data.props.file].map((f) => loadImage(dir + f)),
  );
  return { ...data, backdropImg, deskImg, propsImg };
}
