/**
 * RareFriends Valley simulation: pure and deterministic (seeded), so it runs and is tested in Node.
 *
 * A day runs from 6:00 to 2:00 on the clock. Every action costs energy and time. Crops grow one day per night
 * when watered (rain and snow water them too); fertilizer, RF-exclusive décor and the family perk add bonus growth.
 * Sleeping ships what's in the bin, grows the crops, rolls tomorrow's weather and turns the seasons.
 */
import {
  ACTION_MINUTES, BACKPACK_SLOTS, BACKPACK_UPGRADES, BLESSING_CAPS, CAN_CAPACITY, CAN_UPGRADES, CROPS, DAY_START, DAYS_PER_SEASON, DECOR,
  DROWSY, DUPLICATE_GOLD, ENERGY_COST, EXCLUSIVES, FERTILIZER_PRICE, FOODS, FORAGE, GIFT_POINTS, HEART, HELPER_HEARTS, HELPER_WATERS,
  HOE_UPGRADES, MAX_ENERGY, MAX_FRIENDSHIP, PASS_OUT, SEASONS, SECONDS_PER_MINUTE, SHOP_HOURS, STACK, TALK_POINTS, TIRED_AT, VILLAGERS,
  cropById, cropStage, decorByKind, isItemId, itemInfo, type CropId, type DecorKind, type FoodId, type ForageId, type ItemId, type Season,
  type ToolId, type Villager,
} from "./data.ts";
import { FIELD, MAPS, around, buildingAt, fromKey, inside, isField, isWater, key, propAt, route, same, walkable, type MapId, type Tile, type WorldMap } from "./world.ts";

export type Weather = "sun" | "rain" | "snow";
export type Crop = { id: CropId; grown: number; regrowing: boolean };
export type Plot = { tilled: boolean; watered: boolean; fertilizer: 0 | 1 | 2; crop: Crop | null; debris: "weed" | "rock" | "stump" | null };
export type Slot = { id: ItemId; count: number };
export type Walker = { map: MapId; x: number; y: number; path: Tile[]; dirX: number; dirY: number; moving: boolean };
export type Resident = {
  id: string; name: string; family: number; owned: number | null; points: number; talked: boolean; gifted: boolean;
  walker: Walker; visible: boolean; target: string; line: number; idle: number;
};
export type PlacedDecor = { id: number; kind: DecorKind; x: number; y: number };
export type Forage = { map: MapId; x: number; y: number; id: ForageId };
export type Request = { villager: string; item: ItemId; count: number; reward: number; done: boolean };
export type Prefs = { music: boolean; sfx: boolean; volume: number; track: string; orbit: boolean };
export type Diary = {
  day: number; season: Season; year: number; shipped: Slot[]; earned: number; harvested: number; watered: number; tilled: number;
  gifts: number; hearts: string[]; grown: number; bonusGrowth: number; withered: number; passedOut: boolean; weather: Weather; tomorrow: Weather;
};
export type Action = "till" | "water" | "plant" | "harvest" | "clear" | "fertilize" | "refill" | "forage";
export type ValleyEvent =
  | { kind: "action"; action: Action; x: number; y: number; golden?: boolean; bonus?: boolean }
  | { kind: "bump"; text: string }
  | { kind: "coins"; amount: number }
  | { kind: "talk"; villager: string; family: number }
  | { kind: "gift"; villager: string; reaction: keyof typeof GIFT_POINTS }
  | { kind: "heart"; villager: string; hearts: number }
  | { kind: "tired" } | { kind: "exhausted" } | { kind: "drowsy" }
  | { kind: "travel"; map: MapId }
  | { kind: "morning"; season: Season; weather: Weather }
  | { kind: "season"; season: Season }
  | { kind: "eat"; energy: number }
  | { kind: "buy" } | { kind: "place" } | { kind: "request" }
  | { kind: "say"; text: string }
  | { kind: "open"; what: "talk" | "bin" | "bed" | "shop" | "board"; target?: string };

export type ValleyState = {
  seed: number; day: number; season: number; year: number; minute: number; weather: Weather; tomorrow: Weather;
  gold: number; energy: number; farmer: Walker; tool: ToolId; selected: number; manual: { dx: number; dy: number } | null; pending: { tile: Tile } | null;
  plots: Map<number, Plot>; inventory: (Slot | null)[]; packLevel: number; canLevel: number; hoeLevel: number; water: number;
  bin: Slot[]; decor: PlacedDecor[]; decorOwned: Partial<Record<DecorKind, number>>; collection: Set<DecorKind>; nextId: number;
  residents: Resident[]; forage: Forage[]; request: Request | null; blessings: number[]; sproutCharges: number;
  familyId: number; phase: "intro" | "play" | "diary"; started: boolean; diary: Diary; lastDiary: Diary | null; warned: { tired: boolean; drowsy: boolean };
  totals: { shipped: number; earned: number; harvested: number; days: number };
  prefs: Prefs; events: ValleyEvent[]; clock: number;
  /** Friendship with owned Friends from a save, applied when the wallet roster arrives (it can come after the save). */
  savedFriends: Record<string, number>;
};

