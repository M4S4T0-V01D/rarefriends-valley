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
type Style = { grass: string; grass2: string; tuft: string; dots: readonly string[]; canopy: readonly string[]; water: string; path: string; soil: string; wet: string; particle: string | null };
const STYLE: Record<Season, Style> = {
  spring: { grass: "#d3dbc7", grass2: "#c9d3bc", tuft: "#a9b99f", dots: ["#e6c3c1", "#efe3b8", "#ffffff"], canopy: ["#b9c8ae", "#a9ba9d", "#e4c4c3"], water: "#b5c3cc", path: "#e4dfd2", soil: "#bfb09c", wet: "#8f8373", particle: "#ecd0cf" },
  summer: { grass: "#c6d3b6", grass2: "#bccaab", tuft: "#9aae8c", dots: ["#efe3b8", "#ffffff"], canopy: ["#a7bc98", "#96ad87", "#b3c6a3"], water: "#aebfca", path: "#e6e0d1", soil: "#bba98f", wet: "#8a7d6a", particle: null },
  autumn: { grass: "#dcd4bb", grass2: "#d3cab0", tuft: "#c2b18e", dots: ["#dcb3a6", "#e8cf9c"], canopy: ["#e3c28f", "#d9a898", "#cdb489"], water: "#b3bec3", path: "#e5ded0", soil: "#b8a58d", wet: "#877866", particle: "#dcae8e" },
  winter: { grass: "#eef0ef", grass2: "#e6e9e9", tuft: "#d5dbde", dots: ["#ffffff"], canopy: ["#e9edee", "#dfe4e6", "#ffffff"], water: "#dde6ea", path: "#e7e6e1", soil: "#c9c3ba", wet: "#aaa39a", particle: "#ffffff" },
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
function shadow(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, radius = 14) {
  const c = P(camera, x, y);
  ctx.fillStyle = "rgba(22,22,22,.15)"; ctx.beginPath(); ctx.ellipse(c.x, c.y, radius * camera.zoom, radius * camera.zoom / 2.3, 0, 0, Math.PI * 2); ctx.fill();
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
function drawGround(ctx: CanvasRenderingContext2D, scene: Scene, world: WorldMap, style: Style) {
  const { camera, state, now, reducedMotion } = scene, winter = season(state) === "winter";
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const id = key(x, y), q = quad(camera, x, y);
    if (world.water.has(id)) {
      poly(ctx, q, style.water, null);
      if (!winter) {
        const phase = reducedMotion ? 0 : now / 900 + hash(x, y) * 6;
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1;
        const a = P(camera, x - 0.25 + Math.sin(phase) * 0.08, y + 0.1), b = P(camera, x + 0.15 + Math.sin(phase) * 0.08, y + 0.1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (hash(x, y, 3) < 0.3) { ctx.strokeStyle = "rgba(255,255,255,.8)"; const a = P(camera, x - 0.3, y - 0.2), b = P(camera, x + 0.2, y + 0.3); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      continue;
    }
    const plot = world.id === "farm" ? state.plots.get(id) : undefined;
    if (plot) { drawSoil(ctx, camera, x, y, plot, style); continue; }
    const path = world.paths.has(id);
    poly(ctx, q, path ? style.path : (x + y) % 2 ? style.grass : style.grass2, null);
    const r = hash(x, y);
    if (path) { if (r < 0.5) ellipse(ctx, P(camera, x - 0.2 + r * 0.4, y + 0.1 - r * 0.3), 1.6 * camera.zoom, 0.9 * camera.zoom, "#cfc9ba", null); continue; }
    if (r < 0.55) {
      const base = P(camera, x - 0.25 + r * 0.5, y + 0.2 - r * 0.4);
      ctx.strokeStyle = style.tuft; ctx.lineWidth = 1; ctx.beginPath();
      for (const dx of [-2, 0, 2]) { ctx.moveTo(base.x + dx * camera.zoom, base.y); ctx.lineTo(base.x + dx * 1.6 * camera.zoom, base.y - 4 * camera.zoom); }
      ctx.stroke();
    }
    if (r > 0.86) ellipse(ctx, P(camera, x + 0.2 - r * 0.2, y - 0.2 + r * 0.1), 1.5 * camera.zoom, 1.1 * camera.zoom, style.dots[Math.floor(r * 97) % style.dots.length], null);
  }
  // Soft tile grid over the field so the rows read clearly.
  if (world.id === "farm") {
    ctx.strokeStyle = "rgba(22,22,22,.08)"; ctx.lineWidth = 1;
    for (const id of world.field) { const x = id % 64, y = Math.floor(id / 64); poly(ctx, quad(camera, x, y), null, "rgba(22,22,22,.07)"); }
  }
}
function drawSoil(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, plot: Plot, style: Style) {
  const q = quad(camera, x, y);
  if (!plot.tilled) { poly(ctx, q, (x + y) % 2 ? style.grass : style.grass2, null); poly(ctx, quad(camera, x, y, 0.06), "rgba(120,104,84,.12)", null); return; }
  poly(ctx, quad(camera, x, y, 0.04), plot.watered ? style.wet : style.soil, "rgba(22,22,22,.25)");
  ctx.strokeStyle = plot.watered ? "rgba(22,22,22,.28)" : "rgba(22,22,22,.18)"; ctx.lineWidth = 1;
  for (const t of [-0.22, 0, 0.22]) { const a = P(camera, x - 0.38, y + t), b = P(camera, x + 0.38, y + t); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  if (plot.fertilizer) for (let i = 0; i < 4; i++) ellipse(ctx, P(camera, x - 0.3 + hash(x, y, i) * 0.6, y - 0.3 + hash(y, x, i) * 0.6), 1.1 * camera.zoom, 0.7 * camera.zoom, plot.fertilizer === 2 ? "#e9d38f" : "#f4f1ea", null);
}

// ---------- Objects ----------
type Drawable = { depth: number; draw: () => void };
function tree(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, style: Style, s: Season, now: number, pine: boolean, scale = 1) {
  const z = camera.zoom * scale, base = P(camera, x, y);
  shadow(ctx, camera, x, y, 18 * scale);
  ctx.fillStyle = "#8b7d6f"; ctx.strokeStyle = INK; ctx.lineWidth = 1;
  ctx.fillRect(base.x - 3 * z, base.y - 22 * z, 6 * z, 22 * z); ctx.strokeRect(base.x - 3 * z, base.y - 22 * z, 6 * z, 22 * z);
  if (pine) {
    const color = s === "winter" ? "#c9d2cf" : "#9fb09a";
    for (const [w, top, bottom] of [[22, 58, 20], [17, 76, 40], [11, 92, 60]]) poly(ctx, [{ x: base.x, y: base.y - top * z }, { x: base.x + w * z, y: base.y - bottom * z }, { x: base.x - w * z, y: base.y - bottom * z }], color);
    if (s === "winter") for (const [w, top] of [[10, 58], [8, 76], [5, 92]]) poly(ctx, [{ x: base.x, y: base.y - top * z }, { x: base.x + w * z, y: base.y - (top - 9) * z }, { x: base.x - w * z, y: base.y - (top - 9) * z }], "#fff", null);
    return;
  }
  if (s === "winter") {
    ctx.strokeStyle = "#6f655b"; ctx.lineWidth = 2 * z; ctx.beginPath();
    for (const [dx, dy] of [[-14, -46], [12, -50], [-6, -58], [4, -40]]) { ctx.moveTo(base.x, base.y - 22 * z); ctx.lineTo(base.x + dx * z, base.y + dy * z); }
    ctx.stroke(); ctx.lineWidth = 1;
    for (const [dx, dy] of [[-14, -46], [12, -50], [-6, -58]]) ellipse(ctx, { x: base.x + dx * z, y: base.y + dy * z - 1 }, 4 * z, 2 * z, "#fff", null);
    return;
  }
  const sway = Math.sin(now / 1400 + x) * 0.8 * z;
  for (const [dx, dy, r, c] of [[-10, -38, 15, 0], [10, -40, 14, 1], [0, -54, 16, 0], [-2, -40, 13, 2]] as const)
    ellipse(ctx, { x: base.x + dx * z + sway, y: base.y + dy * z }, r * z, r * 0.85 * z, style.canopy[c % style.canopy.length]);
  if (s === "spring") for (let i = 0; i < 7; i++) ellipse(ctx, { x: base.x + (hash(x, y, i) - 0.5) * 34 * z + sway, y: base.y - (32 + hash(y, x, i) * 30) * z }, 1.8 * z, 1.8 * z, i % 2 ? "#f3dcdb" : "#fff", null);
  if (s === "autumn") for (let i = 0; i < 5; i++) ellipse(ctx, { x: base.x + (hash(x, y, i) - 0.5) * 32 * z + sway, y: base.y - (34 + hash(y, x, i) * 26) * z }, 2 * z, 1.6 * z, "#d49a86", null);
}
function drawProp(ctx: CanvasRenderingContext2D, scene: Scene, prop: Prop, style: Style) {
  const { camera, state, now, reducedMotion } = scene, s = season(state), z = camera.zoom, x = prop.x, y = prop.y, c = P(camera, x, y);
  switch (prop.kind) {
    case "tree": case "pine": tree(ctx, camera, x, y, style, s, reducedMotion ? 0 : now, prop.kind === "pine"); break;
    case "bush": {
      shadow(ctx, camera, x, y, 12);
      const color = s === "winter" ? "#e3e7e8" : s === "autumn" ? "#d8c49a" : "#a9ba9d";
      for (const [dx, dy, r] of [[-6, -8, 9], [6, -9, 9], [0, -14, 10]]) ellipse(ctx, { x: c.x + dx * z, y: c.y + dy * z }, r * z, r * 0.8 * z, color);
      if (s === "summer") for (let i = 0; i < 3; i++) ellipse(ctx, { x: c.x + (i - 1) * 7 * z, y: c.y - (10 + i % 2 * 5) * z }, 1.8 * z, 1.8 * z, "#d49a98", null);
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
  const { camera, state } = scene, z = camera.zoom, night = darkness(state.minute) > 0.4, winter = season(state) === "winter";
  const x0 = b.x - 0.5, y0 = b.y - 0.5, x1 = b.x + b.w - 0.5, y1 = b.y + b.d - 0.5;
  const faces = boxFaces(camera, x0, y0, x1, y1, b.h);
  for (const face of faces) {
    poly(ctx, [face.a, face.b, face.c, face.d], face.light ? b.wall : shade(b.wall, 0.9));
    // Plank lines, windows (lit at night) and the door on its side.
    ctx.strokeStyle = "rgba(22,22,22,.08)"; ctx.lineWidth = 1;
    for (const v of [0.25, 0.5, 0.75]) { const a = onFace(face, 0, v), c = onFace(face, 1, v); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
    const length = face.side === "n" || face.side === "s" ? b.w : b.d;
    const doorU = face.side === b.side ? (b.side === "n" || b.side === "s" ? (b.door.x - x0) / b.w : (face.side === "e" ? (y1 - b.door.y) / b.d : (b.door.y - y0) / b.d)) : -1;
    const doorAlong = face.side === "n" ? 1 - doorU : doorU;
    for (let i = 0; i < length; i++) {
      const u = (i + 0.5) / length;
      if (doorU >= 0 && Math.abs(u - doorAlong) < 0.5 / length) continue;
      poly(ctx, facePatch(face, u - 0.14 / length * 2, u + 0.14 / length * 2, 0.4, 0.72), night ? "#f3dfa0" : "#c4d0d6");
      if (night) { ctx.fillStyle = "rgba(246,227,166,.25)"; const p = onFace(face, u, 0.56); ctx.beginPath(); ctx.arc(p.x, p.y, 14 * z, 0, Math.PI * 2); ctx.fill(); }
    }
    if (doorU >= 0) {
      poly(ctx, facePatch(face, doorAlong - 0.16 / length * 2, doorAlong + 0.16 / length * 2, 0, 0.6), "#8b7d6f");
      ellipse(ctx, onFace(face, doorAlong + 0.08 / length * 2, 0.3), 1.2 * z, 1.2 * z, "#e2d7ad", null);
      // A little sign over shop doors.
      if (b.place && b.place !== "villager" && b.place !== "home") {
        poly(ctx, facePatch(face, doorAlong - 0.36 / length * 2, doorAlong + 0.36 / length * 2, 0.66, 0.86), "#f7f5f0");
        const p = onFace(face, doorAlong, 0.74); ctx.fillStyle = INK; ctx.font = `bold ${7.5 * z}px ui-monospace, monospace`; ctx.textAlign = "center";
        ctx.fillText(b.place === "store" ? "STORE" : b.place === "cafe" ? "CAFE" : "MARKET", p.x, p.y + 2.5 * z);
      }
    }
  }
  roof(ctx, camera, x0 - 0.12, y0 - 0.12, x1 + 0.12, y1 + 0.12, b.h, Math.min(b.w, b.d) * 16, winter ? "#f4f6f6" : b.roof);
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
    poly(ctx, face.points, face.light > 0.3 ? shade(color.startsWith("#") ? color : "#b9a7a4", 0.88) : color);
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
  shadow(ctx, camera, body.x, body.y, 11);
  const at = P(camera, body.x, body.y);
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

// ---------- Scene ----------
export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, width: number, height: number, pixelScale: number) {
  const { state, camera, now, reducedMotion } = scene, world = MAPS[state.farmer.map], s = season(state), style = STYLE[s], night = isNight(state);
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = s === "winter" ? "#e9ebea" : "#e3e0d6"; ctx.fillRect(0, 0, width, height);
  drawGround(ctx, scene, world, style);
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

  drawWeather(ctx, scene, width, height);
  const tint = skyTint(state.minute);
  if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, width, height); }
  drawNight(ctx, scene, lights, width, height, pixelScale);

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
