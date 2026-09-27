/**
 * The valley's two maps on an isometric tile grid, and the rotating 2.5D camera.
 *
 *   Farm (24 × 20): your house and shipping bin, a pond, a 12 × 10 field full of weeds and rocks, and the road east to town.
 *   Town (26 × 18): the General Store, the café, the Moonlight Market, a plaza with a fountain and notice board,
 *   villagers' houses and a pond. Its west road leads back to the farm.
 *
 * The camera rotates in quarter turns (animated smoothly): world points are rotated around the map centre, then
 * projected isometrically. Everything is drawn from projected points, so any angle renders correctly.
 */
export type Tile = Readonly<{ x: number; y: number }>;
export type MapId = "farm" | "town";
export type Side = "n" | "e" | "s" | "w";
export type Building = Readonly<{
  id: string; name: string; x: number; y: number; w: number; d: number; h: number; door: Tile; side: Side;
  wall: string; roof: string; place?: "home" | "store" | "cafe" | "market" | "villager";
}>;
export type Prop = Readonly<{ kind: "tree" | "pine" | "bush" | "rock" | "fence" | "fountain" | "board" | "bin" | "lamp" | "bench" | "well" | "sign"; x: number; y: number }>;
export type WorldMap = Readonly<{
  id: MapId; width: number; height: number; water: ReadonlySet<number>; paths: ReadonlySet<number>; field: ReadonlySet<number>;
  buildings: readonly Building[]; props: readonly Prop[]; exit: Tile; arrive: Tile; spawn: Tile; blocked: ReadonlySet<number>;
  spots: Readonly<Record<string, Tile>>;
}>;

export const key = (x: number, y: number) => y * 64 + x;
export const fromKey = (id: number): Tile => ({ x: id % 64, y: Math.floor(id / 64) });
export const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;

function build(id: MapId, width: number, height: number, draw: (put: {
  water: (x: number, y: number) => void; path: (x: number, y: number) => void; field: (x: number, y: number) => void;
}) => void, buildings: Building[], props: Prop[], exit: Tile, arrive: Tile, spawn: Tile, spots: Record<string, Tile>): WorldMap {
  const water = new Set<number>(), paths = new Set<number>(), field = new Set<number>();
  draw({ water: (x, y) => water.add(key(x, y)), path: (x, y) => paths.add(key(x, y)), field: (x, y) => field.add(key(x, y)) });
  const blocked = new Set<number>(water);
  for (const b of buildings) for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) blocked.add(key(x, y));
  for (const prop of props) if (prop.kind !== "sign") blocked.add(key(prop.x, prop.y));
  for (const prop of props) if (prop.kind === "fountain") for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) blocked.add(key(prop.x + dx, prop.y + dy));
  return Object.freeze({ id, width, height, water, paths, field, buildings, props, exit, arrive, spawn, blocked, spots });
}

function edgeTrees(width: number, height: number, gaps: readonly Tile[], every = 1): Prop[] {
  const props: Prop[] = [];
  const open = (x: number, y: number) => gaps.some(gap => Math.abs(gap.x - x) + Math.abs(gap.y - y) <= 1);
  for (let x = 0; x < width; x += every) { if (!open(x, 0)) props.push({ kind: x % 3 ? "tree" : "pine", x, y: 0 }); if (!open(x, height - 1)) props.push({ kind: x % 4 ? "pine" : "tree", x, y: height - 1 }); }
  for (let y = 1; y < height - 1; y += every) { if (!open(0, y)) props.push({ kind: y % 3 ? "pine" : "tree", x: 0, y }); if (!open(width - 1, y)) props.push({ kind: y % 2 ? "tree" : "pine", x: width - 1, y }); }
  return props;
}

// ---------- Farm ----------
export const FIELD = { x: 8, y: 7, w: 12, d: 10 } as const;
const FARM = build("farm", 24, 20, put => {
  for (let y = 12; y <= 17; y++) for (let x = 1; x <= 6; x++) if (((x - 3.6) / 2.9) ** 2 + ((y - 14.6) / 2.6) ** 2 <= 1) put.water(x, y);
  for (let x = 4; x <= 23; x++) put.path(x, 5);
  for (let y = 5; y <= 10; y++) put.path(21, y);
  for (let x = 21; x <= 23; x++) put.path(x, 10);
  for (let y = FIELD.y; y < FIELD.y + FIELD.d; y++) for (let x = FIELD.x; x < FIELD.x + FIELD.w; x++) put.field(x, y);
}, [
  { id: "house", name: "Your house", x: 2, y: 1, w: 4, d: 4, h: 58, door: { x: 4, y: 5 }, side: "s", wall: "#e9e4da", roof: "#b9a7a4", place: "home" },
], [
  ...edgeTrees(24, 20, [{ x: 23, y: 10 }]),
  { kind: "bin", x: 7, y: 4 }, { kind: "well", x: 7, y: 9 }, { kind: "sign", x: 20, y: 11 },
  { kind: "tree", x: 1, y: 7 }, { kind: "bush", x: 1, y: 9 }, { kind: "tree", x: 22, y: 15 }, { kind: "bush", x: 21, y: 17 }, { kind: "tree", x: 22, y: 3 },
  ...[8, 10, 12, 14, 16, 18].map(x => ({ kind: "fence" as const, x, y: 18 })),
], { x: 23, y: 10 }, { x: 22, y: 10 }, { x: 4, y: 6 }, { bed: { x: 4, y: 6 }, bin: { x: 7, y: 5 }, well: { x: 7, y: 8 }, pond: { x: 6, y: 12 }, farm: { x: 13, y: 6 } });