// ---------- Randomness ----------
/** mulberry32 step on the saved seed, so a restored save continues the same sequence. */
function random(state: ValleyState) {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- Queries ----------
export const season = (state: ValleyState): Season => SEASONS[state.season];
export const map = (state: ValleyState): WorldMap => MAPS[state.farmer.map];
export const maxEnergy = (state: ValleyState) => MAX_ENERGY + (state.familyId === 6 ? 30 : 0);
export const canCapacity = (state: ValleyState) => CAN_CAPACITY[state.canLevel] * (state.familyId === 8 ? 2 : 1);
export const packSize = (state: ValleyState) => BACKPACK_SLOTS[state.packLevel];
export const tired = (state: ValleyState) => state.energy <= TIRED_AT;
export const isNight = (state: ValleyState) => state.minute >= 19 * 60 || state.minute < 5 * 60;
export const farmerTile = (state: ValleyState): Tile => ({ x: Math.round(state.farmer.x), y: Math.round(state.farmer.y) });
export const plotAt = (state: ValleyState, tile: Tile) => state.plots.get(key(tile.x, tile.y)) ?? null;
export const decorAt = (state: ValleyState, tile: Tile) => state.decor.find(item => item.x === tile.x && item.y === tile.y) ?? null;
export const blessing = (state: ValleyState, tier: number) => Math.min(state.blessings[tier] ?? 0, BLESSING_CAPS[tier]);
export const clockText = (minute: number) => { const hour = Math.floor(minute / 60) % 24, m = minute % 60; return `${hour % 12 === 0 ? 12 : hour % 12}:${String(Math.floor(m / 10) * 10).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`; };
export const dateText = (state: ValleyState) => `${season(state)[0].toUpperCase()}${season(state).slice(1)} ${state.day} · Year ${state.year}`;
export const shopOpen = (state: ValleyState, place: keyof typeof SHOP_HOURS) => state.minute >= SHOP_HOURS[place][0] && state.minute < SHOP_HOURS[place][1];
const energyCost = (state: ValleyState, action: keyof typeof ENERGY_COST) => ENERGY_COST[action] * (state.familyId === 0 ? 0.8 : 1);
const walkSpeed = (state: ValleyState) => 3.2 * (state.familyId === 5 ? 1.3 : 1) * (tired(state) ? 0.7 : 1);
const decorBlocked = (state: ValleyState) => new Set(state.decor.map(item => key(item.x, item.y)));
const blockedFor = (state: ValleyState, mapId: MapId) => mapId === "farm" ? decorBlocked(state) : new Set<number>();

// ---------- Setup ----------
const blankDiary = (state: Pick<ValleyState, "day" | "season" | "year" | "weather" | "tomorrow">): Diary => ({
  day: state.day, season: SEASONS[state.season], year: state.year, shipped: [], earned: 0, harvested: 0, watered: 0, tilled: 0, gifts: 0, hearts: [],
  grown: 0, bonusGrowth: 0, withered: 0, passedOut: false, weather: state.weather, tomorrow: state.tomorrow,
});
const walker = (mapId: MapId, tile: Tile): Walker => ({ map: mapId, x: tile.x, y: tile.y, path: [], dirX: 0, dirY: 1, moving: false });

function residentFor(villager: Villager): Resident {
  return { id: villager.id, name: villager.name, family: villager.family, owned: null, points: 0, talked: false, gifted: false,
    walker: walker("town", MAPS.town.spots.plaza), visible: false, target: "home", line: 0, idle: 0 };
}
export function createValley(options: { familyId: number; seed?: number }): ValleyState {
  const state: ValleyState = {
    seed: options.seed ?? 20260927, day: 1, season: 0, year: 1, minute: DAY_START, weather: "sun", tomorrow: "sun",
    gold: 500, energy: 0, farmer: walker("farm", MAPS.farm.spawn), tool: "hand", selected: 0, manual: null, pending: null,
    plots: new Map(), inventory: [], packLevel: 0, canLevel: 0, hoeLevel: 0, water: 0,
    bin: [], decor: [], decorOwned: {}, collection: new Set(), nextId: 1,
    residents: VILLAGERS.map(residentFor), forage: [], request: null, blessings: [0, 0, 0, 0], sproutCharges: 0,
    familyId: options.familyId, phase: "intro", started: false, diary: null!, lastDiary: null, warned: { tired: false, drowsy: false },
    totals: { shipped: 0, earned: 0, harvested: 0, days: 0 }, prefs: { music: true, sfx: true, volume: 0.6, track: "auto", orbit: true }, events: [], clock: 0, savedFriends: {},
  };
  state.energy = maxEnergy(state); state.water = canCapacity(state);
  state.inventory = Array.from({ length: packSize(state) }, () => null);
  addItem(state, "seed:turnip", 12); addItem(state, "seed:potato", 6); addItem(state, "fertilizer", 4); addItem(state, "latte", 1);
  // The field starts wild: weeds, rocks and old stumps to clear. A small patch near the path is ready to till.
  for (let y = FIELD.y; y < FIELD.y + FIELD.d; y++) for (let x = FIELD.x; x < FIELD.x + FIELD.w; x++) {
    const roll = random(state), near = x < FIELD.x + 5 && y < FIELD.y + 3;
    state.plots.set(key(x, y), { tilled: false, watered: false, fertilizer: 0, crop: null, debris: near ? null : roll < 0.22 ? "weed" : roll < 0.32 ? "rock" : roll < 0.36 ? "stump" : null });
  }
  state.diary = blankDiary(state);
  state.tomorrow = rollWeather(state, 0);
  spawnForage(state); postRequest(state); placeResidents(state);
  return state;
}

// ---------- Inventory ----------
export function countItem(state: ValleyState, id: ItemId) { return state.inventory.reduce((sum, slot) => sum + (slot?.id === id ? slot.count : 0), 0); }
export function addItem(state: ValleyState, id: ItemId, count = 1): boolean {
  let left = count;
  for (const slot of state.inventory) if (slot?.id === id && slot.count < STACK) { const add = Math.min(left, STACK - slot.count); slot.count += add; left -= add; if (!left) return true; }
  for (let index = 0; index < state.inventory.length && left; index++) if (!state.inventory[index]) { const add = Math.min(left, STACK); state.inventory[index] = { id, count: add }; left -= add; }
  return left === 0;
}
export function removeItem(state: ValleyState, id: ItemId, count = 1): boolean {
  if (countItem(state, id) < count) return false;
  let left = count;
  for (let index = state.inventory.length - 1; index >= 0 && left; index--) {
    const slot = state.inventory[index];
    if (slot?.id !== id) continue;
    const take = Math.min(left, slot.count); slot.count -= take; left -= take;
    if (!slot.count) state.inventory[index] = null;
  }
  return true;
}
const hasRoom = (state: ValleyState, id: ItemId) => state.inventory.some(slot => !slot || (slot.id === id && slot.count < STACK));
export const selectedSlot = (state: ValleyState) => state.inventory[state.selected] ?? null;
/** The seed packet the Seeds tool plants: the selected slot if it holds seeds, else the first seeds in the backpack. */
export function activeSeeds(state: ValleyState): Slot | null {
  const chosen = selectedSlot(state);
  if (chosen?.id.startsWith("seed:")) return chosen;
  return state.inventory.find(slot => slot?.id.startsWith("seed:")) ?? null;
}

// ---------- Weather, forage, requests ----------
function rollWeather(state: ValleyState, seasonIndex: number): Weather {
  const roll = random(state), s = SEASONS[seasonIndex];
  if (s === "winter") return roll < 0.4 ? "snow" : "sun";
  return roll < (s === "summer" ? 0.2 : 0.28) ? "rain" : "sun";
}
function spawnForage(state: ValleyState) {
  state.forage = [];
  const kind = FORAGE.find(item => item.season === season(state))!;
  for (const [mapId, count] of [["farm", 3], ["town", 2]] as const) {
    const world = MAPS[mapId], blocked = blockedFor(state, mapId);
    for (let tries = 0, placed = 0; tries < 60 && placed < count; tries++) {
      const tile = { x: 1 + Math.floor(random(state) * (world.width - 2)), y: 1 + Math.floor(random(state) * (world.height - 2)) };
      if (!walkable(world, tile, blocked) || world.paths.has(key(tile.x, tile.y)) || isField(world, tile) || state.forage.some(item => item.map === mapId && same(item, tile))) continue;
      if (mapId === "farm" && Math.abs(tile.x - world.spawn.x) + Math.abs(tile.y - world.spawn.y) < 2) continue;
      state.forage.push({ map: mapId, x: tile.x, y: tile.y, id: kind.id }); placed++;
    }
  }
}
function postRequest(state: ValleyState) {
  const options: ItemId[] = [...CROPS.filter(crop => crop.season === season(state)).map(crop => crop.id), FORAGE.find(item => item.season === season(state))!.id];
  const item = options[Math.floor(random(state) * options.length)], count = itemInfo(item).sell >= 150 ? 1 : 2 + Math.floor(random(state) * 3);
  const villager = VILLAGERS[Math.floor(random(state) * VILLAGERS.length)];
  state.request = { villager: villager.id, item, count, reward: Math.round(itemInfo(item).sell * count * 1.6 / 10) * 10 + 50, done: false };
}
export function deliverRequest(state: ValleyState): string {
  const request = state.request;
  if (!request || request.done) return "No open request today. Check again tomorrow.";
  if (!removeItem(state, request.item, request.count)) return `You need ${request.count} × ${itemInfo(request.item).name}.`;
  request.done = true; state.gold += request.reward; state.diary.earned += request.reward;
  const resident = state.residents.find(item => item.id === request.villager);
  if (resident) befriend(state, resident, 60);
  state.events.push({ kind: "request" }, { kind: "coins", amount: request.reward });
  return `Delivered! +${request.reward} G and a happy ${resident?.name ?? "neighbour"}.`;
}

// ---------- Owned Friends move into the valley ----------
/** Your other owned Friends (from the trusted host's roster) become villagers with their canonical art. */
export function setOwnedFriends(state: ValleyState, owned: readonly { id: number; family: number | null }[]) {
  const keep = new Map(state.residents.filter(item => item.owned !== null).map(item => [item.owned, item]));
  const next = owned.slice(0, 12).map((friend, index) => keep.get(friend.id) ?? ({
    id: `owned-${friend.id}`, name: `#${friend.id}`, family: friend.family ?? index % 9, owned: friend.id, points: state.savedFriends[`owned-${friend.id}`] ?? 0, talked: false, gifted: false,
    walker: walker("town", MAPS.town.spots.fountain), visible: false, target: "home", line: index, idle: 0,
  } satisfies Resident));
  state.residents = [...state.residents.filter(item => item.owned === null), ...next];
  placeResidents(state);
}
export const hearts = (resident: Resident) => Math.floor(resident.points / HEART);
export const helpers = (state: ValleyState) => state.residents.filter(item => item.owned !== null && hearts(item) >= HELPER_HEARTS);

// ---------- Villager schedules ----------
const OWNED_SPOTS = ["fountain", "pond", "bench", "plaza", "board"] as const;
/** Where a villager wants to be right now (a spot name on their map), or null when they're indoors. */
function scheduleFor(state: ValleyState, resident: Resident): { map: MapId; spot: string } | null {
  const hour = state.minute / 60, info = VILLAGERS.find(item => item.id === resident.id), wet = state.weather !== "sun";
  if (resident.owned !== null) {
    if (hour < 7 || hour >= 22) return null;
    // Helpers visit the farm in the morning to water, then head to town.
    if (hour < 10 && hearts(resident) >= HELPER_HEARTS) return { map: "farm", spot: "farm" };
    return { map: "town", spot: wet ? "cafe" : OWNED_SPOTS[(resident.line + state.day) % OWNED_SPOTS.length] };
  }
  if (!info) return null;
  const home = homeSpot(resident);
  if (hour < 8 || hour >= 21) return null;
  if (hour < 17) return { map: "town", spot: wet && (info.work === "pond" || info.work === "plaza" || info.work === null) ? "cafe" : info.work === null ? (state.day % 2 ? "fountain" : "pond") : info.work === "home" || info.work === "farm" ? home : info.work };
  if (hour < 20) return { map: "town", spot: wet ? "cafe" : ["bench", "fountain", "plaza", "cafe"][(VILLAGERS.indexOf(info) + state.day) % 4] };
  return { map: "town", spot: home };
}
function placeResidents(state: ValleyState) {
  for (const resident of state.residents) {
    const plan = scheduleFor(state, resident);
    resident.visible = plan !== null; resident.target = plan ? `${plan.map}:${plan.spot}` : "home";
    if (plan) { resident.walker = walker(plan.map, spotTile(plan.map, plan.spot, resident)); }
  }
}
function spotTile(mapId: MapId, spot: string, resident: Resident): Tile {
  const world = MAPS[mapId], base = world.spots[spot] ?? world.spots.plaza ?? world.spawn;
  // Spread villagers who share a spot over nearby free tiles.
  const offset = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1]][Math.abs(hash(resident.id)) % 7];
  const tile = { x: base.x + offset[0], y: base.y + offset[1] };
  return walkable(world, tile) ? tile : base;
}
const homeSpot = (resident: Resident) => resident.id === "tofu" ? "homeB" : resident.id === "mochi" || resident.id === "bun" ? "homeA" : "homeC";
const hash = (text: string) => [...text].reduce((value, char) => (value * 31 + char.charCodeAt(0)) | 0, 7);
function stepWalker(body: Walker, speed: number, dt: number) {
  body.moving = false;
  let budget = speed * dt;
  while (body.path.length && budget > 0) {
    const next = body.path[0], dx = next.x - body.x, dy = next.y - body.y, length = Math.hypot(dx, dy);
    if (length > 0.001) { body.dirX = Math.sign(Math.round(dx * 100)); body.dirY = body.dirX ? 0 : Math.sign(dy); }
    if (length <= budget) { body.x = next.x; body.y = next.y; body.path.shift(); budget -= length; }
    else { body.x += dx / length * budget; body.y += dy / length * budget; budget = 0; }
    body.moving = true;
  }
}
function updateResidents(state: ValleyState, dt: number) {
  for (const resident of state.residents) {
    const plan = scheduleFor(state, resident);
    const target = plan ? `${plan.map}:${plan.spot}` : "home";
    if (!plan) {
      // Walk home, then go indoors.
      if (resident.visible && resident.target !== "home") {
        resident.target = "home";
        const world = MAPS[resident.walker.map], home = world.id === "town" ? world.spots[homeSpot(resident)] : world.exit;
        resident.walker.path = route(world, { x: Math.round(resident.walker.x), y: Math.round(resident.walker.y) }, [home], blockedFor(state, resident.walker.map)) ?? [];
      }
      stepWalker(resident.walker, 1.8, dt);
      if (!resident.walker.path.length) resident.visible = false;
      continue;
    }
    if (!resident.visible) { resident.visible = true; resident.walker = walker(plan.map, plan.map === "town" ? MAPS.town.spots[resident.owned !== null ? "gate" : homeSpot(resident)] : MAPS.farm.arrive); resident.target = ""; }
    if (resident.target !== target) {
      resident.target = target;
      if (resident.walker.map !== plan.map) resident.walker = walker(plan.map, MAPS[plan.map].arrive);
      resident.walker.path = route(MAPS[plan.map], { x: Math.round(resident.walker.x), y: Math.round(resident.walker.y) }, [spotTile(plan.map, plan.spot, resident)], blockedFor(state, plan.map)) ?? [];
    }
    stepWalker(resident.walker, 1.8, dt);
    // Helpers potter along the field rows while they're on the farm.
    if (!resident.walker.path.length && (resident.idle -= dt) <= 0) {
      resident.idle = 3 + random(state) * 4;
      if (plan.map === "farm") {
        const tile = { x: FIELD.x - 1 + Math.floor(random(state) * (FIELD.w + 2)), y: FIELD.y - 1 };
        resident.walker.path = route(MAPS.farm, { x: Math.round(resident.walker.x), y: Math.round(resident.walker.y) }, [tile], decorBlocked(state)) ?? [];
      } else resident.walker.dirY = random(state) < 0.5 ? 1 : 0, resident.walker.dirX = resident.walker.dirY ? 0 : 1;
    }
  }
}

