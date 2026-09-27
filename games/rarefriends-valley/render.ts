/**
 * Canvas renderer: the valley in greyscale with faded seasonal colour, drawn through the rotating isometric camera.
 * Ground first, then every object painter-sorted by rotated depth, then weather, night light and floating text.
 */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { cropById, cropStage, decorByKind, FORAGE, type CropShape, type DecorKind, type Season } from "./data.ts";
import { isNight, season, type Plot, type Resident, type ValleyState, type Walker } from "./engine.ts";
import { depth, facingFor, key, MAPS, project, rotate, type Building, type Camera, type Prop, type Tile, type WorldMap } from "./world.ts";

export const INK = "#161616", PAPER = "#efede7";
type Point = { x: number; y: number };
export type Floater = { text: string; x: number; y: number; age: number; tone: "gold" | "heart" | "info" | "golden" };
export type Placing = { kind: DecorKind; tile: Tile | null; valid: boolean } | null;
export type Scene = {
  state: ValleyState; camera: Camera; now: number; reducedMotion: boolean; friend: GenerationSprites;
  art: (resident: Resident, facing: Facing, walking: boolean, frame: number) => readonly string[];
  floaters: readonly Floater[]; hover: Tile | null; placing: Placing; watermark: string | null; statue: readonly string[] | null;
};
export type Facing = "down" | "up" | "left" | "right";

// ---------- Seasonal palette ----------
type Style = {
  grass: string; grass2: string; tuft: string; dots: readonly string[]; canopy: readonly string[]; water: string; path: string; soil: string; wet: string; particle: string | null;
  deep: string; cliff: string; cliff2: string; backdrop: readonly [string, string];
};
const STYLE: Record<Season, Style> = {
  spring: { grass: "#d3dbc7", grass2: "#c9d3bc", tuft: "#a9b99f", dots: ["#e6c3c1", "#efe3b8", "#ffffff", "#d8cde3"], canopy: ["#b9c8ae", "#a9ba9d", "#e4c4c3"], water: "#b5c3cc", path: "#e4dfd2", soil: "#bfb09c", wet: "#8f8373", particle: "#ecd0cf", deep: "#9fb0bc", cliff: "#b6a58f", cliff2: "#9d8c77", backdrop: ["#eef0ea", "#dfe3da"] },
  summer: { grass: "#c6d3b6", grass2: "#bccaab", tuft: "#9aae8c", dots: ["#efe3b8", "#ffffff", "#e8c3b8"], canopy: ["#a7bc98", "#96ad87", "#b3c6a3"], water: "#aebfca", path: "#e6e0d1", soil: "#bba98f", wet: "#8a7d6a", particle: null, deep: "#97aabb", cliff: "#b3a186", cliff2: "#9a876f", backdrop: ["#eef1ea", "#dde4d6"] },
  autumn: { grass: "#dcd4bb", grass2: "#d3cab0", tuft: "#c2b18e", dots: ["#dcb3a6", "#e8cf9c", "#c9a58e"], canopy: ["#e3c28f", "#d9a898", "#cdb489"], water: "#b3bec3", path: "#e5ded0", soil: "#b8a58d", wet: "#877866", particle: "#dcae8e", deep: "#9daab2", cliff: "#b19c83", cliff2: "#97836c", backdrop: ["#f1ece2", "#e3dccd"] },
  winter: { grass: "#eef0ef", grass2: "#e6e9e9", tuft: "#d5dbde", dots: ["#ffffff"], canopy: ["#e9edee", "#dfe4e6", "#ffffff"], water: "#dde6ea", path: "#e7e6e1", soil: "#c9c3ba", wet: "#aaa39a", particle: "#ffffff", deep: "#cad7de", cliff: "#b7aea3", cliff2: "#a0968a", backdrop: ["#f2f4f5", "#e2e7ea"] },
};

// ---------- Sprites ----------
const spriteCache = new Map<string, HTMLCanvasElement>();
/** Canonical look: black one-bit mask with a one-pixel white halo, integer-scaled. */
function spriteCanvas(rows: readonly string[], scale: number, ink = INK, halo = "#fff"): HTMLCanvasElement {
  const id = `${ink}:${halo}:${scale}:${rows.join("")}`;
  let canvas = spriteCache.get(id);
  if (canvas) return canvas;
  canvas = document.createElement("canvas"); canvas.width = canvas.height = 18 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = halo; rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(x * scale, y * scale, scale * 3, scale * 3); }));
  ctx.fillStyle = ink; rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale); }));
  if (spriteCache.size > 600) spriteCache.delete(spriteCache.keys().next().value!);
  spriteCache.set(id, canvas);
  return canvas;
}
export function friendRows(sprites: GenerationSprites, facing: Facing, walking: boolean, frame: number): readonly string[] {
  const vertical = sprites.familyId === 6 && (facing === "up" || facing === "down");
  const clip = sprites.clips[walking ? "walk" : "idle"][vertical ? "right" : facing];
  return clip[frame % clip.length].rows;
}
function drawSprite(ctx: CanvasRenderingContext2D, rows: readonly string[], at: Point, scale: number, ink = INK, halo = "#fff") {
  const image = spriteCanvas(rows, 3, ink, halo), size = 18 * scale;
  ctx.drawImage(image, Math.round(at.x - size / 2), Math.round(at.y - size + scale * 2), size, size);
}