// ---------- Town ----------
const TOWN = build("town", 26, 18, put => {
  for (let x = 0; x <= 25; x++) put.path(x, 9);
  for (let y = 5; y <= 13; y++) for (let x = 10; x <= 16; x++) put.path(x, y);
  for (const x of [5, 12, 19]) for (let y = 5; y <= 9; y++) put.path(x, y);
  for (const x of [5, 11, 18]) for (let y = 9; y <= 11; y++) put.path(x, y);
  for (let y = 13; y <= 16; y++) for (let x = 21; x <= 24; x++) if (((x - 22.6) / 2) ** 2 + ((y - 14.8) / 1.9) ** 2 <= 1) put.water(x, y);
}, [
  { id: "store", name: "General Store", x: 3, y: 2, w: 4, d: 3, h: 56, door: { x: 5, y: 5 }, side: "s", wall: "#e6e1d6", roof: "#aebcaa", place: "store" },
  { id: "cafe", name: "RareFriends Cafe", x: 10, y: 2, w: 4, d: 3, h: 56, door: { x: 12, y: 5 }, side: "s", wall: "#ece6db", roof: "#d0aaa7", place: "cafe" },
  { id: "market", name: "Moonlight Market", x: 17, y: 2, w: 4, d: 3, h: 62, door: { x: 19, y: 5 }, side: "s", wall: "#e3e0e8", roof: "#a9a2bf", place: "market" },
  { id: "house-a", name: "Mochi & Bun's house", x: 4, y: 12, w: 3, d: 3, h: 46, door: { x: 5, y: 11 }, side: "n", wall: "#e9e3d8", roof: "#c9b99b", place: "villager" },
  { id: "house-b", name: "Tofu's house", x: 10, y: 14, w: 3, d: 3, h: 50, door: { x: 11, y: 13 }, side: "n", wall: "#e4e2dc", roof: "#a9b6c4", place: "villager" },
  { id: "house-c", name: "Kumo & Miso's house", x: 17, y: 12, w: 3, d: 3, h: 46, door: { x: 18, y: 11 }, side: "n", wall: "#ebe6dd", roof: "#b7a9b9", place: "villager" },
], [
  ...edgeTrees(26, 18, [{ x: 0, y: 9 }]),
  { kind: "fountain", x: 12, y: 11 }, { kind: "board", x: 15, y: 7 }, { kind: "bench", x: 10, y: 12 }, { kind: "bench", x: 15, y: 12 },
  { kind: "lamp", x: 9, y: 6 }, { kind: "lamp", x: 17, y: 7 }, { kind: "lamp", x: 9, y: 11 }, { kind: "lamp", x: 16, y: 13 },
  { kind: "tree", x: 2, y: 7 }, { kind: "tree", x: 23, y: 5 }, { kind: "bush", x: 8, y: 3 }, { kind: "bush", x: 15, y: 3 }, { kind: "tree", x: 7, y: 15 }, { kind: "pine", x: 14, y: 15 },
], { x: 0, y: 9 }, { x: 1, y: 9 }, { x: 1, y: 9 }, {
  store: { x: 5, y: 6 }, cafe: { x: 12, y: 6 }, market: { x: 19, y: 6 }, plaza: { x: 11, y: 10 }, bench: { x: 10, y: 13 }, board: { x: 15, y: 8 },
  pond: { x: 21, y: 12 }, homeA: { x: 5, y: 10 }, homeB: { x: 11, y: 12 }, homeC: { x: 18, y: 10 }, gate: { x: 1, y: 9 }, fountain: { x: 14, y: 11 },
});

export const MAPS: Readonly<Record<MapId, WorldMap>> = { farm: FARM, town: TOWN };
export const inside = (map: WorldMap, tile: Tile) => tile.x >= 0 && tile.y >= 0 && tile.x < map.width && tile.y < map.height;
export const buildingAt = (map: WorldMap, tile: Tile) => map.buildings.find(b => tile.x >= b.x && tile.x < b.x + b.w && tile.y >= b.y && tile.y < b.y + b.d) ?? null;
export const propAt = (map: WorldMap, tile: Tile) => map.props.find(prop => prop.x === tile.x && prop.y === tile.y
  || (prop.kind === "fountain" && tile.x >= prop.x && tile.x <= prop.x + 1 && tile.y >= prop.y && tile.y <= prop.y + 1)) ?? null;
export const isWater = (map: WorldMap, tile: Tile) => map.water.has(key(tile.x, tile.y));
export const isField = (map: WorldMap, tile: Tile) => map.field.has(key(tile.x, tile.y));