// ---------- Main loop ----------
export function setManual(state: ValleyState, dir: { dx: number; dy: number } | null) { state.manual = dir; if (dir) { state.pending = null; state.farmer.path = []; } }
export function update(state: ValleyState, dt: number) {
  if (state.phase !== "play") return;
  dt = Math.min(dt, 0.1); state.clock += dt;
  state.minute += dt / SECONDS_PER_MINUTE;
  const body = state.farmer, world = map(state);
  if (state.manual) {
    const speed = walkSpeed(state) * dt, nx = body.x + state.manual.dx * speed, ny = body.y + state.manual.dy * speed;
    const ahead = { x: Math.round(nx + state.manual.dx * 0.45), y: Math.round(ny + state.manual.dy * 0.45) };
    body.dirX = state.manual.dx; body.dirY = state.manual.dy; body.moving = true;
    if (walkable(world, ahead, blockedFor(state, body.map)) || same(ahead, world.exit)) {
      body.x = Math.max(0, Math.min(world.width - 1, nx)); body.y = Math.max(0, Math.min(world.height - 1, ny));
      // Slide back onto the row/column you aren't moving along, so walking lines up with the tiles.
      if (state.manual.dx) body.y += (Math.round(body.y) - body.y) * Math.min(1, dt * 10); else body.x += (Math.round(body.x) - body.x) * Math.min(1, dt * 10);
    } else body.moving = false;
  } else stepWalker(body, walkSpeed(state), dt);
  if (state.pending && !body.path.length && !state.manual) {
    const tile = state.pending.tile; state.pending = null;
    const message = act(state, tile);
    if (message) state.events.push({ kind: "say", text: message });
  }
  // Walking onto the road's end travels between the farm and town.
  if (same(farmerTile(state), world.exit)) travel(state, world.id === "farm" ? "town" : "farm");
  updateResidents(state, dt);
  if (tired(state) && !state.warned.tired) { state.warned.tired = true; state.events.push({ kind: "tired" }); }
  if (state.minute >= DROWSY && !state.warned.drowsy) { state.warned.drowsy = true; state.events.push({ kind: "drowsy" }); }
  if (state.minute >= PASS_OUT) passOut(state);
}
export function travel(state: ValleyState, to: MapId) {
  const body = state.farmer;
  state.farmer = { ...walker(to, MAPS[to].arrive), dirX: to === "town" ? 1 : -1, dirY: 0 };
  body.path = []; state.pending = null; state.minute += 10;
  state.events.push({ kind: "travel", map: to });
}

