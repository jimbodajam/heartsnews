export const C = {
  black: '#0e0c10',
  ink: '#1a1620',
  white: '#f2efe6',
  light: '#c9ccd6',
  grey: '#8a8f9e',
  dark: '#3a3d4a',
  maroon: '#6d1a2a',
  maroonDark: '#3d0d17',
  maroonLight: '#9b2d40',
  gold: '#e0b13a',
  goldDark: '#a87f1e',
  navy: '#1b1f3a',
  navyDark: '#120f22',
  navyLight: '#2b3160',
  red: '#c0392b',
  amber: '#f08a24',
  green: '#3bb273',
  blue: '#3fa7d6',
} as const;

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const out = amt < 0 ? v * (1 + amt) : v + (255 - v) * amt;
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