// ---------- Routing ----------
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** Breadth-first route to the nearest goal (exclusive of the start). Extra blocked tiles (décor) can be passed in. */
export function route(map: WorldMap, from: Tile, goals: readonly Tile[], extra: ReadonlySet<number> = new Set()): Tile[] | null {
  const start = key(from.x, from.y), goalSet = new Set(goals.map(goal => key(goal.x, goal.y)));
  if (goalSet.has(start)) return [];
  const previous = new Map<number, number>([[start, -1]]), queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index], tile = fromKey(current);
    for (const [dx, dy] of STEPS) {
      const next = { x: tile.x + dx, y: tile.y + dy }, id = key(next.x, next.y);
      if (previous.has(id) || !inside(map, next)) continue;
      const goal = goalSet.has(id);
      if (!goal && (map.blocked.has(id) || extra.has(id))) continue;
      previous.set(id, current);
      if (goal) {
        const path: Tile[] = [];
        for (let at = id; at !== start; at = previous.get(at)!) path.unshift(fromKey(at));
        return path;
      }
      queue.push(id);
    }
  }
  return null;
}
export const walkable = (map: WorldMap, tile: Tile, extra: ReadonlySet<number> = new Set()) =>
  inside(map, tile) && !map.blocked.has(key(tile.x, tile.y)) && !extra.has(key(tile.x, tile.y));
/** Walkable neighbours of a tile, for standing next to something you act on. */
export const around = (map: WorldMap, tile: Tile, extra: ReadonlySet<number> = new Set()) =>
  STEPS.map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy })).filter(next => walkable(map, next, extra));

// ---------- Rotating isometric camera ----------
export const TILE_W = 64, TILE_H = 32;
export const VIEW = { width: 960, height: 640 } as const;
/** `width`/`height` are the logical view size (the canvas fits its shorter side to about 560 logical pixels). */
export type Camera = Readonly<{ angle: number; cx: number; cy: number; focusX: number; focusY: number; zoom: number; width?: number; height?: number }>;
/** Rotate a world point around the map centre by `angle` quarter turns. */
export function rotate(camera: Camera, x: number, y: number) {
  const theta = camera.angle * Math.PI / 2, dx = x - camera.cx, dy = y - camera.cy, c = Math.cos(theta), s = Math.sin(theta);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
export function unrotate(camera: Camera, rx: number, ry: number) {
  const theta = -camera.angle * Math.PI / 2, c = Math.cos(theta), s = Math.sin(theta);
  return { x: rx * c - ry * s + camera.cx, y: rx * s + ry * c + camera.cy };
}
/** World-space point (with a lift in pixels) → view pixels. */
export function project(camera: Camera, x: number, y: number, lift = 0) {
  const r = rotate(camera, x, y), f = rotate(camera, camera.focusX, camera.focusY);
  return {
    x: (camera.width ?? VIEW.width) / 2 + ((r.x - r.y) - (f.x - f.y)) * TILE_W / 2 * camera.zoom,
    y: (camera.height ?? VIEW.height) / 2 + 30 + ((r.x + r.y) - (f.x + f.y)) * TILE_H / 2 * camera.zoom - lift * camera.zoom,
  };
}
/** Depth for painter's-order sorting: larger is nearer the viewer. */
export const depth = (camera: Camera, x: number, y: number) => { const r = rotate(camera, x, y); return r.x + r.y; };
/** View pixels → the world tile under them (at ground level). */
export function unproject(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  const f = rotate(camera, camera.focusX, camera.focusY);
  const a = (sx - (camera.width ?? VIEW.width) / 2) / (TILE_W / 2 * camera.zoom) + (f.x - f.y), b = (sy - (camera.height ?? VIEW.height) / 2 - 30) / (TILE_H / 2 * camera.zoom) + (f.x + f.y);
  return unrotate(camera, (a + b) / 2, (b - a) / 2);
}
export const tileUnder = (camera: Camera, sx: number, sy: number): Tile => { const p = unproject(camera, sx, sy); return { x: Math.round(p.x), y: Math.round(p.y) }; };
/**
 * Screen-relative movement: W/up moves toward the top-right of the screen whatever the camera angle, like the café.
 * Returns the world grid direction for a screen direction at the camera's (nearest quarter) angle.
 */
export function screenToWorldDir(angle: number, dx: number, dy: number): { dx: number; dy: number } {
  const quarter = ((Math.round(angle) % 4) + 4) % 4;
  let x = dx, y = dy;
  for (let turn = 0; turn < quarter; turn++) [x, y] = [y, -x];
  return { dx: x, dy: y };
}
/** Sprite facing for a world direction at the current angle (the SDK sprites face down/up/left/right). */
export function facingFor(angle: number, dx: number, dy: number): "down" | "up" | "left" | "right" {
  const theta = angle * Math.PI / 2, c = Math.cos(theta), s = Math.sin(theta), rx = dx * c - dy * s, ry = dx * s + dy * c;
  return Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? "right" : "left") : (ry > 0 ? "down" : "up");
}