// ---------- Acting on tiles ----------
/** What a tap on this tile would do with the current tool, for hints and for `act`. */
export function actionFor(state: ValleyState, tile: Tile): { action: Action | "talk" | "bin" | "bed" | "shop" | "board" | "walk" | "none"; label: string; target?: string } {
  const world = map(state);
  if (!inside(world, tile)) return { action: "none", label: "" };
  const resident = residentAt(state, tile);
  if (resident) return { action: "talk", label: `Talk to ${resident.name}`, target: resident.id };
  const building = buildingAt(world, tile) ?? world.buildings.find(item => same(item.door, tile)) ?? null;
  if (building?.place === "home") return { action: "bed", label: "Go to bed" };
  if (building?.place && building.place !== "villager") return { action: "shop", label: `Visit ${building.name}`, target: building.place };
  const prop = propAt(world, tile);
  if (prop?.kind === "bin") return { action: "bin", label: "Shipping bin" };
  if (prop?.kind === "board") return { action: "board", label: "Notice board" };
  if (prop?.kind === "well" || isWater(world, tile)) return state.tool === "can" || state.water < canCapacity(state) ? { action: "refill", label: "Refill the watering can" } : { action: "none", label: "" };
  const found = state.forage.find(item => item.map === world.id && same(item, tile));
  if (found) return { action: "forage", label: `Pick up ${itemInfo(found.id).name}` };
  if (world.id !== "farm" || !isField(world, tile)) return walkable(world, tile, blockedFor(state, world.id)) ? { action: "walk", label: "" } : { action: "none", label: "" };
  const plot = plotAt(state, tile)!;
  const tool = state.tool;
  if (plot.debris) return tool === "hand" || tool === "hoe" ? { action: "clear", label: `Clear the ${plot.debris}` } : { action: "none", label: `Clear the ${plot.debris} first (Hands or Hoe)` };
  if (plot.crop && cropStage(cropById(plot.crop.id), plot.crop.grown, plot.crop.regrowing) === 3) return { action: "harvest", label: `Harvest ${cropById(plot.crop.id).name}` };
  if (tool === "hoe") return plot.tilled ? { action: "none", label: "Already tilled" } : { action: "till", label: "Till the soil" };
  if (tool === "can") return plot.tilled && !plot.watered ? { action: "water", label: "Water" } : { action: "none", label: plot.watered ? "Already watered today" : "Till it first" };
  if (tool === "seeds") {
    const seeds = activeSeeds(state);
    if (!seeds) return { action: "none", label: "No seeds. Buy some at the General Store." };
    return plot.tilled && !plot.crop ? { action: "plant", label: `Plant ${itemInfo(seeds.id).name}` } : { action: "none", label: plot.crop ? "Something is growing here" : "Till it first" };
  }
  if (tool === "fertilizer") return plot.tilled && plot.fertilizer < 2 && (state.sproutCharges > 0 || countItem(state, "fertilizer") > 0) ? { action: "fertilize", label: state.sproutCharges > 0 ? "Sprout Fertilizer" : "Fertilize" } : { action: "none", label: plot.tilled ? "No fertilizer left" : "Till it first" };
  // Hands: the smart action. Harvest (above), else till, plant the selected seeds, or water.
  if (!plot.tilled) return { action: "till", label: "Till the soil" };
  if (!plot.crop && activeSeeds(state)) return { action: "plant", label: `Plant ${itemInfo(activeSeeds(state)!.id).name}` };
  if (!plot.watered) return { action: "water", label: "Water" };
  return { action: "walk", label: "" };
}
export const residentAt = (state: ValleyState, tile: Tile) => state.residents.find(item => item.visible && item.walker.map === state.farmer.map
  && Math.abs(item.walker.x - tile.x) < 0.6 && Math.abs(item.walker.y - tile.y) < 0.6) ?? null;
const near = (state: ValleyState, tile: Tile) => Math.max(Math.abs(state.farmer.x - tile.x), Math.abs(state.farmer.y - tile.y)) <= 1.25;

