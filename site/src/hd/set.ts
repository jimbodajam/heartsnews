// The baked HD studio set (#81): site/public/hd/set.json and the images it names.

/** A camera: zoom `z`, centred on art point (`x`, `y`) landing on screen row `sy`. The tight shot's `x` is the seat. */
export type Camera = { z: number; x: number | 'seat'; y: number; sy: number };

export type Prop = { sheet: [number, number, number, number]; s: number; side: number };

/** The museum's backdrops (files in the set's folder) and its standing presenters: each stands centred on `x` with the sheet's last row on `feet`. */
export type MuseumData = {
  front: string;
  inside: string;
  outside: { x: number; feet: number };
  gallery: { x: number; feet: number };
  /** In the gallery a presenter glances at the graphic for `for` seconds of every `every`. */
  glance: { every: number; for: number };
  /** Presenter id to the baked standing sheet, relative to the site root. */
  presenters: Record<string, string>;
};

/** A standing-presenter screen scene (#92: the Match Centre touchscreen, the Transfer Centre): its backdrop, the dark screen box (art pixels) the graphic goes over, and where the standing presenter stands. The Transfer Centre adds a wall clock (hands drawn live) and a podium sprite drawn over the presenter. */
export type SceneData = {
  file: string;
  screen: { x: number; y: number; w: number; h: number };
  stand: { x: number; feet: number };
  clock?: { x: number; y: number; r: number };
  podium?: { file: string; x: number; feet: number; w: number; h: number; label: { cx: number; cy: number } };
  glance: { every: number; for: number };
  presenters: Record<string, string>;
};

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
  /** On This Day's two scenes and where standing presenters go in them (museum.ts); absent in a set without them. */
  museum?: MuseumData;
  /** The Match Centre (touchscreen.ts); absent in a set without it. */
  touchscreen?: SceneData;
  /** The Transfer Centre (touchscreen.ts); absent in a set without it. */
  transfer?: SceneData;
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