// ---------- Primitives ----------
function poly(ctx: CanvasRenderingContext2D, points: readonly Point[], fill: string | null, stroke: string | null = INK, width = 1) {
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
const P = (camera: Camera, x: number, y: number, lift = 0) => project(camera, x, y, lift);
const quad = (camera: Camera, x: number, y: number, inset = 0, lift = 0) => [
  P(camera, x - 0.5 + inset, y - 0.5 + inset, lift), P(camera, x + 0.5 - inset, y - 0.5 + inset, lift), P(camera, x + 0.5 - inset, y + 0.5 - inset, lift), P(camera, x - 0.5 + inset, y + 0.5 - inset, lift)];
function ellipse(ctx: CanvasRenderingContext2D, c: Point, rx: number, ry: number, fill: string | null, stroke: string | null = INK) {
  ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
/** A soft contact shadow: a radial gradient squashed into the ground plane. */
let shadowSprite: HTMLCanvasElement | null = null;
function shadow(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, radius = 14, strength = 0.2) {
  if (!shadowSprite) {
    shadowSprite = document.createElement("canvas"); shadowSprite.width = shadowSprite.height = 64;
    const g = shadowSprite.getContext("2d")!, gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(22,22,22,1)"); gradient.addColorStop(0.6, "rgba(22,22,22,.6)"); gradient.addColorStop(1, "rgba(22,22,22,0)");
    g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
  }
  const c = P(camera, x, y), r = radius * camera.zoom * 1.25;
  ctx.globalAlpha = strength; ctx.drawImage(shadowSprite, c.x - r, c.y - r / 2.3, r * 2, r * 2 / 2.3); ctx.globalAlpha = 1;
}
/** Mix two #rrggbb colours (t = 0 → a, 1 → b). */
const mix = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};
/** Filled blobs with one clean outline around their combined silhouette (cartoon style). */
function blobs(ctx: CanvasRenderingContext2D, items: readonly (readonly [number, number, number, number, string])[], outline = INK, width = 1.3) {
  ctx.fillStyle = outline;
  for (const [x, y, rx, ry] of items) { ctx.beginPath(); ctx.ellipse(x, y, rx + width, ry + width, 0, 0, Math.PI * 2); ctx.fill(); }
  for (const [x, y, rx, ry, fill] of items) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
}
const hash = (x: number, y: number, salt = 0) => { let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/**
 * An upright box over a world footprint, correct at any camera angle: only walls facing the viewer are drawn,
 * farthest first. Returns the visible faces so callers can decorate them.
 */
type Face = { side: "n" | "e" | "s" | "w"; a: Point; b: Point; c: Point; d: Point; light: number };
function boxFaces(camera: Camera, x0: number, y0: number, x1: number, y1: number, h: number, lift = 0): Face[] {
  const edges: [Face["side"], [number, number], [number, number], [number, number]][] = [
    ["s", [x0, y1], [x1, y1], [0, 1]], ["e", [x1, y1], [x1, y0], [1, 0]], ["n", [x1, y0], [x0, y0], [0, -1]], ["w", [x0, y0], [x0, y1], [-1, 0]]];
  const faces: (Face & { depth: number })[] = [];
  for (const [side, from, to, normal] of edges) {
    const n = rotate({ ...camera, cx: 0, cy: 0 }, normal[0], normal[1]);
    if (n.x + n.y <= 0.001) continue;
    faces.push({ side, a: P(camera, from[0], from[1], lift), b: P(camera, to[0], to[1], lift), c: P(camera, to[0], to[1], lift + h), d: P(camera, from[0], from[1], lift + h),
      light: n.x > n.y ? 0 : 1, depth: depth(camera, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2) });
  }
  return faces.sort((p, q) => p.depth - q.depth);
}
function box(ctx: CanvasRenderingContext2D, camera: Camera, x0: number, y0: number, x1: number, y1: number, h: number, top: string, sides: [string, string], lift = 0) {
  for (const face of boxFaces(camera, x0, y0, x1, y1, h, lift)) poly(ctx, [face.a, face.b, face.c, face.d], sides[face.light]);
  poly(ctx, [P(camera, x0, y0, lift + h), P(camera, x1, y0, lift + h), P(camera, x1, y1, lift + h), P(camera, x0, y1, lift + h)], top);
}
/** A point on a face: u along the wall (0–1), v up the wall (0–1). */
const onFace = (face: Face, u: number, v: number): Point => ({
  x: face.a.x + (face.b.x - face.a.x) * u + (face.d.x - face.a.x) * v,
  y: face.a.y + (face.b.y - face.a.y) * u + (face.d.y - face.a.y) * v,
});
const facePatch = (face: Face, u0: number, u1: number, v0: number, v1: number) => [onFace(face, u0, v0), onFace(face, u1, v0), onFace(face, u1, v1), onFace(face, u0, v1)];

// ---------- Light and time ----------
/** 0 in daylight to 1 at deep night. */
export function darkness(minute: number) {
  const hour = (minute / 60) % 24;
  if (hour >= 6.5 && hour < 17) return 0;
  if (hour >= 17 && hour < 20) return (hour - 17) / 3;
  if (hour >= 20 || hour < 4) return 1;
  return 1 - (hour - 4) / 2.5;
}
function skyTint(minute: number): string | null {
  const hour = (minute / 60) % 24;
  if (hour >= 5 && hour < 7.5) return `rgba(226,215,173,${0.18 * (1 - Math.abs(hour - 6.2) / 1.3)})`;
  if (hour >= 16 && hour < 19.5) return `rgba(216,168,150,${0.2 * (1 - Math.abs(hour - 18) / 2)})`;
  return null;
}

// ---------- Ground ----------
/** Low-frequency value noise, for clustered flowers and gentle colour drift. */
function noise(x: number, y: number, scale: number, salt = 0) {
  const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const smooth = (t: number) => t * t * (3 - 2 * t), sx = smooth(fx), sy = smooth(fy);
  const a = hash(x0, y0, salt), b = hash(x0 + 1, y0, salt), c = hash(x0, y0 + 1, salt), d = hash(x0 + 1, y0 + 1, salt);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function drawGround(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap, style: Style) {
  const { camera, state, now, reducedMotion } = scene, s = season(state), winter = s === "winter", z = camera.zoom;
  // The valley sits on a little diorama island: earthen cliffs under the visible edges.
  const lip = 34, faces = boxFaces(camera, -0.5, -0.5, world.width - 0.5, world.height - 0.5, lip, -lip);
  for (const face of faces) {
    const gradient = ctx.createLinearGradient(face.d.x, face.d.y, face.a.x, face.a.y);
    gradient.addColorStop(0, face.light ? style.cliff : style.cliff2); gradient.addColorStop(1, shade(face.light ? style.cliff : style.cliff2, 0.78));
    poly(ctx, [face.a, face.b, face.c, face.d], null, null);
    ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
    // Strata lines and pebbles in the cliff.
    ctx.strokeStyle = "rgba(22,22,22,.14)"; ctx.lineWidth = 1;
    for (const v of [0.35, 0.62]) { ctx.beginPath(); for (let u = 0; u <= 1.001; u += 0.02) { const p = onFace(face, u, v + Math.sin(u * 40 + v * 9) * 0.04); if (u === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke(); }
    for (let i = 0; i < 40; i++) { const p = onFace(face, hash(i, 7, face.side.charCodeAt(0)), 0.12 + hash(i, 9, face.side.charCodeAt(0)) * 0.7); ellipse(ctx, p, 1.6 * z, 1 * z, "rgba(247,245,240,.35)", null); }
    // A grassy lip hanging over the cliff top.
    ctx.fillStyle = winter ? "#f7f8f8" : style.grass2;
    ctx.beginPath(); ctx.moveTo(face.d.x, face.d.y);
    for (let u = 0; u <= 1.001; u += 0.025) { const p = onFace(face, u, 0.86 - (hash(Math.round(u * 80), 3) * 0.1)); ctx.lineTo(p.x, p.y); }
    ctx.lineTo(face.c.x, face.c.y); ctx.closePath(); ctx.fill();
  }
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const id = key(x, y), q = quad(camera, x, y);
    if (world.water.has(id)) { drawWater(ctx, scene, world, style, x, y); continue; }
    const plot = world.id === "farm" ? state.plots.get(id) : undefined;
    if (plot?.tilled) { drawSoil(ctx, camera, x, y, plot, style); continue; }
    const path = world.paths.has(id);
    // Grass drifts gently in tone instead of a checkerboard.
    const drift = noise(x, y, 4, 11) * 0.7 + hash(x, y, 5) * 0.3;
    poly(ctx, q, path ? mix(style.path, "#ffffff", hash(x, y, 2) * 0.25) : mix(style.grass2, style.grass, drift), path ? null : mix(style.grass2, style.grass, drift));
    if (path) {
      // Worn edges where the path meets grass, and a few pebbles.
      ctx.strokeStyle = "rgba(120,108,90,.22)"; ctx.lineWidth = 1.2;
      const edges: [number, number, number, number, number, number][] = [[0, -1, -0.5, -0.5, 0.5, -0.5], [1, 0, 0.5, -0.5, 0.5, 0.5], [0, 1, 0.5, 0.5, -0.5, 0.5], [-1, 0, -0.5, 0.5, -0.5, -0.5]];
      for (const [dx, dy, ax, ay, bx, by] of edges) if (!world.paths.has(key(x + dx, y + dy)) && x + dx >= 0 && y + dy >= 0 && x + dx < world.width && y + dy < world.height) {
        const a = P(camera, x + ax * 0.92, y + ay * 0.92), b = P(camera, x + bx * 0.92, y + by * 0.92); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let i = 0; i < 3; i++) if (hash(x, y, 20 + i) < 0.55) ellipse(ctx, P(camera, x - 0.35 + hash(x, y, 30 + i) * 0.7, y - 0.35 + hash(x, y, 40 + i) * 0.7), (1.2 + hash(x, y, i) * 1.2) * z, (0.8 + hash(y, x, i) * 0.6) * z, i % 2 ? "#d3cdbf" : "#cbc4b4", null);
      continue;
    }
    if (plot && !plot.tilled) poly(ctx, quad(camera, x, y, 0.08), "rgba(120,104,84,.10)", null);
    // Two-tone grass tufts.
    for (let i = 0; i < 2; i++) {
      const r = hash(x, y, 50 + i);
      if (r > 0.62) continue;
      const base = P(camera, x - 0.32 + hash(x, y, 60 + i) * 0.64, y - 0.32 + hash(x, y, 70 + i) * 0.64);
      ctx.strokeStyle = i ? style.tuft : mix(style.tuft, "#ffffff", 0.35); ctx.lineWidth = 1.1; ctx.beginPath();
      for (const dx of [-2.2, -0.6, 1, 2.4]) { ctx.moveTo(base.x + dx * z, base.y); ctx.quadraticCurveTo(base.x + dx * 1.3 * z, base.y - 3 * z, base.x + dx * 1.9 * z, base.y - (3.5 + Math.abs(dx)) * z); }
      ctx.stroke();
    }
    // Flowers grow in little meadow clusters.
    if (!winter && noise(x, y, 5, 9) > 0.62) for (let i = 0; i < 4; i++) {
      if (hash(x, y, 80 + i) > 0.7) continue;
      const p = P(camera, x - 0.35 + hash(x, y, 90 + i) * 0.7, y - 0.35 + hash(x, y, 100 + i) * 0.7);
      ctx.strokeStyle = style.tuft; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 4 * z); ctx.stroke();
      const petal = style.dots[Math.floor(hash(x, y, 110 + i) * style.dots.length)];
      for (const [dx, dy] of [[-1.3, 0], [1.3, 0], [0, -1.3], [0, 1.3]]) ellipse(ctx, { x: p.x + dx * z, y: p.y - 4.5 * z + dy * z }, 1.3 * z, 1.1 * z, petal, null);
      ellipse(ctx, { x: p.x, y: p.y - 4.5 * z }, 0.8 * z, 0.8 * z, "#e9cf7e", null);
    } else if (winter && hash(x, y, 13) > 0.8) ellipse(ctx, P(camera, x + 0.1, y - 0.1), 5 * z, 2 * z, "rgba(255,255,255,.9)", null);
  }
  // Soft tile grid over the field so the rows read clearly.
  if (world.id === "farm") for (const id of world.field) { const x = id % 64, y = Math.floor(id / 64); poly(ctx, quad(camera, x, y), null, "rgba(22,22,22,.06)"); }
  void now; void reducedMotion;
}
function drawWater(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap, style: Style, x: number, y: number) {
  const { camera, state, now, reducedMotion } = scene, s = season(state), z = camera.zoom, winter = s === "winter";
  const neighbours = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => world.water.has(key(x + dx, y + dy))).length;
  poly(ctx, quad(camera, x, y), neighbours === 4 ? style.deep : mix(style.water, style.deep, 0.35), null);
  // Foam where water meets land.
  const edges: [number, number, number, number, number, number][] = [[0, -1, -0.5, -0.5, 0.5, -0.5], [1, 0, 0.5, -0.5, 0.5, 0.5], [0, 1, 0.5, 0.5, -0.5, 0.5], [-1, 0, -0.5, 0.5, -0.5, -0.5]];
  for (const [dx, dy, ax, ay, bx, by] of edges) if (!world.water.has(key(x + dx, y + dy))) {
    const a = P(camera, x + ax, y + ay), b = P(camera, x + bx, y + by);
    ctx.strokeStyle = winter ? "rgba(255,255,255,.95)" : "rgba(247,245,240,.85)"; ctx.lineWidth = 2.4 * z; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = "rgba(22,22,22,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  if (winter) { if (hash(x, y, 3) < 0.35) { ctx.strokeStyle = "rgba(255,255,255,.85)"; const a = P(camera, x - 0.3, y - 0.2), b = P(camera, x + 0.2, y + 0.3); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } return; }
  void now; void reducedMotion;
  // Lily pads (with the odd blossom) in spring and summer.
  if ((s === "spring" || s === "summer") && neighbours >= 2 && hash(x, y, 12) < 0.3) {
    const c = P(camera, x - 0.15 + hash(x, y, 14) * 0.3, y - 0.15 + hash(x, y, 15) * 0.3);
    ctx.fillStyle = "#9cb392"; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 5.5 * z, 2.8 * z, 0, 0.35, Math.PI * 2 - 0.35); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (hash(x, y, 16) < 0.4) { ellipse(ctx, { x: c.x + 1 * z, y: c.y - 1.5 * z }, 2.2 * z, 1.6 * z, "#f0d7d6"); ellipse(ctx, { x: c.x + 1 * z, y: c.y - 1.8 * z }, 0.8 * z, 0.6 * z, "#e9cf7e", null); }
  }
}
/** Per-frame ripples and glints on open water (the rest of the water is in the cached ground layer). */
function drawWaterMotion(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap) {
  const { camera, state, now, reducedMotion } = scene, z = camera.zoom;
  if (season(state) === "winter" || reducedMotion) return;
  ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 1;
  for (const id of world.water) {
    const x = id % 64, y = Math.floor(id / 64), phase = now / 900 + hash(x, y) * 6;
    const a = P(camera, x - 0.25 + Math.sin(phase) * 0.08, y + 0.1), b = P(camera, x + 0.15 + Math.sin(phase) * 0.08, y + 0.1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (Math.sin(now / 400 + hash(x, y, 4) * 20) > 0.93) { const g = P(camera, x + 0.2, y - 0.2); ctx.fillStyle = "#fff"; ctx.fillRect(g.x - 0.6, g.y - 2.5 * z, 1.2, 5 * z); ctx.fillRect(g.x - 2.5 * z, g.y - 0.6, 5 * z, 1.2); }
  }
}
/**
 * The ground (island, grass, flowers, paths, soil, water) changes rarely, so it's drawn into an offscreen layer 1.5×
 * the view and reused while the camera pans within it. It's redrawn when the map, season, angle, zoom, view size or
 * any field tile changes; while the camera is rotating or zooming it's drawn directly.
 */
let groundCache: { canvas: HTMLCanvasElement; key: string; focusX: number; focusY: number } | null = null, lastView = "";
function drawGroundLayer(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap, style: Style, width: number, height: number, pixelScale: number) {
  const { camera, state } = scene;
  let plots = 0;
  if (world.id === "farm") for (const [id, plot] of state.plots) plots = (plots * 31 + id * 7 + (plot.tilled ? 1 : 0) + (plot.watered ? 2 : 0) + plot.fertilizer * 4 + (plot.debris ? 16 : 0)) | 0;
  const view = `${camera.angle.toFixed(4)}:${camera.zoom.toFixed(4)}:${width}x${height}:${pixelScale}`, moving = view !== lastView;
  lastView = view;
  if (moving) { drawGround(ctx, scene, world, style); return; }
  const key = `${world.id}:${season(state)}:${plots}:${view}`;
  const cacheCamera = (fx: number, fy: number): Camera => ({ ...camera, focusX: fx, focusY: fy, width: width * 1.5, height: height * 1.5 });
  const offsetFor = (cache: NonNullable<typeof groundCache>) => {
    const a = project(camera, world.width / 2, world.height / 2), b = project(cacheCamera(cache.focusX, cache.focusY), world.width / 2, world.height / 2);
    return { x: Math.round((a.x - b.x) * pixelScale) / pixelScale, y: Math.round((a.y - b.y) * pixelScale) / pixelScale };
  };
  let offset = groundCache?.key === key ? offsetFor(groundCache) : null;
  if (!groundCache || !offset || offset.x > 0 || offset.y > 0 || offset.x < -width * 0.5 || offset.y < -height * 0.5) {
    const canvas = groundCache?.canvas ?? document.createElement("canvas");
    canvas.width = Math.ceil(width * 1.5 * pixelScale); canvas.height = Math.ceil(height * 1.5 * pixelScale);
    const layer = canvas.getContext("2d")!;
    layer.setTransform(pixelScale, 0, 0, pixelScale, 0, 0); layer.imageSmoothingEnabled = false; layer.clearRect(0, 0, width * 1.5, height * 1.5);
    groundCache = { canvas, key, focusX: camera.focusX, focusY: camera.focusY };
    drawGround(layer, { ...scene, camera: cacheCamera(camera.focusX, camera.focusY) }, world, style);
    offset = offsetFor(groundCache);
  }
  ctx.drawImage(groundCache.canvas, offset.x, offset.y, groundCache.canvas.width / pixelScale, groundCache.canvas.height / pixelScale);
}
function drawSoil(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, plot: Plot, style: Style) {
  const z = camera.zoom, base = plot.watered ? style.wet : style.soil;
  poly(ctx, quad(camera, x, y, 0.03), base, "rgba(22,22,22,.28)");
  // Rounded furrows: a lit ridge and a dark groove per row.
  for (const t of [-0.25, 0, 0.25]) {
    const a = P(camera, x - 0.4, y + t), m = P(camera, x, y + t), b = P(camera, x + 0.4, y + t);
    ctx.strokeStyle = plot.watered ? "rgba(22,22,22,.32)" : "rgba(22,22,22,.2)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 1); ctx.quadraticCurveTo(m.x, m.y + 2.2 * z, b.x, b.y + 1); ctx.stroke();
    ctx.strokeStyle = plot.watered ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.28)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - 1); ctx.quadraticCurveTo(m.x, m.y - 0.6 * z, b.x, b.y - 1); ctx.stroke();
  }
  // Watered soil glistens.
  if (plot.watered) for (let i = 0; i < 2; i++) ellipse(ctx, P(camera, x - 0.25 + hash(x, y, i + 7) * 0.5, y - 0.25 + hash(y, x, i + 7) * 0.5), 1.4 * z, 0.6 * z, "rgba(214,228,238,.55)", null);
  if (plot.fertilizer) for (let i = 0; i < 5; i++) ellipse(ctx, P(camera, x - 0.32 + hash(x, y, i) * 0.64, y - 0.32 + hash(y, x, i) * 0.64), 1.1 * z, 0.7 * z, plot.fertilizer === 2 ? "#e9d38f" : "#f4f1ea", null);
}

// ---------- Objects ----------
type Drawable = { depth: number; draw: () => void };
function tree(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, style: Style, s: Season, now: number, pine: boolean, scale = 1) {
  const z = camera.zoom * scale * (0.92 + hash(x, y, 1) * 0.16), base = P(camera, x, y), sway = Math.sin(now / 1400 + x * 1.7 + y) * 0.9 * z;
  shadow(ctx, camera, x + 0.15, y + 0.1, 22 * scale, 0.24);
  // Trunk: a tapered, rounded bole.
  ctx.fillStyle = "#8b7d6f"; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(base.x - 4 * z, base.y); ctx.quadraticCurveTo(base.x - 2.5 * z, base.y - 12 * z, base.x - 2.2 * z, base.y - 26 * z);
  ctx.lineTo(base.x + 2.2 * z, base.y - 26 * z); ctx.quadraticCurveTo(base.x + 2.5 * z, base.y - 12 * z, base.x + 4 * z, base.y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "rgba(22,22,22,.25)"; ctx.beginPath(); ctx.moveTo(base.x + 1 * z, base.y - 4 * z); ctx.lineTo(base.x + 0.6 * z, base.y - 16 * z); ctx.stroke();
  if (pine) {
    const color = s === "winter" ? "#c3cdc9" : s === "autumn" ? "#98a88f" : "#9fb09a", light = mix(color.startsWith("#") ? color : "#9fb09a", "#ffffff", 0.25);
    const tiers: [number, number, number][] = [[24, 60, 18], [19, 78, 40], [13, 95, 60], [7, 108, 80]];
    for (const [w, top, bottom] of tiers) {
      const tip = { x: base.x + sway * (top / 100), y: base.y - top * z };
      poly(ctx, [tip, { x: base.x + w * z, y: base.y - bottom * z }, { x: base.x, y: base.y - (bottom - 4) * z }, { x: base.x - w * z, y: base.y - bottom * z }], color, INK, 1.2);
      poly(ctx, [tip, { x: base.x - w * z, y: base.y - bottom * z }, { x: base.x, y: base.y - (bottom - 4) * z }], light, null);
      if (s === "winter") poly(ctx, [tip, { x: tip.x + w * 0.45 * z, y: tip.y + 10 * z }, { x: tip.x, y: tip.y + 8 * z }, { x: tip.x - w * 0.45 * z, y: tip.y + 10 * z }], "#ffffff", null);
    }
    return;
  }
  if (s === "winter") {
    ctx.strokeStyle = "#6f655b"; ctx.lineCap = "round";
    for (const [dx, dy, w] of [[-15, -50, 2.2], [13, -54, 2.2], [-5, -64, 1.8], [6, -44, 1.6], [-20, -60, 1.2], [18, -64, 1.2]] as const) {
      ctx.lineWidth = w * z; ctx.beginPath(); ctx.moveTo(base.x, base.y - 24 * z); ctx.quadraticCurveTo(base.x + dx * 0.3 * z, base.y + (dy + 16) * z, base.x + dx * z, base.y + dy * z); ctx.stroke();
      ellipse(ctx, { x: base.x + dx * z, y: base.y + dy * z - 1.5 * z }, 3.6 * z, 1.6 * z, "#ffffff", null);
    }
    ctx.lineCap = "butt"; ctx.lineWidth = 1;
    return;
  }
  // Canopy: overlapping blobs with one clean outline, then soft shade and highlights.
  const [c0, c1, c2] = style.canopy, dark = shade(c1.startsWith("#") ? c1 : "#a9ba9d", 0.86), light = mix(c0.startsWith("#") ? c0 : "#b9c8ae", "#ffffff", 0.3);
  const puffs: [number, number, number, number, string][] = [
    [-12, -40, 15, 13, c1], [12, -42, 14, 12, c1], [0, -58, 17, 15, c0], [-6, -46, 16, 14, c0], [8, -50, 13, 12, c2],
  ];
  blobs(ctx, puffs.map(([dx, dy, rx, ry, fill]) => [base.x + dx * z + sway, base.y + dy * z, rx * z, ry * z, fill] as const), INK, 1.3);
  ellipse(ctx, { x: base.x - 8 * z + sway, y: base.y - 34 * z }, 11 * z, 5 * z, dark, null);
  for (const [dx, dy, r] of [[4, -64, 7], [-9, -54, 5], [13, -50, 4]] as const) ellipse(ctx, { x: base.x + dx * z + sway, y: base.y + dy * z }, r * z, r * 0.7 * z, light, null);
  if (s === "spring") for (let i = 0; i < 9; i++) blobs(ctx, [[base.x + (hash(x, y, i) - 0.5) * 38 * z + sway, base.y - (32 + hash(y, x, i) * 34) * z, 2.1 * z, 1.9 * z, i % 3 ? "#f3dcdb" : "#ffffff"]], "rgba(22,22,22,.4)", 0.7);
  if (s === "summer") for (let i = 0; i < 4; i++) blobs(ctx, [[base.x + (hash(x, y, i) - 0.5) * 30 * z + sway, base.y - (36 + hash(y, x, i) * 24) * z, 2.3 * z, 2.3 * z, "#d99a8f"]], "rgba(22,22,22,.45)", 0.7);
  if (s === "autumn") for (let i = 0; i < 6; i++) ellipse(ctx, { x: base.x + (hash(x, y, i) - 0.5) * 36 * z + sway, y: base.y - (32 + hash(y, x, i) * 30) * z }, 2.2 * z, 1.6 * z, i % 2 ? "#d49a86" : "#e0b27a", null);
}
function drawProp(ctx: CanvasRenderingContext2D, scene: Scene, prop: Prop, style: Style) {
  const { camera, state, now, reducedMotion } = scene, s = season(state), z = camera.zoom, x = prop.x, y = prop.y, c = P(camera, x, y);
  switch (prop.kind) {
    case "tree": case "pine": tree(ctx, camera, x, y, style, s, reducedMotion ? 0 : now, prop.kind === "pine"); break;
    case "bush": {
      shadow(ctx, camera, x, y, 14, 0.22);
      const color = s === "winter" ? "#e3e7e8" : s === "autumn" ? "#d8c49a" : "#a9ba9d", light = s === "winter" ? "#ffffff" : mix(color, "#ffffff", 0.3);
      blobs(ctx, [[c.x - 7 * z, c.y - 8 * z, 9 * z, 7.5 * z, color], [c.x + 7 * z, c.y - 9 * z, 9 * z, 7.5 * z, color], [c.x, c.y - 14 * z, 10 * z, 8.5 * z, color]]);
      ellipse(ctx, { x: c.x + 2 * z, y: c.y - 18 * z }, 5 * z, 3 * z, light, null);
      if (s === "summer" || s === "spring") for (let i = 0; i < 4; i++) blobs(ctx, [[c.x + (i - 1.5) * 6 * z, c.y - (9 + (i % 2) * 6) * z, 1.9 * z, 1.9 * z, s === "summer" ? "#d49a98" : "#ffffff"]], "rgba(22,22,22,.45)", 0.6);
      break;
    }
    case "fence": box(ctx, camera, x - 0.08, y - 0.08, x + 0.08, y + 0.08, 18, "#d9d2c5", ["#b8ad9d", "#cbbfae"]); box(ctx, camera, x - 0.5, y - 0.04, x + 0.5, y + 0.04, 4, "#d9d2c5", ["#b8ad9d", "#cbbfae"], 11); break;
    case "bin": {
      box(ctx, camera, x - 0.38, y - 0.3, x + 0.38, y + 0.3, 22, "#b8a48d", ["#9c8672", "#ae9882"]);
      const lid = [P(camera, x - 0.4, y - 0.32, 22), P(camera, x + 0.4, y - 0.32, 22), P(camera, x + 0.4, y + 0.32, 26), P(camera, x - 0.4, y + 0.32, 26)];
      poly(ctx, lid, "#cdb9a2");
      if (state.bin.length) { const top = P(camera, x, y, 30); ctx.fillStyle = "#e2d7ad"; ctx.font = `bold ${10 * z}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.fillText(`${state.bin.reduce((sum, slot) => sum + slot.count, 0)}`, top.x, top.y); }
      break;
    }
    case "well": {
      box(ctx, camera, x - 0.34, y - 0.34, x + 0.34, y + 0.34, 16, "#b5c3cc", ["#a8a49c", "#bdb8ae"]);
      for (const [dx, dy] of [[-0.3, -0.3], [0.3, 0.3]]) box(ctx, camera, x + dx - 0.04, y + dy - 0.04, x + dx + 0.04, y + dy + 0.04, 34, "#8b7d6f", ["#7a6d60", "#8b7d6f"], 16);
      poly(ctx, [P(camera, x - 0.45, y - 0.45, 50), P(camera, x + 0.45, y - 0.45, 50), P(camera, x + 0.45, y + 0.45, 50), P(camera, x - 0.45, y + 0.45, 50)], "#b9a7a4");
      break;
    }
    case "fountain": {
      const cx = x + 0.5, cy = y + 0.5, basin = P(camera, cx, cy);
      ellipse(ctx, basin, 40 * z, 19 * z, "#d7d3ca"); ellipse(ctx, { x: basin.x, y: basin.y - 3 * z }, 33 * z, 15 * z, s === "winter" ? "#e6edf0" : style.water);
      box(ctx, camera, cx - 0.12, cy - 0.12, cx + 0.12, cy + 0.12, 26, "#d7d3ca", ["#bdb8ae", "#cbc6bb"]);
      if (s !== "winter" && !reducedMotion) for (let i = 0; i < 6; i++) {
        const t = (now / 700 + i / 6) % 1, angle = i / 6 * Math.PI * 2, top = P(camera, cx, cy, 26);
        ellipse(ctx, { x: top.x + Math.cos(angle) * t * 22 * z, y: top.y - (Math.sin(t * Math.PI) * 14 - t * 20) * z }, 1.6 * z, 1.6 * z, "rgba(255,255,255,.9)", null);
      }
      break;
    }
    case "board": {
      for (const dx of [-0.3, 0.3]) box(ctx, camera, x + dx - 0.04, y - 0.04, x + dx + 0.04, y + 0.04, 30, "#8b7d6f", ["#7a6d60", "#8b7d6f"]);
      const face = boxFaces(camera, x - 0.42, y - 0.03, x + 0.42, y + 0.03, 22, 18)[0];
      box(ctx, camera, x - 0.42, y - 0.03, x + 0.42, y + 0.03, 22, "#c9b69e", ["#b8a48d", "#c9b69e"], 18);
      if (face) { poly(ctx, facePatch(face, 0.2, 0.55, 0.2, 0.85), "#f7f5f0"); if (state.request && !state.request.done) ellipse(ctx, onFace(face, 0.38, 0.8), 2.2 * z, 2.2 * z, "#d58f86"); poly(ctx, facePatch(face, 0.62, 0.85, 0.3, 0.75), "#efe9df"); }
      break;
    }
    case "lamp": lampPost(ctx, camera, x, y, isNight(state)); break;
    case "bench": bench(ctx, camera, x, y); break;
    case "sign": {
      box(ctx, camera, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 26, "#8b7d6f", ["#7a6d60", "#8b7d6f"]);
      box(ctx, camera, x - 0.32, y - 0.03, x + 0.32, y + 0.03, 12, "#e9e4da", ["#d9d2c5", "#e9e4da"], 20);
      const top = P(camera, x, y, 25); ctx.fillStyle = INK; ctx.font = `bold ${8 * z}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.fillText("TOWN →", top.x, top.y);
      break;
    }
    default: break;
  }
}
function lampPost(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, lit: boolean) {
  box(ctx, camera, x - 0.05, y - 0.05, x + 0.05, y + 0.05, 44, "#3b3a38", ["#3b3a38", "#555"]);
  box(ctx, camera, x - 0.13, y - 0.13, x + 0.13, y + 0.13, 12, "#3b3a38", [lit ? "#f6e3a6" : "#e9e4da", lit ? "#fbecc0" : "#f4f1ea"], 44);
}
function bench(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number) {
  box(ctx, camera, x - 0.42, y - 0.16, x + 0.42, y + 0.16, 10, "#c2ae96", ["#9c8672", "#ae9882"]);
  box(ctx, camera, x - 0.42, y - 0.2, x + 0.42, y - 0.12, 12, "#c2ae96", ["#9c8672", "#ae9882"], 10);
}
function drawBuilding(ctx: CanvasRenderingContext2D, scene: Scene, b: Building) {
  const { camera, state, now, reducedMotion } = scene, z = camera.zoom, night = darkness(state.minute) > 0.4, s = season(state), winter = s === "winter";
  const x0 = b.x - 0.5, y0 = b.y - 0.5, x1 = b.x + b.w - 0.5, y1 = b.y + b.d - 0.5;
  shadow(ctx, camera, (x0 + x1) / 2 + 0.3, (y0 + y1) / 2 + 0.3, Math.max(b.w, b.d) * 26, 0.22);
  const faces = boxFaces(camera, x0, y0, x1, y1, b.h);
  const awning = b.place === "store" ? "#b4c3ab" : b.place === "cafe" ? "#d8b6b4" : b.place === "market" ? "#c6bed4" : null;
  for (const face of faces) {
    poly(ctx, [face.a, face.b, face.c, face.d], face.light ? b.wall : shade(b.wall, 0.9), INK, 1.2);
    // Siding, a stone footing and the shadow under the eaves.
    ctx.strokeStyle = "rgba(22,22,22,.07)"; ctx.lineWidth = 1;
    for (const v of [0.3, 0.45, 0.6, 0.75]) { const a = onFace(face, 0, v), c = onFace(face, 1, v); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
    poly(ctx, facePatch(face, 0, 1, 0, 0.12), face.light ? "#cfc9bd" : "#bfb9ad", INK, 1);
    for (let u = 0.08; u < 1; u += 0.12) { const a = onFace(face, u, 0), c = onFace(face, u, 0.12); ctx.strokeStyle = "rgba(22,22,22,.18)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
    poly(ctx, facePatch(face, 0, 1, 0.9, 1), "rgba(22,22,22,.12)", null);
    const length = face.side === "n" || face.side === "s" ? b.w : b.d;
    const doorU = face.side === b.side ? (b.side === "n" || b.side === "s" ? (b.door.x - x0) / b.w : (face.side === "e" ? (y1 - b.door.y) / b.d : (b.door.y - y0) / b.d)) : -1;
    const doorAlong = face.side === "n" ? 1 - doorU : doorU;
    for (let i = 0; i < length; i++) {
      const u = (i + 0.5) / length, half = 0.15 / length * 2;
      if (doorU >= 0 && Math.abs(u - doorAlong) < 0.5 / length) continue;
      // Framed window with mullions, a sill and (outside winter) a flower box.
      poly(ctx, facePatch(face, u - half - 0.012, u + half + 0.012, 0.36, 0.76), "#f7f5f0", INK, 1);
      poly(ctx, facePatch(face, u - half, u + half, 0.39, 0.73), night ? "#f3dfa0" : "#c4d0d6", null);
      if (!night) poly(ctx, facePatch(face, u - half, u - half * 0.2, 0.55, 0.73), "rgba(255,255,255,.45)", null);
      ctx.strokeStyle = "#f7f5f0"; ctx.lineWidth = 1.4;
      { const a = onFace(face, u, 0.39), c = onFace(face, u, 0.73), d = onFace(face, u - half, 0.56), e = onFace(face, u + half, 0.56); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }
      poly(ctx, facePatch(face, u - half - 0.03, u + half + 0.03, 0.33, 0.37), "#e3ddd1", INK, 1);
      if (!winter && face.side === b.side) {
        poly(ctx, facePatch(face, u - half, u + half, 0.26, 0.33), "#9c8672", INK, 1);
        const colors = s === "autumn" ? ["#e0b27a", "#d49a86"] : ["#e6c3c1", "#f7f5f0", "#efe3b8"];
        for (let f = 0; f < 4; f++) { const p = onFace(face, u - half + (f + 0.5) * half / 2, 0.345); blobs(ctx, [[p.x, p.y, 2.1 * z, 1.8 * z, colors[f % colors.length]]], "rgba(22,22,22,.5)", 0.6); }
      }
      if (night) { ctx.fillStyle = "rgba(246,227,166,.22)"; const p = onFace(face, u, 0.56); ctx.beginPath(); ctx.arc(p.x, p.y, 15 * z, 0, Math.PI * 2); ctx.fill(); }
    }
    if (doorU >= 0) {
      const half = 0.17 / length * 2;
      poly(ctx, facePatch(face, doorAlong - half - 0.02, doorAlong + half + 0.02, 0, 0.64), "#f7f5f0", INK, 1);
      poly(ctx, facePatch(face, doorAlong - half, doorAlong + half, 0, 0.6), "#8b7d6f", null);
      poly(ctx, facePatch(face, doorAlong - half * 0.7, doorAlong + half * 0.7, 0.34, 0.54), night ? "#f3dfa0" : "#b4c0c6", null);
      ellipse(ctx, onFace(face, doorAlong + half * 0.6, 0.28), 1.3 * z, 1.3 * z, "#e2d7ad", INK);
      // Shops get a striped awning and a sign.
      if (awning) {
        const stripes = 6, top0 = 0.68, drop = 0.14;
        for (let k = 0; k < stripes; k++) {
          const ua = doorAlong - half * 2.2 + k * (half * 4.4 / stripes), ub = ua + half * 4.4 / stripes;
          const pts = [onFace(face, ua, top0 + drop), onFace(face, ub, top0 + drop), onFace(face, ub, top0), onFace(face, ua, top0)];
          // Tilt the awning outward toward the viewer.
          const out = { x: (face.b.y - face.a.y) * 0.08, y: 7 * z };
          poly(ctx, [{ x: pts[3].x + out.x, y: pts[3].y + out.y }, { x: pts[2].x + out.x, y: pts[2].y + out.y }, pts[1], pts[0]], k % 2 ? "#f7f5f0" : awning, INK, 1);
        }
        poly(ctx, facePatch(face, doorAlong - half * 2, doorAlong + half * 2, 0.84, 0.97), "#f7f5f0", INK, 1);
        const p = onFace(face, doorAlong, 0.905); ctx.fillStyle = INK; ctx.font = `bold ${7.5 * z}px ui-monospace, monospace`; ctx.textAlign = "center";
        ctx.fillText(b.place === "store" ? "STORE" : b.place === "cafe" ? "CAFE" : "MARKET", p.x, p.y + 2.5 * z);
      }
      // A stone doorstep against the wall.
      const dx = b.side === "e" ? 1 : b.side === "w" ? -1 : 0, dy = b.side === "s" ? 1 : b.side === "n" ? -1 : 0;
      const wx = dx > 0 ? x1 : dx < 0 ? x0 : b.door.x, wy = dy > 0 ? y1 : dy < 0 ? y0 : b.door.y;
      const sx0 = dx ? Math.min(wx, wx + dx * 0.28) : b.door.x - 0.3, sx1 = dx ? Math.max(wx, wx + dx * 0.28) : b.door.x + 0.3;
      const sy0 = dy ? Math.min(wy, wy + dy * 0.28) : b.door.y - 0.3, sy1 = dy ? Math.max(wy, wy + dy * 0.28) : b.door.y + 0.3;
      box(ctx, camera, sx0, sy0, sx1, sy1, 4, "#e3ddd1", ["#bfb9ad", "#cfc9bd"]);
    }
  }
  roof(ctx, camera, x0 - 0.14, y0 - 0.14, x1 + 0.14, y1 + 0.14, b.h, Math.min(b.w, b.d) * 16, winter ? "#f4f6f6" : b.roof);
  // Chimney with drifting smoke on homes and the café.
  if (b.place === "home" || b.place === "cafe" || b.place === "villager") {
    const cx = x0 + (x1 - x0) * 0.28, cy = y0 + (y1 - y0) * 0.35, rise = Math.min(b.w, b.d) * 16;
    box(ctx, camera, cx - 0.13, cy - 0.13, cx + 0.13, cy + 0.13, rise * 0.62, "#8f8478", ["#9d8f82", "#b0a293"], b.h + rise * 0.4);
    if (winter) poly(ctx, [P(camera, cx - 0.13, cy - 0.13, b.h + rise * 1.02), P(camera, cx + 0.13, cy - 0.13, b.h + rise * 1.02), P(camera, cx + 0.13, cy + 0.13, b.h + rise * 1.02), P(camera, cx - 0.13, cy + 0.13, b.h + rise * 1.02)], "#ffffff", null);
    if (!reducedMotion) for (let i = 0; i < 4; i++) {
      const t = ((now / 2600) + i / 4 + hash(b.x, b.y) ) % 1, top = P(camera, cx, cy, b.h + rise * 1.06 + t * 50);
      ctx.fillStyle = `rgba(247,245,240,${0.75 * (1 - t)})`; ctx.strokeStyle = `rgba(22,22,22,${0.18 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(top.x + Math.sin(t * 5 + i) * 6 * z + t * 10 * z, top.y, (3 + t * 7) * z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
}
const shade = (hex: string, amount: number) => {
  const value = parseInt(hex.slice(1), 16), r = (value >> 16) & 255, g = (value >> 8) & 255, b = value & 255;
  return `rgb(${Math.round(r * amount)},${Math.round(g * amount)},${Math.round(b * amount)})`;
};
/** Hip roof with a ridge along the longer side, drawn back to front. */
function roof(ctx: CanvasRenderingContext2D, camera: Camera, x0: number, y0: number, x1: number, y1: number, h: number, rise: number, color: string) {
  const alongX = x1 - x0 >= y1 - y0, inset = Math.min(x1 - x0, y1 - y0) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r1 = alongX ? [x0 + inset, cy] : [cx, y0 + inset], r2 = alongX ? [x1 - inset, cy] : [cx, y1 - inset];
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const;
  const ridgeFor = (a: readonly number[], b: readonly number[]) => {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d1 = Math.hypot(mid[0] - r1[0], mid[1] - r1[1]), d2 = Math.hypot(mid[0] - r2[0], mid[1] - r2[1]);
    return Math.abs(d1 - d2) < 1e-6 ? [r1, r2] : [d1 < d2 ? r1 : r2];
  };
  const faces = corners.map((a, index) => {
    const b = corners[(index + 1) % 4], ridge = ridgeFor(a, b);
    const points = [P(camera, a[0], a[1], h), P(camera, b[0], b[1], h), ...(ridge.length === 2 ? [ridge[1], ridge[0]] : ridge).map(p => P(camera, p[0], p[1], h + rise))];
    // Order ridge points to match the eave direction.
    if (ridge.length === 2) {
      const [p, q] = ridge, da = Math.hypot(b[0] - p[0], b[1] - p[1]), db = Math.hypot(b[0] - q[0], b[1] - q[1]);
      points.splice(2, 2, ...(da < db ? [p, q] : [q, p]).map(pt => P(camera, pt[0], pt[1], h + rise)));
    }
    return { points, depth: depth(camera, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), light: (() => { const n = rotate({ ...camera, cx: 0, cy: 0 }, (a[1] - b[1]), (b[0] - a[0])); return n.x - n.y; })() };
  }).sort((p, q) => p.depth - q.depth);
  for (const face of faces) {
    poly(ctx, face.points, face.light > 0.3 ? shade(color.startsWith("#") ? color : "#b9a7a4", 0.86) : color, INK, 1.2);
    // A lighter band along the eave, like the edge of the shingles catching light.
    const [ea, eb] = [face.points[0], face.points[1]], [ra, rb] = [face.points[face.points.length - 1], face.points[2]];
    poly(ctx, [ea, eb, { x: eb.x + (rb.x - eb.x) * 0.12, y: eb.y + (rb.y - eb.y) * 0.12 }, { x: ea.x + (ra.x - ea.x) * 0.12, y: ea.y + (ra.y - ea.y) * 0.12 }], "rgba(255,255,255,.18)", null);
    ctx.strokeStyle = "rgba(22,22,22,.12)";
    for (const t of [0.33, 0.66]) {
      const [a, b] = [face.points[0], face.points[1]], [c, d] = [face.points[face.points.length - 1], face.points[2]];
      const p = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }, q = { x: b.x + (d.x - b.x) * t, y: b.y + (d.y - b.y) * t };
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
}

// ---------- Crops, debris, forage and décor ----------
function drawCrop(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, plot: Plot, now: number, reducedMotion: boolean) {
  const crop = cropById(plot.crop!.id), stage = cropStage(crop, plot.crop!.grown, plot.crop!.regrowing), c = P(camera, x, y), z = camera.zoom;
  const leaf = crop.leaf;
  ellipse(ctx, { x: c.x, y: c.y + 1 * z }, 8 * z, 3.2 * z, "rgba(22,22,22,.12)", null);
  if (stage === 0) { for (const [dx, dy] of [[-4, -1], [3, 1], [0, -3]]) ellipse(ctx, { x: c.x + dx * z, y: c.y + dy * z }, 1.4 * z, 1 * z, "#6d6152", null); return; }
  const bob = stage === 3 && !reducedMotion ? Math.sin(now / 300 + x * 2 + y) * 1.2 * z : 0;
  const leaves = (height: number, spread: number) => {
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    for (const side of [-1, 1]) poly(ctx, [{ x: c.x, y: c.y - 2 * z }, { x: c.x + side * spread * z, y: c.y - height * 0.7 * z }, { x: c.x + side * spread * 0.4 * z, y: c.y - height * z }], leaf);
  };
  if (stage === 1) { leaves(9, 5); return; }
  const tall = crop.shape === "cob" ? 26 : crop.shape === "berry" ? 16 : 13;
  leaves(tall, crop.shape === "big" ? 12 : 8);
  if (crop.shape === "cob") { box(ctx, camera, x - 0.03, y - 0.03, x + 0.03, y + 0.03, 24, leaf, [leaf, leaf]); }
  if (stage < 3) return;
  const fruit = (shape: CropShape) => {
    const top = { x: c.x, y: c.y - 6 * z + bob };
    switch (shape) {
      case "round": ellipse(ctx, { x: top.x, y: top.y + 3 * z }, 6 * z, 5 * z, crop.color); ellipse(ctx, { x: top.x - 2 * z, y: top.y + 1 * z }, 1.4 * z, 1.2 * z, "rgba(255,255,255,.7)", null); break;
      case "berry": for (const [dx, dy] of [[-5, -8], [5, -10], [0, -4], [-2, -13]]) { ellipse(ctx, { x: top.x + dx * z, y: top.y + dy * z }, 3 * z, 3.3 * z, crop.color); } break;
      case "cob": for (const dx of [-5, 5]) { ellipse(ctx, { x: top.x + dx * z, y: top.y - 12 * z }, 2.6 * z, 6 * z, crop.color); } break;
      case "big": ellipse(ctx, { x: top.x, y: top.y + 2 * z }, 11 * z, 8 * z, crop.color); ctx.strokeStyle = "rgba(22,22,22,.3)"; for (const dx of [-5, 0, 5]) { ctx.beginPath(); ctx.moveTo(top.x + dx * z, top.y - 5 * z); ctx.quadraticCurveTo(top.x + dx * 1.4 * z, top.y + 2 * z, top.x + dx * z, top.y + 9 * z); ctx.stroke(); } break;
      case "long": for (const dx of [-4, 4]) { ctx.save(); ctx.translate(top.x + dx * z, top.y - 2 * z); ctx.rotate(dx * 0.06); ellipse(ctx, { x: 0, y: 0 }, 3 * z, 7 * z, crop.color); ctx.restore(); } break;
      case "leafy": for (const [dx, r] of [[0, 9], [-4, 6], [4, 6]] as const) ellipse(ctx, { x: top.x + dx * z, y: top.y + 1 * z }, r * z, r * 0.75 * z, crop.color); break;
    }
  };
  fruit(crop.shape);
  // Ripe crops sparkle so they're easy to spot.
  if (!reducedMotion && Math.sin(now / 500 + x * 3 + y * 5) > 0.85) { const p = { x: c.x + 8 * z, y: c.y - 20 * z }; ctx.fillStyle = "#fff"; ctx.fillRect(p.x - 1, p.y - 4 * z, 2, 8 * z); ctx.fillRect(p.x - 4 * z, p.y - 1, 8 * z, 2); }
}
function drawDebris(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, kind: "weed" | "rock" | "stump", s: Season) {
  const c = P(camera, x, y), z = camera.zoom;
  if (kind === "weed") {
    ctx.strokeStyle = s === "winter" ? "#b9c0bf" : s === "autumn" ? "#a8966f" : "#6f8466"; ctx.lineWidth = 1.5;
    ctx.beginPath(); for (const dx of [-5, -2, 1, 4, 6]) { ctx.moveTo(c.x + dx * z, c.y); ctx.lineTo(c.x + dx * 1.5 * z, c.y - (7 + Math.abs(dx)) * z); } ctx.stroke(); ctx.lineWidth = 1;
  } else if (kind === "rock") {
    shadow(ctx, camera, x, y, 10);
    poly(ctx, [{ x: c.x - 10 * z, y: c.y }, { x: c.x - 7 * z, y: c.y - 8 * z }, { x: c.x + 2 * z, y: c.y - 11 * z }, { x: c.x + 10 * z, y: c.y - 4 * z }, { x: c.x + 8 * z, y: c.y + 2 * z }, { x: c.x - 3 * z, y: c.y + 3 * z }], s === "winter" ? "#d8dcdc" : "#b4b0a8");
    poly(ctx, [{ x: c.x - 7 * z, y: c.y - 8 * z }, { x: c.x + 2 * z, y: c.y - 11 * z }, { x: c.x, y: c.y - 5 * z }], "#cbc7bf", null);
  } else {
    shadow(ctx, camera, x, y, 12);
    ellipse(ctx, { x: c.x, y: c.y - 2 * z }, 10 * z, 5 * z, "#8b7d6f");
    ctx.fillStyle = "#8b7d6f"; ctx.fillRect(c.x - 10 * z, c.y - 9 * z, 20 * z, 7 * z);
    ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(c.x - 10 * z, c.y - 9 * z); ctx.lineTo(c.x - 10 * z, c.y - 2 * z); ctx.moveTo(c.x + 10 * z, c.y - 9 * z); ctx.lineTo(c.x + 10 * z, c.y - 2 * z); ctx.stroke();
    ellipse(ctx, { x: c.x, y: c.y - 9 * z }, 10 * z, 5 * z, s === "winter" ? "#f4f6f6" : "#c9b69e");
    ellipse(ctx, { x: c.x, y: c.y - 9 * z }, 5 * z, 2.4 * z, null, "rgba(22,22,22,.35)");
  }
}
export function drawDecor(ctx: CanvasRenderingContext2D, camera: Camera, kind: DecorKind, x: number, y: number, now: number, reducedMotion: boolean, s: Season, night: boolean, statue: readonly string[] | null) {
  const c = P(camera, x, y), z = camera.zoom, t = reducedMotion ? 0 : now;
  switch (kind) {
    case "flowerbed": {
      box(ctx, camera, x - 0.4, y - 0.3, x + 0.4, y + 0.3, 7, s === "winter" ? "#f4f6f6" : "#9c8672", ["#b8a48d", "#c9b69e"]);
      const colors = s === "winter" ? ["#fff"] : s === "autumn" ? ["#e3c28f", "#d49a86"] : ["#e6c3c1", "#efe3b8", "#c6bed4", "#fff"];
      for (let i = 0; i < 7; i++) { const p = P(camera, x - 0.3 + (i % 4) * 0.2, y - 0.15 + Math.floor(i / 4) * 0.3, 10); ellipse(ctx, p, 2.6 * z, 2.2 * z, colors[i % colors.length]); }
      break;
    }
    case "lamp": lampPost(ctx, camera, x, y, night); break;
    case "bench": bench(ctx, camera, x, y); break;
    case "birdbath": {
      box(ctx, camera, x - 0.07, y - 0.07, x + 0.07, y + 0.07, 18, "#d7d3ca", ["#bdb8ae", "#cbc6bb"]);
      const top = P(camera, x, y, 18); ellipse(ctx, top, 14 * z, 6 * z, "#d7d3ca"); ellipse(ctx, { x: top.x, y: top.y - 1 }, 10 * z, 4 * z, "#b5c3cc", null);
      if (!night && Math.floor(t / 2400 + x) % 3 !== 0) { const bird = { x: top.x + 8 * z, y: top.y - 5 * z + Math.sin(t / 200) * z }; ellipse(ctx, bird, 3.5 * z, 2.6 * z, "#6d6b67"); ellipse(ctx, { x: bird.x + 3 * z, y: bird.y - 2 * z }, 2 * z, 2 * z, "#6d6b67"); }
      break;
    }
    case "scarecrow": {
      box(ctx, camera, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 40, "#8b7d6f", ["#7a6d60", "#8b7d6f"]);
      const arm = [P(camera, x - 0.35, y + 0.35, 30), P(camera, x + 0.35, y - 0.35, 30)]; ctx.strokeStyle = "#7a6d60"; ctx.lineWidth = 3 * z; ctx.beginPath(); ctx.moveTo(arm[0].x, arm[0].y); ctx.lineTo(arm[1].x, arm[1].y); ctx.stroke(); ctx.lineWidth = 1;
      const head = P(camera, x, y, 44); ellipse(ctx, head, 7 * z, 7 * z, "#e9e4da"); ellipse(ctx, { x: head.x - 2 * z, y: head.y }, 1 * z, 1 * z, INK, null); ellipse(ctx, { x: head.x + 2 * z, y: head.y }, 1 * z, 1 * z, INK, null);
      poly(ctx, [{ x: head.x - 11 * z, y: head.y - 4 * z }, { x: head.x + 11 * z, y: head.y - 4 * z }, { x: head.x, y: head.y - 16 * z }], "#e2d7ad");
      poly(ctx, facePatchPoints(camera, x, y, 18, 34, 0.16), "#d8b6b4");
      break;
    }
    case "chime": {
      box(ctx, camera, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 44, "#8b7d6f", ["#7a6d60", "#8b7d6f"]);
      const top = P(camera, x, y, 44); ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(top.x - 10 * z, top.y); ctx.lineTo(top.x + 10 * z, top.y); ctx.stroke();
      for (let i = 0; i < 4; i++) { const sway = Math.sin(t / 380 + i) * 2 * z, px = top.x - 8 * z + i * 5.3 * z; ctx.fillStyle = ["#c9d6e0", "#e2d7ad", "#d8b6b4", "#c6bed4"][i]; ctx.fillRect(px + sway - 1.5 * z, top.y + 2 * z, 3 * z, (8 + i * 2) * z); ctx.strokeRect(px + sway - 1.5 * z, top.y + 2 * z, 3 * z, (8 + i * 2) * z); }
      break;
    }
    case "arch": {
      for (const d of [-0.4, 0.4]) box(ctx, camera, x + d - 0.05, y - 0.05, x + d + 0.05, y + 0.05, 42, "#e9e4da", ["#cfc9ba", "#e9e4da"]);
      const a = P(camera, x - 0.4, y, 42), b = P(camera, x + 0.4, y, 42); ctx.strokeStyle = "#e9e4da"; ctx.lineWidth = 4 * z; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - 22 * z, b.x, b.y); ctx.stroke(); ctx.lineWidth = 1;
      const colors = s === "winter" ? ["#fff", "#e6edf0"] : ["#e6c3c1", "#efe3b8", "#c6bed4"];
      for (let i = 0; i <= 8; i++) { const u = i / 8, p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * 16 * z }; ellipse(ctx, p, 3 * z, 3 * z, colors[i % colors.length]); }
      break;
    }
    case "sprinkler": {
      box(ctx, camera, x - 0.12, y - 0.12, x + 0.12, y + 0.12, 8, "#9fb0c2", ["#8a9bad", "#9fb0c2"]);
      const top = P(camera, x, y, 8); poly(ctx, [{ x: top.x, y: top.y - 16 * z }, { x: top.x + 6 * z, y: top.y - 4 * z }, { x: top.x, y: top.y }, { x: top.x - 6 * z, y: top.y - 4 * z }], "#d4e3ee");
      if (!reducedMotion) for (let i = 0; i < 5; i++) { const u = (t / 900 + i / 5) % 1, angle = t / 500 + i; ellipse(ctx, { x: top.x + Math.cos(angle) * u * 26 * z, y: top.y - 14 * z + (u * u * 26 - u * 14) * z }, 1.3 * z, 1.3 * z, "rgba(214,230,240,.9)", null); }
      break;
    }
    case "beehive": {
      box(ctx, camera, x - 0.2, y - 0.2, x + 0.2, y + 0.2, 8, "#8b7d6f", ["#7a6d60", "#8b7d6f"]);
      const top = P(camera, x, y, 8);
      for (let i = 0; i < 3; i++) ellipse(ctx, { x: top.x, y: top.y - (5 + i * 7) * z }, (12 - i * 2) * z, 5 * z, "#dcdfe3");
      if (!reducedMotion) for (let i = 0; i < 3; i++) { const angle = t / 300 + i * 2; ellipse(ctx, { x: top.x + Math.cos(angle) * 16 * z, y: top.y - 20 * z + Math.sin(angle * 1.3) * 6 * z }, 2 * z, 1.6 * z, "#e2d07a"); }
      break;
    }
    case "lantern": {
      box(ctx, camera, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 36, "#3b3a38", ["#3b3a38", "#555"]);
      const top = P(camera, x, y, 36);
      if (night || !reducedMotion) { ctx.fillStyle = `rgba(198,190,212,${night ? 0.35 : 0.18})`; ctx.beginPath(); ctx.arc(top.x, top.y - 6 * z, 18 * z, 0, Math.PI * 2); ctx.fill(); }
      ellipse(ctx, { x: top.x, y: top.y - 6 * z }, 8 * z, 8 * z, "#e8e3f3"); ctx.fillStyle = "#a9a2bf"; ctx.beginPath(); ctx.arc(top.x + 2.5 * z, top.y - 7 * z, 6 * z, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "windmill": {
      box(ctx, camera, x - 0.18, y - 0.18, x + 0.18, y + 0.18, 40, "#e9e4da", ["#cfc9ba", "#e9e4da"]);
      const hub = P(camera, x, y, 44), spin = reducedMotion ? 0.4 : t / 700;
      for (let i = 0; i < 4; i++) {
        const angle = spin + i * Math.PI / 2, tip = { x: hub.x + Math.cos(angle) * 26 * z, y: hub.y + Math.sin(angle) * 26 * z };
        poly(ctx, [hub, { x: tip.x + Math.cos(angle + 1.4) * 5 * z, y: tip.y + Math.sin(angle + 1.4) * 5 * z }, tip], i % 2 ? "#c6bed4" : "#f7f5f0");
      }
      ellipse(ctx, hub, 3 * z, 3 * z, "#e2d7ad");
      const star = P(camera, x, y, 64); ctx.fillStyle = "#e2d7ad"; ctx.font = `${10 * z}px sans-serif`; ctx.textAlign = "center"; ctx.fillText("★", star.x, star.y);
      break;
    }
    case "statue": {
      box(ctx, camera, x - 0.32, y - 0.32, x + 0.32, y + 0.32, 12, "#e9e4da", ["#cfc9ba", "#ddd7cb"]);
      if (statue) drawSprite(ctx, statue, P(camera, x, y, 12), 2.6 * z, "#b8913a", "#f2dc8c");
      if (!reducedMotion && Math.sin(t / 400 + x) > 0.6) { const p = P(camera, x + 0.2, y - 0.2, 44); ctx.fillStyle = "#fff"; ctx.fillRect(p.x - 1, p.y - 5 * z, 2, 10 * z); ctx.fillRect(p.x - 5 * z, p.y - 1, 10 * z, 2); }
      break;
    }
  }
}
/** Small flat banner facing the camera, for the scarecrow's shirt. */
const facePatchPoints = (camera: Camera, x: number, y: number, v0: number, v1: number, w: number) => [P(camera, x - w, y + w, v0), P(camera, x + w, y - w, v0), P(camera, x + w, y - w, v1), P(camera, x - w, y + w, v1)];
function drawForage(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, id: string, now: number, reducedMotion: boolean) {
  const info = FORAGE.find(item => item.id === id)!, c = P(camera, x, y), z = camera.zoom, bob = reducedMotion ? 0 : Math.sin(now / 400 + x) * 1.5 * z;
  if (id === "berry") { ctx.strokeStyle = "#6f8466"; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 8 * z); ctx.stroke(); for (const [dx, dy] of [[-3, -9], [3, -10], [0, -13]]) ellipse(ctx, { x: c.x + dx * z, y: c.y + dy * z + bob }, 2.6 * z, 2.6 * z, info.color); }
  else if (id === "shell") { poly(ctx, [{ x: c.x - 7 * z, y: c.y - 2 * z + bob }, { x: c.x, y: c.y - 10 * z + bob }, { x: c.x + 7 * z, y: c.y - 2 * z + bob }, { x: c.x, y: c.y + bob }], info.color); }
  else if (id === "mushroom") { ctx.fillStyle = "#efe9df"; ctx.fillRect(c.x - 2 * z, c.y - 7 * z, 4 * z, 7 * z); ctx.strokeRect(c.x - 2 * z, c.y - 7 * z, 4 * z, 7 * z); ellipse(ctx, { x: c.x, y: c.y - 8 * z + bob }, 7 * z, 4 * z, info.color); }
  else { poly(ctx, [{ x: c.x, y: c.y - 14 * z + bob }, { x: c.x + 5 * z, y: c.y - 6 * z + bob }, { x: c.x, y: c.y + bob }, { x: c.x - 5 * z, y: c.y - 6 * z + bob }], info.color); ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(c.x - 1, c.y - 11 * z + bob, 2, 4 * z); }
}

// ---------- Characters ----------
function drawWalker(ctx: CanvasRenderingContext2D, scene: Scene, body: Walker, rows: readonly string[], scale: number, label: string | null, extra?: (top: Point) => void) {
  const { camera } = scene;
  const bob = body.moving && !scene.reducedMotion ? Math.abs(Math.sin(scene.now / 95)) * 2.2 * camera.zoom : 0;
  shadow(ctx, camera, body.x, body.y, 12 - bob, 0.26);
  const base = P(camera, body.x, body.y), at = { x: base.x, y: base.y - bob };
  drawSprite(ctx, rows, at, scale * camera.zoom);
  const top = { x: at.x, y: at.y - 18 * scale * camera.zoom };
  if (label) {
    ctx.font = `bold ${9 * camera.zoom}px ui-monospace, monospace`; ctx.textAlign = "center";
    const width = ctx.measureText(label).width + 8;
    ctx.fillStyle = "rgba(247,245,240,.92)"; ctx.fillRect(top.x - width / 2, top.y - 13 * camera.zoom, width, 12 * camera.zoom);
    ctx.strokeStyle = INK; ctx.strokeRect(top.x - width / 2, top.y - 13 * camera.zoom, width, 12 * camera.zoom);
    ctx.fillStyle = INK; ctx.fillText(label, top.x, top.y - 4 * camera.zoom);
  }
  extra?.(top);
}
const frameOf = (now: number, moving: boolean, reducedMotion: boolean) => reducedMotion ? 0 : Math.floor(now / (moving ? 130 : 420));

// ---------- Weather ----------
function drawWeather(ctx: CanvasRenderingContext2D, scene: Scene, width: number, height: number) {
  const { state, now, reducedMotion } = scene, s = season(state), t = reducedMotion ? 0 : now;
  if (state.weather === "rain") {
    ctx.strokeStyle = "rgba(90,104,120,.35)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 120; i++) { const x = (hash(i, 1) * width + t * 0.05) % width, y = (hash(i, 2) * height + t * 0.9) % height; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 12); }
    ctx.stroke(); ctx.fillStyle = "rgba(90,104,120,.06)"; ctx.fillRect(0, 0, width, height);
  } else if (state.weather === "snow" || (s === "winter" && state.weather !== "sun")) {
    ctx.fillStyle = "rgba(255,255,255,.9)";
    for (let i = 0; i < 90; i++) { const x = (hash(i, 3) * width + Math.sin(t / 900 + i) * 12) % width, y = (hash(i, 4) * height + t * 0.04) % height; ctx.beginPath(); ctx.arc(x, y, 1.2 + hash(i, 5) * 1.6, 0, Math.PI * 2); ctx.fill(); }
  } else if (STYLE[s].particle && !reducedMotion) {
    ctx.fillStyle = STYLE[s].particle!;
    for (let i = 0; i < 14; i++) {
      const x = (hash(i, 6) * width + t * 0.03) % width, y = (hash(i, 7) * height + t * 0.025 + Math.sin(t / 700 + i) * 10) % height;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t / 600 + i); ctx.fillRect(-2.5, -1.2, 5, 2.4); ctx.restore();
    }
  }
}

// ---------- Night ----------
let nightLayer: HTMLCanvasElement | null = null;
function drawNight(ctx: CanvasRenderingContext2D, scene: Scene, lights: Point[], width: number, height: number, pixelScale: number) {
  const dark = darkness(scene.state.minute);
  if (dark <= 0.01) return;
  const w = Math.ceil(width * pixelScale), h = Math.ceil(height * pixelScale);
  nightLayer ??= document.createElement("canvas");
  if (nightLayer.width !== w || nightLayer.height !== h) { nightLayer.width = w; nightLayer.height = h; }
  const layer = nightLayer.getContext("2d")!;
  layer.setTransform(1, 0, 0, 1, 0, 0); layer.globalCompositeOperation = "source-over"; layer.clearRect(0, 0, w, h);
  layer.fillStyle = `rgba(24,28,44,${0.58 * dark})`; layer.fillRect(0, 0, w, h);
  layer.globalCompositeOperation = "destination-out";
  for (const light of lights) {
    const radius = 70 * scene.camera.zoom * pixelScale, gradient = layer.createRadialGradient(light.x * pixelScale, light.y * pixelScale, 0, light.x * pixelScale, light.y * pixelScale, radius);
    gradient.addColorStop(0, "rgba(0,0,0,.95)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
    layer.fillStyle = gradient; layer.beginPath(); layer.arc(light.x * pixelScale, light.y * pixelScale, radius, 0, Math.PI * 2); layer.fill();
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(nightLayer, 0, 0); ctx.restore();
  // Warm glow on top of each light.
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const light of lights) { const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 46 * scene.camera.zoom); gradient.addColorStop(0, `rgba(120,96,40,${0.35 * dark})`); gradient.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gradient; ctx.fillRect(light.x - 60 * scene.camera.zoom, light.y - 60 * scene.camera.zoom, 120 * scene.camera.zoom, 120 * scene.camera.zoom); }
  ctx.restore();
  if (dark > 0.5) { ctx.fillStyle = `rgba(255,255,255,${0.7 * (dark - 0.5)})`; for (let i = 0; i < 40; i++) { ctx.fillRect(hash(i, 8) * width, hash(i, 9) * height * 0.35, 1.5, 1.5); } }
}

// ---------- Ambient life ----------
/** Big soft cloud shadows drifting over the island on sunny days. */
function drawCloudShadows(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap) {
  const { camera, now, reducedMotion } = scene, t = reducedMotion ? 0 : now / 1000;
  for (let i = 0; i < 3; i++) {
    const span = world.width + world.height, x = ((hash(i, 1) * span + t * (0.35 + i * 0.1)) % (span + 12)) - 6, y = hash(i, 2) * world.height;
    const c = P(camera, x, y), r = (70 + hash(i, 3) * 60) * camera.zoom;
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1.6, 0.8);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, "rgba(40,48,60,.075)"); gradient.addColorStop(1, "rgba(40,48,60,0)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
/** Butterflies flutter over the grass on spring and summer days. */
function drawCritters(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap) {
  const { camera, state, now, reducedMotion } = scene, s = season(state);
  if (reducedMotion || (s !== "spring" && s !== "summer") || state.weather !== "sun" || darkness(state.minute) > 0.3) return;
  for (let i = 0; i < 5; i++) {
    const t = now / 1000 * (0.25 + hash(i, 4) * 0.2) + hash(i, 5) * 20;
    const x = 2 + hash(i, 6) * (world.width - 4) + Math.sin(t) * 2.2, y = 2 + hash(i, 7) * (world.height - 4) + Math.sin(t * 1.3 + i) * 1.6;
    const p = P(camera, x, y, 26 + Math.sin(t * 3) * 6), flap = Math.abs(Math.sin(now / 70 + i)) * 4 * camera.zoom + 0.8, color = ["#f7f5f0", "#efe3b8", "#e6c3c1", "#d8cde3"][i % 4];
    ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(p.x + side * flap * 0.7, p.y, flap, 2.6 * camera.zoom, side * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = INK; ctx.fillRect(p.x - 0.6, p.y - 2 * camera.zoom, 1.2, 4 * camera.zoom);
  }
}
/** Fireflies glow over the fields on spring and summer nights. */
function drawFireflies(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap) {
  const { camera, state, now, reducedMotion } = scene, s = season(state), dark = darkness(state.minute);
  if (dark < 0.5 || (s !== "spring" && s !== "summer") || state.weather !== "sun") return;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 22; i++) {
    const t = (reducedMotion ? 0 : now / 1000) * (0.2 + hash(i, 8) * 0.25) + hash(i, 9) * 30;
    const x = 1 + hash(i, 10) * (world.width - 2) + Math.sin(t) * 1.4, y = 1 + hash(i, 11) * (world.height - 2) + Math.cos(t * 0.8) * 1.2;
    const p = P(camera, x, y, 14 + Math.sin(t * 2) * 8), glow = (0.5 + 0.5 * Math.sin(t * 4 + i)) * dark;
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7 * camera.zoom);
    gradient.addColorStop(0, `rgba(240,230,150,${0.9 * glow})`); gradient.addColorStop(1, "rgba(240,230,150,0)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, 7 * camera.zoom, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
let grain: HTMLCanvasElement | null = null;
function grainCanvas() {
  if (grain) return grain;
  grain = document.createElement("canvas"); grain.width = grain.height = 160;
  const ctx = grain.getContext("2d")!, image = ctx.createImageData(160, 160);
  let seed = 7;
  for (let index = 0; index < image.data.length; index += 4) {
    seed = (seed * 16807) % 2147483647; const value = seed % 255;
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value; image.data[index + 3] = 14;
  }
  ctx.putImageData(image, 0, 0);
  return grain;
}

// ---------- Scene ----------
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, width: number, height: number, pixelScale: number) {
  const { state, camera, now, reducedMotion } = scene, world = MAPS[state.farmer.map], s = season(state), style = STYLE[s], night = isNight(state);
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0); ctx.imageSmoothingEnabled = false;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, style.backdrop[0]); sky.addColorStop(1, style.backdrop[1]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  // Faint paper dots behind the island.
  ctx.fillStyle = "rgba(22,22,22,.05)";
  for (let y = 8; y < height; y += 16) for (let x = (y / 16) % 2 ? 14 : 6; x < width; x += 16) ctx.fillRect(x, y, 1.6, 1.6);
  drawGroundLayer(ctx, scene, world, style, width, height, pixelScale);
  drawWaterMotion(ctx, scene, world);
  if (state.weather === "sun" && darkness(state.minute) < 0.6) drawCloudShadows(ctx, scene, world);
  // Placement preview: the décor's boost radius and the target tile.
  if (scene.placing?.tile) {
    const { tile, valid, kind } = scene.placing, info = decorByKind(kind);
    for (let dy = -info.radius; dy <= info.radius; dy++) for (let dx = -info.radius; dx <= info.radius; dx++) if (dx || dy) poly(ctx, quad(camera, tile.x + dx, tile.y + dy, 0.05), "rgba(226,215,173,.35)", null);
    poly(ctx, quad(camera, tile.x, tile.y, 0.03), valid ? "rgba(180,195,171,.55)" : "rgba(213,143,134,.5)", INK, 1.5);
  } else if (scene.hover) poly(ctx, quad(camera, scene.hover.x, scene.hover.y, 0.04), "rgba(255,255,255,.25)", "rgba(22,22,22,.55)", 1.5);

  const items: Drawable[] = [];
  const lights: Point[] = [];
  const add = (x: number, y: number, draw: () => void, bias = 0) => items.push({ depth: depth(camera, x, y) + bias, draw });
  for (const prop of world.props) {
    const cx = prop.kind === "fountain" ? prop.x + 0.5 : prop.x, cy = prop.kind === "fountain" ? prop.y + 0.5 : prop.y;
    add(cx, cy, () => drawProp(ctx, scene, prop, style));
    if (prop.kind === "lamp" && night) lights.push(P(camera, prop.x, prop.y, 50));
  }
  for (const b of world.buildings) {
    add(b.x + (b.w - 1) / 2, b.y + (b.d - 1) / 2, () => drawBuilding(ctx, scene, b), 0.4);
    if (night) lights.push(P(camera, b.door.x, b.door.y - (b.side === "s" ? 0.6 : -0.6), 20));
  }
  if (world.id === "farm") {
    for (const [id, plot] of state.plots) {
      const x = id % 64, y = Math.floor(id / 64);
      if (plot.debris) add(x, y, () => drawDebris(ctx, camera, x, y, plot.debris!, s));
      else if (plot.crop) add(x, y, () => drawCrop(ctx, camera, x, y, plot, now, reducedMotion));
    }
    for (const item of state.decor) {
      add(item.x, item.y, () => drawDecor(ctx, camera, item.kind, item.x, item.y, now, reducedMotion, s, night, scene.statue));
      if (night && (item.kind === "lamp" || item.kind === "lantern")) lights.push(P(camera, item.x, item.y, 44));
    }
    if (scene.placing?.tile) { const { tile, kind } = scene.placing; add(tile.x, tile.y, () => { ctx.globalAlpha = 0.6; drawDecor(ctx, camera, kind, tile.x, tile.y, now, reducedMotion, s, night, scene.statue); ctx.globalAlpha = 1; }, 0.01); }
  }
  for (const item of state.forage) if (item.map === world.id) add(item.x, item.y, () => drawForage(ctx, camera, item.x, item.y, item.id, now, reducedMotion));
  for (const resident of state.residents) {
    if (!resident.visible || resident.walker.map !== world.id) continue;
    const body = resident.walker, facing = facingFor(camera.angle, body.dirX, body.dirY);
    add(body.x, body.y, () => drawWalker(ctx, scene, body, scene.art(resident, facing, body.moving, frameOf(now, body.moving, reducedMotion)), 2.1, null, top => {
      if (!resident.talked && hoverish(scene, body)) { ctx.fillStyle = INK; ctx.font = `bold ${11 * camera.zoom}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.fillText("…", top.x, top.y - 2 * camera.zoom); }
    }), 0.05);
  }
  const me = state.farmer, myFacing = facingFor(camera.angle, me.dirX, me.dirY);
  add(me.x, me.y, () => drawWalker(ctx, scene, me, friendRows(scene.friend, myFacing, me.moving, frameOf(now, me.moving, reducedMotion)), 2.35, null, top => {
    if (state.energy <= 25 && !reducedMotion) { ctx.fillStyle = "#afbccb"; const drop = { x: top.x + 14 * camera.zoom, y: top.y + 10 * camera.zoom + (now / 60 % 8) * camera.zoom }; ctx.beginPath(); ctx.ellipse(drop.x, drop.y, 2.5 * camera.zoom, 3.5 * camera.zoom, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke(); }
  }), 0.06);
  if (night) lights.push(P(camera, me.x, me.y, 24));
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw();
  drawCritters(ctx, scene, world);

  drawWeather(ctx, scene, width, height);
  const tint = skyTint(state.minute);
  if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, width, height); }
  drawNight(ctx, scene, lights, width, height, pixelScale);
  drawFireflies(ctx, scene, world);

  for (const floater of scene.floaters) {
    const p = P(camera, floater.x, floater.y, 40 + floater.age * 30);
    ctx.globalAlpha = Math.max(0, 1 - floater.age / 1.6);
    ctx.font = `bold ${12 * camera.zoom}px ui-monospace, monospace`; ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.strokeText(floater.text, p.x, p.y);
    ctx.fillStyle = floater.tone === "heart" ? "#b86f6c" : floater.tone === "golden" ? "#a88a2e" : floater.tone === "gold" ? "#6b5a2e" : INK; ctx.fillText(floater.text, p.x, p.y);
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  // A soft vignette: the valley's paper look.
  ctx.fillStyle = vignette(ctx, width, height); ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = ctx.createPattern(grainCanvas(), "repeat")!; ctx.fillRect(0, 0, width, height); ctx.restore();
  if (scene.watermark) watermark(ctx, scene.watermark, width, height);
}
const hoverish = (scene: Scene, body: Walker) => Math.hypot(body.x - scene.state.farmer.x, body.y - scene.state.farmer.y) < 2.2;
let vignetteCache: { key: string; gradient: CanvasGradient } | null = null;
function vignette(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const id = `${width}x${height}`;
  if (vignetteCache?.key !== id) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.45, width / 2, height / 2, Math.max(width, height) * 0.75);
    gradient.addColorStop(0, "rgba(22,22,22,0)"); gradient.addColorStop(1, "rgba(22,22,22,.18)");
    vignetteCache = { key: id, gradient };
  }
  return vignetteCache.gradient;
}
function watermark(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
  ctx.font = "bold 13px ui-monospace, Menlo, monospace"; ctx.textAlign = "left";
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = "rgba(247,245,240,.94)"; ctx.fillRect(12, height - 38, w, 26);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(12, height - 38, w, 26); ctx.lineWidth = 1;
  ctx.fillStyle = INK; ctx.fillText(text, 23, height - 20);
  void width;
}

// ---------- Hit testing ----------
/** The resident whose sprite is under a view point, if any (sprites stand above their tile). */
export function residentUnder(scene: Pick<Scene, "state" | "camera">, sx: number, sy: number): Resident | null {
  const { state, camera } = scene;
  let best: Resident | null = null, bestDepth = -Infinity;
  for (const resident of state.residents) {
    if (!resident.visible || resident.walker.map !== state.farmer.map) continue;
    const at = P(camera, resident.walker.x, resident.walker.y), half = 18 * camera.zoom, top = 44 * camera.zoom;
    if (sx >= at.x - half && sx <= at.x + half && sy >= at.y - top && sy <= at.y + 6 * camera.zoom) {
      const d = depth(camera, resident.walker.x, resident.walker.y);
      if (d > bestDepth) { best = resident; bestDepth = d; }
    }
  }
  return best;
}