/** A tap: walk next to the tile if needed, then act on arrival. Returns feedback, or "" when silent. */
export function tapTile(state: ValleyState, tile: Tile): string {
  if (state.phase !== "play") return "";
  const world = map(state), plan = actionFor(state, tile);
  state.manual = null;
  if (plan.action === "none") return plan.label;
  if (plan.action === "walk") {
    const path = route(world, farmerTile(state), [tile], blockedFor(state, world.id));
    if (!path) return "Can't walk there.";
    state.farmer.path = path; state.pending = null; return "";
  }
  if (near(state, tile)) return act(state, tile);
  const extra = blockedFor(state, world.id), goals = plan.action === "talk" ? around(world, tile, extra).concat([tile]) : around(world, tile, extra);
  const building = buildingAt(world, tile);
  const path = route(world, farmerTile(state), building ? [building.door] : goals, extra);
  if (!path) return "Can't reach that.";
  state.farmer.path = path; state.pending = { tile };
  return "";
}
/** Keyboard: act on the tile in front of your Friend. */
export function actInFront(state: ValleyState): string {
  const here = farmerTile(state), front = { x: here.x + state.farmer.dirX, y: here.y + state.farmer.dirY };
  const plan = actionFor(state, front);
  if (plan.action !== "none" && plan.action !== "walk") return act(state, front);
  const onHere = actionFor(state, here);
  if (onHere.action !== "none" && onHere.action !== "walk") return act(state, here);
  return plan.label || "Nothing to do here.";
}
/** Perform the tool action on a tile next to (or under) your Friend. */
export function act(state: ValleyState, tile: Tile): string {
  const plan = actionFor(state, tile), world = map(state);
  if (plan.action === "none" || plan.action === "walk") return plan.label;
  if (!near(state, tile) && plan.action !== "bed" && plan.action !== "shop") return "Move closer.";
  face(state, tile);
  if (plan.action === "talk" || plan.action === "bin" || plan.action === "bed" || plan.action === "shop" || plan.action === "board") {
    state.events.push({ kind: "open", what: plan.action, target: plan.target }); return "";
  }
  const action = plan.action as Action;
  const cost = action === "refill" || action === "forage" ? 0 : energyCost(state, action as keyof typeof ENERGY_COST);
  if (cost && state.energy <= 0) { state.events.push({ kind: "bump", text: "exhausted" }); return "You're exhausted. Eat something or go to bed."; }
  const plot = plotAt(state, tile);
  if (action === "refill") { state.water = canCapacity(state); state.minute += ACTION_MINUTES.refill; state.events.push({ kind: "action", action, x: tile.x, y: tile.y }); return "Watering can full."; }
  if (action === "forage") {
    const index = state.forage.findIndex(item => item.map === world.id && same(item, tile)), found = state.forage[index];
    if (!hasRoom(state, found.id)) return "Your backpack is full.";
    addItem(state, found.id); state.forage.splice(index, 1); state.events.push({ kind: "action", action, x: tile.x, y: tile.y });
    return `Picked up a ${itemInfo(found.id).name}.`;
  }
  if (!plot) return "";
  let message = "";
  const tiles = lineFrom(state, tile, action);
  if (action === "clear") { plot.debris = null; message = "Cleared."; }
  else if (action === "till") { for (const each of tiles) { const target = plotAt(state, each); if (target && !target.tilled && !target.debris) { target.tilled = true; state.diary.tilled++; if (state.weather !== "sun") target.watered = true; } } }
  else if (action === "water") {
    if (state.water <= 0) { state.events.push({ kind: "bump", text: "empty" }); return "The watering can is empty. Refill it at the pond or the well."; }
    for (const each of tiles) { const target = plotAt(state, each); if (target?.tilled && !target.watered && state.water > 0) { target.watered = true; state.water--; state.diary.watered++; } }
  } else if (action === "plant") {
    const seeds = activeSeeds(state)!, crop = cropById(seeds.id.slice(5) as CropId);
    if (crop.season !== season(state)) return `${crop.name} only grows in ${crop.season}.`;
    plot.crop = { id: crop.id, grown: 0, regrowing: false };
    if (!(state.familyId === 3 && random(state) < 0.15)) removeItem(state, seeds.id);
    message = `Planted ${crop.name}. Water it every day: ripe in ${crop.days} days.`;
  } else if (action === "fertilize") {
    if (state.sproutCharges > 0) { state.sproutCharges--; plot.fertilizer = 2; message = "Sprout Fertilizer: +50% nightly growth chance."; }
    else { removeItem(state, "fertilizer"); plot.fertilizer = Math.max(plot.fertilizer, 1) as 1 | 2; message = "Fertilized: +30% nightly growth chance."; }
  } else if (action === "harvest") {
    const crop = cropById(plot.crop!.id);
    const golden = random(state) < goldenChance(state, tile), bonus = random(state) < yieldChance(state, tile);
    const id: ItemId = golden ? `golden:${crop.id}` : crop.id, count = bonus ? 2 : 1;
    if (!hasRoom(state, id)) return "Your backpack is full. Ship or eat something first.";
    addItem(state, id, count); state.diary.harvested += count; state.totals.harvested += count;
    if (crop.regrow) plot.crop = { id: crop.id, grown: 0, regrowing: true }; else { plot.crop = null; plot.fertilizer = 0; }
    message = `${golden ? "Golden " : ""}${crop.name}${count > 1 ? " × 2" : ""}!`;
    state.events.push({ kind: "action", action, x: tile.x, y: tile.y, golden, bonus });
  }
  if (action !== "harvest") state.events.push({ kind: "action", action, x: tile.x, y: tile.y });
  state.energy = Math.max(0, state.energy - cost * (action === "till" || action === "water" ? Math.max(1, tiles.length * 0.7) : 1));
  state.minute += ACTION_MINUTES[action];
  if (state.energy <= 0) { state.events.push({ kind: "exhausted" }); message = "You're completely worn out… Eat something or go to bed."; }
  return message;
}
/** Upgraded hoe and can work on a line of three tiles in the direction you face. */
function lineFrom(state: ValleyState, tile: Tile, action: Action): Tile[] {
  const level = action === "till" ? state.hoeLevel : action === "water" ? Math.min(1, state.canLevel) : 0;
  if (!level) return [tile];
  const dx = Math.sign(Math.round(tile.x - state.farmer.x)) || state.farmer.dirX, dy = dx ? 0 : Math.sign(Math.round(tile.y - state.farmer.y)) || state.farmer.dirY;
  return [0, 1, 2].map(step => ({ x: tile.x + dx * step, y: tile.y + dy * step })).filter(item => isField(MAPS.farm, item));
}
function face(state: ValleyState, tile: Tile) {
  const dx = tile.x - state.farmer.x, dy = tile.y - state.farmer.y;
  if (Math.abs(dx) + Math.abs(dy) < 0.3) return;
  if (Math.abs(dx) > Math.abs(dy)) { state.farmer.dirX = Math.sign(dx); state.farmer.dirY = 0; } else { state.farmer.dirX = 0; state.farmer.dirY = Math.sign(dy); }
}

// ---------- Boosts from décor, blessings and perks ----------
const decorBoosts = (state: ValleyState, tile: Tile, boost: string) => state.decor.reduce((sum, item) => {
  const info = decorByKind(item.kind);
  return info.boost === boost && Math.max(Math.abs(item.x - tile.x), Math.abs(item.y - tile.y)) <= info.radius ? sum + (info.chance ?? 0) : sum;
}, 0);
export const growthChance = (state: ValleyState, tile: Tile, plot: Plot) =>
  Math.min(0.9, (plot.fertilizer === 2 ? 0.5 : plot.fertilizer === 1 ? 0.3 : 0) + decorBoosts(state, tile, "grow") + (state.familyId === 7 ? 0.1 : 0));
export const yieldChance = (state: ValleyState, tile: Tile) => Math.min(0.8, decorBoosts(state, tile, "yield") + (state.familyId === 4 ? 0.1 : 0));
export const goldenChance = (state: ValleyState, tile: Tile) => Math.min(0.5, (blessing(state, 3) ? 0.08 : 0) + decorBoosts(state, tile, "golden"));
export const sellMultiplier = (state: ValleyState) => 1 + (state.familyId === 1 ? 0.1 : 0) + blessing(state, 2) * 0.1;
/** Blessings kept in the SDK's ledger (the Friend's inventory of each outcome). Set from the runtime snapshot. */
export function setBlessings(state: ValleyState, counts: readonly number[]) {
  const before = state.blessings[0] ?? 0;
  state.blessings = [0, 1, 2, 3].map(index => Math.max(0, Math.floor(counts[index] ?? 0)));
  // A newly kept Sprout Charm adds its charge right away.
  if (state.blessings[0] > before) state.sproutCharges = Math.min(state.sproutCharges + (Math.min(state.blessings[0], BLESSING_CAPS[0]) - Math.min(before, BLESSING_CAPS[0])), 10);
}

