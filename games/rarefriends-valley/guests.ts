/**
 * Procedural guest Friends: 16 × 16 one-bit masks in the style of the canonical Generations sprites,
 * one archetype per family. These are original valley artwork, not on-chain token art.
 */
import { FAMILY_NAMES, GUEST_NAMES } from "./data.ts";

export type GuestArt = Readonly<{ name: string; family: string; frames: readonly (readonly string[])[] }>;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = boolean[][];
const blank = (): Grid => Array.from({ length: 16 }, () => Array(16).fill(false));
const set = (grid: Grid, x: number, y: number, on = true) => { if (x >= 0 && y >= 0 && x < 16 && y < 16) grid[y][x] = on; };
/** Mirror-symmetric paint around the vertical centre line (columns 7|8). */
const sym = (grid: Grid, x: number, y: number, on = true) => { set(grid, x, y, on); set(grid, 15 - x, y, on); };
function ellipse(grid: Grid, cx: number, cy: number, rx: number, ry: number, on = true) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(grid, x, y, on);
  }
}
const rect = (grid: Grid, x: number, y: number, w: number, h: number, on = true) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(grid, i, j, on);
};
const legs = (grid: Grid, y: number, spread: number, step: boolean) => {
  sym(grid, 8 - spread, y); sym(grid, 8 - spread, y + 1, !step); sym(grid, 8 - spread - (step ? 1 : 0), y + 1, true);
};

function body(family: number, random: () => number, step: boolean): Grid {
  const grid = blank(), r = () => random();
  const eyeY = 5 + Math.floor(r() * 2), eyeX = 5 + Math.floor(r() * 2);
  switch (family) {
    case 0: { // Skeleton: skull, ribs, bony legs
      ellipse(grid, 8, 5, 4.5, 4); sym(grid, 6, 5, false); sym(grid, 6, 4, false); sym(grid, 5, 5, false);
      for (let x = 6; x <= 9; x += 2) set(grid, x, 8, false);
      rect(grid, 7, 9, 2, 5); for (let y = 10; y <= 12; y += 2) { sym(grid, 5, y); sym(grid, 6, y); }
      legs(grid, 14, 2, step); break;
    }
    case 1: { // Mask: tall oval face with a carved band
      ellipse(grid, 8, 6.5, 5, 5.5); rect(grid, 4, 5, 8, 2, false); sym(grid, eyeX, 5); sym(grid, 3, 5); sym(grid, 3, 6);
      for (let x = 6; x <= 9; x++) set(grid, x, 9, r() > 0.4 ? false : true);
      rect(grid, 6, 12, 4, 2); legs(grid, 14, 2, step); break;
    }
    case 2: { // Family: a big Friend holding a little one
      ellipse(grid, 6, 7, 4, 4.5); set(grid, 4, 6, false); set(grid, 7, 6, false);
      ellipse(grid, 12, 10, 2.6, 2.6); set(grid, 11, 10, false); set(grid, 13, 10, false);
      rect(grid, 4, 12, 1, 2); rect(grid, 7, 12, 1, 2); rect(grid, 11, 13, 1, 1); rect(grid, 13, 13, 1, 1);
      if (step) { set(grid, 4, 14); set(grid, 8, 14); } else { set(grid, 3, 14); set(grid, 7, 14); } break;
    }
    case 3: { // Cellular: soft blob full of cells
      ellipse(grid, 8, 8.5, 6, 5.5);
      for (let i = 0; i < 4; i++) { const x = 4 + Math.floor(r() * 4), y = 6 + Math.floor(r() * 6); sym(grid, x, y, false); }
      sym(grid, eyeX, 7, false); sym(grid, 3, 3 + Math.floor(r() * 2)); sym(grid, 4, 4);
      legs(grid, 14, 3, step); break;
    }
    case 4: { // Asymmetry: lopsided silhouette
      ellipse(grid, 7, 7, 4.5, 5); ellipse(grid, 11, 5, 2.5, 3);
      set(grid, 6, 6, false); set(grid, 11, 5, false); rect(grid, 9, 9, 1, 1, false);
      rect(grid, 5, 12, 1, 2); rect(grid, 9, 12, 1, 2); set(grid, step ? 4 : 5, 14); set(grid, step ? 10 : 9, 14); break;
    }
    case 5: { // Hoverer: floating round body with a wisp beneath
      ellipse(grid, 8, 6, 5, 4.5); sym(grid, eyeX, 5, false); sym(grid, 2, 6); sym(grid, 1, 5);
      rect(grid, 7, 12, 2, 1); set(grid, step ? 7 : 8, 14); break;
    }
    case 6: { // Colossus: broad and tall with a tiny head
      rect(grid, 7, 1, 2, 2); rect(grid, 3, 4, 10, 8); rect(grid, 2, 5, 1, 5); rect(grid, 13, 5, 1, 5);
      sym(grid, 6, 6, false); rect(grid, 4, 12, 3, 2); rect(grid, 9, 12, 3, 2);
      if (step) rect(grid, 4, 14, 3, 1); else rect(grid, 9, 14, 3, 1); break;
    }
    case 7: { // Sparkling: small body with glinting stars
      ellipse(grid, 8, 9, 4, 4); sym(grid, eyeX + 1, 8, false);
      const stars = [[2, 2], [13, 3], [1, 8], [14, 10], [3, 13]];
      for (const [x, y] of stars) if (r() > 0.35) { set(grid, x, y); set(grid, x - 1, y); set(grid, x + 1, y); set(grid, x, y - 1); set(grid, x, y + 1); }
      legs(grid, 13, 2, step); break;
    }
    default: { // Hollow: a ring with an empty centre
      ellipse(grid, 8, 7.5, 5.5, 5.5); ellipse(grid, 8, 7.5, 2.8, 2.8, false); sym(grid, eyeX - 1, 4, false);
      legs(grid, 13, 3, step); break;
    }
  }
  return grid;
}

/** A stable roster of guests. The same seed always yields the same crowd. */
export function createGuests(count: number, seed = 20260926): GuestArt[] {
  const random = mulberry(seed);
  return Array.from({ length: count }, (_, index) => {
    const family = index % FAMILY_NAMES.length, artSeed = Math.floor(random() * 2 ** 31);
    const frames = [false, true].map(step => body(family, mulberry(artSeed), step).map(row => row.map(on => on ? "#" : ".").join("")));
    return Object.freeze({ name: GUEST_NAMES[index % GUEST_NAMES.length], family: FAMILY_NAMES[family], frames: Object.freeze(frames) });
  });
}