// ---------- Shipping, shops, eating ----------
export function ship(state: ValleyState, id: ItemId, count: number): string {
  const info = itemInfo(id);
  if (info.kind === "seed" || info.kind === "fertilizer") return "The bin only takes crops, forage and food.";
  const amount = Math.min(count, countItem(state, id));
  if (!amount) return "";
  removeItem(state, id, amount);
  const slot = state.bin.find(item => item.id === id);
  if (slot) slot.count += amount; else state.bin.push({ id, count: amount });
  state.events.push({ kind: "action", action: "harvest", x: MAPS.farm.spots.bin.x, y: MAPS.farm.spots.bin.y - 1 });
  return `${amount} × ${info.name} in the bin. Paid tomorrow morning.`;
}
export const binValue = (state: ValleyState) => Math.round(state.bin.reduce((sum, slot) => sum + itemInfo(slot.id).sell * slot.count, 0) * sellMultiplier(state));
export function eat(state: ValleyState, id: ItemId): string {
  const info = itemInfo(id);
  if (!info.energy) return `You can't eat ${info.name}.`;
  if (state.energy >= maxEnergy(state)) return "You're full of energy already.";
  removeItem(state, id);
  state.energy = Math.min(maxEnergy(state), state.energy + info.energy);
  if (state.energy > TIRED_AT) state.warned.tired = false;
  state.events.push({ kind: "eat", energy: info.energy });
  return `Yum! +${info.energy} energy.`;
}
export type Purchase = { kind: "seed"; crop: CropId; count: number } | { kind: "fertilizer"; count: number } | { kind: "food"; food: FoodId }
  | { kind: "can" } | { kind: "hoe" } | { kind: "pack" } | { kind: "decor"; decor: DecorKind };
export function priceOf(state: ValleyState, item: Purchase): number | null {
  switch (item.kind) {
    case "seed": return cropById(item.crop).seed * item.count;
    case "fertilizer": return FERTILIZER_PRICE * item.count;
    case "food": return FOODS.find(food => food.id === item.food)!.price;
    case "can": return CAN_UPGRADES[state.canLevel] ?? null;
    case "hoe": return HOE_UPGRADES[state.hoeLevel] ?? null;
    case "pack": return BACKPACK_UPGRADES[state.packLevel] ?? null;
    case "decor": { const info = decorByKind(item.decor); return info.tier === undefined ? info.cost : null; }
  }
}
export function purchase(state: ValleyState, item: Purchase): string | null {
  const price = priceOf(state, item);
  if (price === null) return "Not available.";
  if (state.gold < price) return "Not enough Gold.";
  if (item.kind === "seed") { if (cropById(item.crop).season !== season(state)) return "Out of season."; if (!addItem(state, `seed:${item.crop}`, item.count)) return "Your backpack is full."; }
  else if (item.kind === "fertilizer") { if (!addItem(state, "fertilizer", item.count)) return "Your backpack is full."; }
  else if (item.kind === "food") { const food = FOODS.find(entry => entry.id === item.food)!; state.gold -= price; state.energy = Math.min(maxEnergy(state), state.energy + food.energy); state.warned.tired = state.energy <= TIRED_AT; state.events.push({ kind: "eat", energy: food.energy }, { kind: "buy" }); return null; }
  else if (item.kind === "can") { state.canLevel++; state.water = canCapacity(state); }
  else if (item.kind === "hoe") state.hoeLevel++;
  else if (item.kind === "pack") { state.packLevel++; while (state.inventory.length < packSize(state)) state.inventory.push(null); }
  else if (item.kind === "decor") state.decorOwned[item.decor] = (state.decorOwned[item.decor] ?? 0) + 1;
  state.gold -= price; state.events.push({ kind: "buy" });
  return null;
}

// ---------- Décor on the farm ----------
export function placementProblem(state: ValleyState, kind: DecorKind, tile: Tile): string | null {
  const world = MAPS.farm;
  if (!inside(world, tile) || tile.x < 1 || tile.y < 1 || tile.x >= world.width - 1 || tile.y >= world.height - 1) return "Pick a tile inside the farm.";
  if (world.blocked.has(key(tile.x, tile.y)) || decorAt(state, tile)) return "Something is already there.";
  if (world.paths.has(key(tile.x, tile.y)) || same(tile, world.exit) || same(tile, world.spots.bin) || same(tile, world.spots.bed) || same(tile, world.spots.well)) return "Keep paths and doorways clear.";
  const plot = plotAt(state, tile);
  if (plot && (plot.crop || plot.tilled) && decorByKind(kind).tier === undefined) return "Décor goes on grass (RF exclusives can stand in the field).";
  if (plot?.crop) return "There's a crop there.";
  if (same(tile, farmerTile(state))) return "You're standing there.";
  // Never wall off the road: the house door must still reach the exit.
  const blocked = decorBlocked(state); blocked.add(key(tile.x, tile.y));
  if (!route(world, world.spots.bed, [world.exit], blocked)) return "That would block the road.";
  return null;
}
export function placeDecor(state: ValleyState, kind: DecorKind, tile: Tile): string | null {
  const exclusive = decorByKind(kind).tier !== undefined;
  if (exclusive ? !state.collection.has(kind) || state.decor.some(item => item.kind === kind) : !(state.decorOwned[kind]! > 0)) return "You don't have one to place.";
  const problem = placementProblem(state, kind, tile);
  if (problem) return problem;
  if (!exclusive) state.decorOwned[kind]! -= 1;
  const plot = plotAt(state, tile); if (plot) { plot.tilled = false; plot.debris = null; }
  state.decor.push({ id: state.nextId++, kind, x: tile.x, y: tile.y }); state.events.push({ kind: "place" });
  return null;
}
export function pickUpDecor(state: ValleyState, tile: Tile): string | null {
  const item = decorAt(state, tile);
  if (!item) return "Nothing to pick up there.";
  state.decor = state.decor.filter(other => other !== item);
  if (decorByKind(item.kind).tier === undefined) state.decorOwned[item.kind] = (state.decorOwned[item.kind] ?? 0) + 1;
  state.events.push({ kind: "place" });
  return null;
}
/** Each opened blessing grants an RF-exclusive of its tier the player doesn't have yet, else Gold. */
export function collectFromBlessing(state: ValleyState, tier: number): { exclusive: DecorKind | null; gold: number } {
  const options = EXCLUSIVES.filter(item => item.tier === tier && !state.collection.has(item.kind));
  if (!options.length) { const gold = DUPLICATE_GOLD[tier] ?? 150; state.gold += gold; return { exclusive: null, gold }; }
  const chosen = options[Math.floor(random(state) * options.length)].kind;
  state.collection.add(chosen);
  return { exclusive: chosen, gold: 0 };
}

// ---------- Villagers: talk and gifts ----------
function befriend(state: ValleyState, resident: Resident, points: number) {
  const before = hearts(resident);
  resident.points = Math.max(0, Math.min(MAX_FRIENDSHIP, resident.points + Math.round(points * (points > 0 && state.familyId === 2 ? 1.25 : 1))));
  if (hearts(resident) > before) { state.events.push({ kind: "heart", villager: resident.id, hearts: hearts(resident) }); state.diary.hearts.push(resident.name); }
}
export function talk(state: ValleyState, id: string): string {
  const resident = state.residents.find(item => item.id === id);
  if (!resident) return "";
  const info = VILLAGERS.find(item => item.id === id);
  if (!resident.talked) { resident.talked = true; befriend(state, resident, TALK_POINTS); }
  state.events.push({ kind: "talk", villager: id, family: resident.family });
  if (!info) {
    const lines = hearts(resident) >= HELPER_HEARTS
      ? ["I watered some of your crops this morning!", "Your farm is looking lovely. I'll help again tomorrow.", "Helping out is the best part of my day."]
      : ["I moved into the valley because you did!", "This place is so quiet. I love it.", `Once we're good friends (${HELPER_HEARTS} hearts), I'll help water your crops.`];
    return lines[(state.day + resident.line) % lines.length];
  }
  const season = SEASONS[state.season];
  const extra = season === "winter" ? "Brr. Winter's the time for Snow Cabbage." : season === "summer" ? "Hot one today! Keep those crops watered." : season === "autumn" ? "Autumn colours make everything feel cosy." : "Spring air makes everyone want to plant something.";
  const lines = [...info.lines, extra];
  return lines[(state.day + state.season * 3) % lines.length];
}
export function giftReaction(id: string, item: ItemId): keyof typeof GIFT_POINTS {
  const info = VILLAGERS.find(villager => villager.id === id);
  if (!info) return item.startsWith("golden:") ? "love" : itemInfo(item).kind === "crop" || itemInfo(item).kind === "food" ? "like" : "neutral";
  if (info.loves.includes(item) || item.startsWith("golden:")) return "love";
  if (info.likes.includes(item)) return "like";
  if (info.dislikes.includes(item)) return "dislike";
  return "neutral";
}
export function giveGift(state: ValleyState, id: string, item: ItemId): string {
  const resident = state.residents.find(entry => entry.id === id);
  if (!resident) return "";
  if (resident.gifted) return `${resident.name} already got a gift today.`;
  const info = itemInfo(item);
  if (info.kind === "seed" || info.kind === "fertilizer") return `${resident.name} doesn't need ${info.name}.`;
  if (!removeItem(state, item)) return "";
  const reaction = giftReaction(id, item);
  resident.gifted = true; state.diary.gifts++;
  befriend(state, resident, GIFT_POINTS[reaction]);
  state.events.push({ kind: "gift", villager: id, reaction });
  return { love: `${resident.name} loves it! ♥♥`, like: `${resident.name} likes it. ♥`, neutral: `${resident.name} says thanks.`, dislike: `${resident.name} doesn't like that much…` }[reaction];
}

// ---------- Night ----------
export function passOut(state: ValleyState) {
  state.diary.passedOut = true;
  state.gold = Math.max(0, state.gold - Math.min(200, Math.floor(state.gold * 0.1)));
  state.events.push({ kind: "exhausted" });
  sleep(state, true);
}
/** Go to bed: ship, grow, turn the day (and season), and prepare the morning. The diary is shown until `wakeUp`. */
export function sleep(state: ValleyState, collapsed = false) {
  if (state.phase !== "play") return;
  const diary = state.diary, multiplier = sellMultiplier(state);
  // Shipping pays out overnight.
  const earned = Math.round(state.bin.reduce((sum, slot) => sum + itemInfo(slot.id).sell * slot.count, 0) * multiplier);
  diary.shipped = state.bin.map(slot => ({ ...slot })); diary.earned += earned; state.gold += earned;
  state.totals.shipped += state.bin.reduce((sum, slot) => sum + slot.count, 0); state.totals.earned += earned; state.bin = [];
  // Crops grow if watered today; bonus growth from fertilizer, décor and perks.
  for (const [id, plot] of state.plots) {
    if (!plot.crop) continue;
    const crop = cropById(plot.crop.id), tile = fromKey(id), target = plot.crop.regrowing ? crop.regrow! : crop.days;
    if (!plot.watered || plot.crop.grown >= target) continue;
    plot.crop.grown++; diary.grown++;
    if (plot.crop.grown < target && random(state) < growthChance(state, tile, plot)) { plot.crop.grown++; diary.bonusGrowth++; }
  }
  // Next day and possibly next season.
  state.day++; state.totals.days++;
  let newSeason = false;
  if (state.day > DAYS_PER_SEASON) {
    state.day = 1; state.season = (state.season + 1) % 4; newSeason = true;
    if (state.season === 0) state.year++;
    for (const plot of state.plots.values()) if (plot.crop && cropById(plot.crop.id).season !== season(state)) { plot.crop = null; plot.fertilizer = 0; diary.withered++; }
  }
  diary.weather = state.weather;
  state.weather = state.tomorrow; state.tomorrow = rollWeather(state, state.day === DAYS_PER_SEASON ? (state.season + 1) % 4 : state.season);
  diary.tomorrow = state.weather;
  for (const plot of state.plots.values()) plot.watered = plot.tilled && state.weather !== "sun";
  // Morning helpers: Silver Dew, Crystal Sprinklers and your owned Friends water crops for you.
  const thirsty = () => [...state.plots.entries()].filter(([, plot]) => plot.crop && !plot.watered);
  let dew = blessing(state, 1) * 4 + helpers(state).length * HELPER_WATERS;
  for (const [id, plot] of thirsty()) { if (dew <= 0) break; plot.watered = true; dew--; void id; }
  for (const item of state.decor) if (decorByKind(item.kind).boost === "water") for (const [id, plot] of state.plots) {
    const tile = fromKey(id);
    if (plot.tilled && Math.max(Math.abs(tile.x - item.x), Math.abs(tile.y - item.y)) <= 1) plot.watered = true;
  }
  state.sproutCharges = Math.min(10, state.sproutCharges + blessing(state, 0));
  for (const resident of state.residents) { resident.talked = false; resident.gifted = false; }
  // Wake at home. Passing out leaves you tired.
  state.minute = DAY_START; state.energy = collapsed ? Math.round(maxEnergy(state) / 2) : maxEnergy(state);
  state.water = canCapacity(state); state.warned = { tired: false, drowsy: false };
  state.farmer = walker("farm", MAPS.farm.spawn); state.pending = null; state.manual = null;
  spawnForage(state); postRequest(state); placeResidents(state);
  state.lastDiary = diary; state.phase = "diary";
  state.diary = blankDiary(state);
  if (newSeason) state.events.push({ kind: "season", season: season(state) });
}
export function wakeUp(state: ValleyState) {
  if (state.phase === "diary" || state.phase === "intro") {
    state.phase = "play"; state.started = true;
    if (state.minute < DAY_START + 30) state.events.push({ kind: "morning", season: season(state), weather: state.weather });
  }
}
export const thirstyCrops = (state: ValleyState) => [...state.plots.values()].filter(plot => plot.crop && !plot.watered).length;
export const ripeCrops = (state: ValleyState) => [...state.plots.values()].filter(plot => plot.crop && cropStage(cropById(plot.crop.id), plot.crop.grown, plot.crop.regrowing) === 3).length;

// ---------- Saves ----------
export const SAVE_VERSION = 1;
export function serializeValley(state: ValleyState) {
  return {
    version: SAVE_VERSION, seed: state.seed, day: state.day, season: state.season, year: state.year, minute: Math.floor(state.minute),
    weather: state.weather, tomorrow: state.tomorrow, gold: state.gold, energy: Math.round(state.energy), started: state.started,
    farmer: { map: state.farmer.map, x: Math.round(state.farmer.x), y: Math.round(state.farmer.y) },
    plots: [...state.plots.entries()].map(([id, plot]) => [id, plot.tilled ? 1 : 0, plot.watered ? 1 : 0, plot.fertilizer, plot.debris ?? "", plot.crop?.id ?? "", plot.crop?.grown ?? 0, plot.crop?.regrowing ? 1 : 0]),
    inventory: state.inventory.map(slot => slot ? [slot.id, slot.count] : null), packLevel: state.packLevel, canLevel: state.canLevel, hoeLevel: state.hoeLevel,
    water: state.water, bin: state.bin.map(slot => [slot.id, slot.count]), decor: state.decor.map(item => [item.kind, item.x, item.y]),
    decorOwned: state.decorOwned, collection: [...state.collection], friends: state.residents.map(item => [item.id, item.points, item.talked ? 1 : 0, item.gifted ? 1 : 0]),
    forage: state.forage.map(item => [item.map, item.x, item.y, item.id]), request: state.request, sproutCharges: state.sproutCharges,
    totals: state.totals, prefs: state.prefs, diary: state.diary,
  };
}
const int = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
/** Restore a save onto a fresh state (keeps the current family and roster). Returns false for anything invalid. */
export function restoreValley(state: ValleyState, raw: unknown): boolean {
  try {
    const save = raw as ReturnType<typeof serializeValley>;
    if (!save || typeof save !== "object" || save.version !== SAVE_VERSION || !Array.isArray(save.plots) || !Array.isArray(save.inventory)) return false;
    state.seed = int(save.seed, -2147483648, 2147483647, state.seed);
    state.day = int(save.day, 1, DAYS_PER_SEASON, 1); state.season = int(save.season, 0, 3, 0); state.year = int(save.year, 1, 999, 1);
    state.minute = int(save.minute, DAY_START, PASS_OUT - 1, DAY_START);
    state.weather = (["sun", "rain", "snow"] as const).includes(save.weather) ? save.weather : "sun";
    state.tomorrow = (["sun", "rain", "snow"] as const).includes(save.tomorrow) ? save.tomorrow : "sun";
    state.gold = int(save.gold, 0, 1e9, 500); state.packLevel = int(save.packLevel, 0, BACKPACK_SLOTS.length - 1, 0);
    state.canLevel = int(save.canLevel, 0, CAN_CAPACITY.length - 1, 0); state.hoeLevel = int(save.hoeLevel, 0, HOE_UPGRADES.length, 0);
    state.energy = int(save.energy, 0, maxEnergy(state), maxEnergy(state)); state.water = int(save.water, 0, canCapacity(state), canCapacity(state));
    state.started = Boolean(save.started);
    const mapId: MapId = save.farmer?.map === "town" ? "town" : "farm", world = MAPS[mapId];
    const spot = { x: int(save.farmer?.x, 0, world.width - 1, world.spawn.x), y: int(save.farmer?.y, 0, world.height - 1, world.spawn.y) };
    state.farmer = walker(mapId, walkable(world, spot) ? spot : world.spawn);
    for (const entry of save.plots) {
      const [id, tilled, watered, fertilizer, debris, crop, grown, regrowing] = entry as [number, number, number, number, string, string, number, number];
      const plot = state.plots.get(id);
      if (!plot) continue;
      plot.tilled = tilled === 1; plot.watered = watered === 1; plot.fertilizer = int(fertilizer, 0, 2, 0) as 0 | 1 | 2;
      plot.debris = debris === "weed" || debris === "rock" || debris === "stump" ? debris : null;
      plot.crop = CROPS.some(item => item.id === crop) ? { id: crop as CropId, grown: int(grown, 0, 30, 0), regrowing: regrowing === 1 && cropById(crop as CropId).regrow !== null } : null;
    }
    state.inventory = Array.from({ length: packSize(state) }, (_, index) => {
      const entry = save.inventory[index] as [unknown, unknown] | null;
      return entry && isItemId(entry[0]) ? { id: entry[0], count: int(entry[1], 1, STACK, 1) } : null;
    });
    state.bin = (Array.isArray(save.bin) ? save.bin : []).flatMap(entry => { const [id, count] = entry as [unknown, unknown]; return isItemId(id) ? [{ id, count: int(count, 1, 9999, 1) }] : []; });
    const kinds = new Set(DECOR.map(item => item.kind));
    state.collection = new Set((Array.isArray(save.collection) ? save.collection : []).filter((kind): kind is DecorKind => kinds.has(kind as DecorKind)));
    state.decorOwned = {};
    for (const [kind, count] of Object.entries(save.decorOwned ?? {})) if (kinds.has(kind as DecorKind) && decorByKind(kind as DecorKind).tier === undefined) state.decorOwned[kind as DecorKind] = int(count, 0, 99, 0);
    state.decor = [];
    for (const entry of Array.isArray(save.decor) ? save.decor : []) {
      const [kind, x, y] = entry as [DecorKind, number, number], tile = { x: int(x, 0, 23, 0), y: int(y, 0, 19, 0) };
      if (!kinds.has(kind) || (decorByKind(kind).tier !== undefined && (!state.collection.has(kind) || state.decor.some(item => item.kind === kind)))) continue;
      if (tile.x < 1 || tile.y < 1 || tile.x > 22 || tile.y > 18 || MAPS.farm.blocked.has(key(tile.x, tile.y)) || decorAt(state, tile) || plotAt(state, tile)?.crop) continue;
      state.decor.push({ id: state.nextId++, kind, x: tile.x, y: tile.y });
    }
    for (const entry of Array.isArray(save.friends) ? save.friends : []) {
      const [id, points, talked, gifted] = entry as [string, number, number, number];
      const resident = state.residents.find(item => item.id === id);
      if (typeof id === "string" && /^owned-\d+$/.test(id)) state.savedFriends[id] = int(points, 0, MAX_FRIENDSHIP, 0);
      if (resident) { resident.points = int(points, 0, MAX_FRIENDSHIP, 0); resident.talked = talked === 1; resident.gifted = gifted === 1; }
    }
    state.forage = (Array.isArray(save.forage) ? save.forage : []).flatMap(entry => {
      const [mapName, x, y, id] = entry as [string, number, number, string];
      return (mapName === "farm" || mapName === "town") && FORAGE.some(item => item.id === id && item.season === season(state)) ? [{ map: mapName as MapId, x: int(x, 0, 25, 0), y: int(y, 0, 19, 0), id: id as ForageId }] : [];
    });
    const request = save.request;
    state.request = request && typeof request === "object" && isItemId(request.item) && VILLAGERS.some(item => item.id === request.villager)
      ? { villager: request.villager, item: request.item, count: int(request.count, 1, 9, 1), reward: int(request.reward, 0, 99999, 0), done: Boolean(request.done) } : state.request;
    state.sproutCharges = int(save.sproutCharges, 0, 10, 0);
    state.totals = { shipped: int(save.totals?.shipped, 0, 1e9, 0), earned: int(save.totals?.earned, 0, 1e9, 0), harvested: int(save.totals?.harvested, 0, 1e9, 0), days: int(save.totals?.days, 0, 1e6, 0) };
    state.prefs = { music: save.prefs?.music !== false, sfx: save.prefs?.sfx !== false, volume: typeof save.prefs?.volume === "number" ? Math.max(0, Math.min(1, save.prefs.volume)) : 0.6,
      track: typeof save.prefs?.track === "string" && /^[a-z]{2,12}$/.test(save.prefs.track) ? save.prefs.track : "auto", orbit: save.prefs?.orbit !== false };
    state.diary = { ...blankDiary(state), ...(save.diary && typeof save.diary === "object" ? {
      earned: int(save.diary.earned, 0, 1e9, 0), harvested: int(save.diary.harvested, 0, 1e6, 0), watered: int(save.diary.watered, 0, 1e6, 0),
      tilled: int(save.diary.tilled, 0, 1e6, 0), gifts: int(save.diary.gifts, 0, 99, 0),
    } : {}) };
    placeResidents(state);
    state.phase = "intro";
    return true;
  } catch { return false; }
}
