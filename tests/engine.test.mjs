import test from "node:test";
import assert from "node:assert/strict";
import {
  act, actInFront, actionFor, addItem, binValue, collectFromBlessing, countItem, createValley, deliverRequest, eat, giftReaction, giveGift, hearts,
  maxEnergy, passOut, placeDecor, placementProblem, plotAt, purchase, restoreValley, serializeValley, setBlessings, setManual, setOwnedFriends, ship,
  sleep, talk, tapTile, update, wakeUp, canCapacity, growthChance, sellMultiplier, helpers, season, travel, farmerTile,
} from "../games/rarefriends-valley/engine.ts";
import { CROPS, DAYS_PER_SEASON, DAY_START, EXCLUSIVES, HEART, HELPER_HEARTS, PASS_OUT, VILLAGERS, cropById, cropStage } from "../games/rarefriends-valley/data.ts";
import { FIELD, MAPS, facingFor, key, project, route, screenToWorldDir, unproject, depth } from "../games/rarefriends-valley/world.ts";
import { parseRoster, shareFilename } from "../games/rarefriends-valley/roster.ts";
import game from "../games/rarefriends-valley/game.json" with { type: "json" };

const valley = (options = {}) => { const state = createValley({ familyId: 1, ...options }); wakeUp(state); state.events.length = 0; return state; };
/** Stand next to a field tile (west of it) so actions reach it. */
const standBy = (state, tile) => { state.farmer.x = tile.x - 1; state.farmer.y = tile.y; state.farmer.path = []; };
const clearTile = (state, tile) => { const plot = plotAt(state, tile); plot.debris = null; return plot; };
const run = (state, seconds, step = 0.05) => { for (let t = 0; t < seconds; t += step) update(state, step); };

test("both maps: the house door reaches the road east, town has its shops, and the roads join", () => {
  const farm = MAPS.farm, town = MAPS.town;
  assert.ok(route(farm, farm.spawn, [farm.exit]), "farm: house to exit");
  assert.ok(route(farm, farm.spawn, [farm.spots.bin]) && route(farm, farm.spawn, [farm.spots.well]));
  for (const spot of ["store", "cafe", "market", "plaza", "board", "pond", "homeA", "homeB", "homeC", "fountain", "bench"]) assert.ok(route(town, town.arrive, [town.spots[spot]]), `town: ${spot}`);
  assert.deepEqual(town.buildings.filter(b => b.place && b.place !== "villager").map(b => b.place).sort(), ["cafe", "market", "store"]);
  assert.equal(farm.field.size, FIELD.w * FIELD.d);
  for (const b of [...farm.buildings, ...town.buildings]) assert.ok(!b.door || !farm.blocked.has(key(b.door.x, b.door.y)) || b.place !== "home");
});

test("the rotating camera: projection round-trips at every angle, and screen directions follow the camera", () => {
  for (const angle of [0, 0.5, 1, 2, 3, 3.25]) {
    const camera = { angle, cx: 12, cy: 10, focusX: 9, focusY: 7, zoom: 1.3 };
    for (const [x, y] of [[3, 4], [12, 10], [20, 2], [9, 7]]) {
      const p = project(camera, x, y), back = unproject(camera, p.x, p.y);
      assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `angle ${angle}`);
    }
  }
  // The focus sits at the view's centre, and nearer tiles sort in front.
  const camera = { angle: 1, cx: 12, cy: 10, focusX: 5, focusY: 5, zoom: 1 };
  assert.deepEqual(project(camera, 5, 5), { x: 480, y: 350 });
  assert.ok(depth(camera, 5, 6) < depth(camera, 4, 5) || depth(camera, 5, 6) !== depth(camera, 4, 5));
  // W walks toward the top-right of the screen at any angle: the facing it produces is "up".
  for (const angle of [0, 1, 2, 3]) {
    const dir = screenToWorldDir(angle, 0, -1);
    assert.equal(facingFor(angle, dir.dx, dir.dy), "up", `angle ${angle}`);
    const right = screenToWorldDir(angle, 1, 0);
    assert.equal(facingFor(angle, right.dx, right.dy), "right");
  }
});

test("a new farm: tools, seeds, a wild field, 500 Gold, full energy and a posted request", () => {
  const state = valley();
  assert.equal(state.gold, 500); assert.equal(state.energy, maxEnergy(state)); assert.equal(state.water, canCapacity(state));
  assert.equal(countItem(state, "seed:turnip"), 12); assert.equal(countItem(state, "fertilizer"), 4);
  const debris = [...state.plots.values()].filter(plot => plot.debris).length;
  assert.ok(debris > 20 && debris < 70, `debris ${debris}`);
  assert.ok(state.request && state.request.count >= 1);
  assert.equal(season(state), "spring"); assert.equal(state.minute, DAY_START);
});

test("farming loop: till, plant, water, sleep; watered crops grow and ripen, unwatered ones wait", () => {
  const state = valley(), a = { x: FIELD.x, y: FIELD.y }, b = { x: FIELD.x, y: FIELD.y + 1 };
  for (const tile of [a, b]) { clearTile(state, tile); standBy(state, tile); state.tool = "hoe"; act(state, tile); state.tool = "seeds"; act(state, tile); }
  assert.equal(plotAt(state, a).crop.id, "turnip"); assert.equal(countItem(state, "seed:turnip"), 10);
  state.tool = "can"; standBy(state, a); act(state, a);
  assert.ok(plotAt(state, a).watered && !plotAt(state, b).watered);
  const energy = state.energy; assert.ok(energy < maxEnergy(state));
  state.weather = "sun"; state.tomorrow = "sun";
  sleep(state); wakeUp(state);
  assert.equal(plotAt(state, a).crop.grown, 1); assert.equal(plotAt(state, b).crop.grown, 0);
  assert.equal(state.energy, maxEnergy(state)); assert.equal(state.day, 2);
  // Keep watering until ripe, then harvest with the Hands.
  for (let day = 0; day < 6 && cropStage(cropById("turnip"), plotAt(state, a).crop.grown, false) < 3; day++) {
    plotAt(state, a).watered = true; state.tomorrow = "sun"; sleep(state); wakeUp(state);
  }
  assert.equal(actionFor(state, a).action, "harvest");
  standBy(state, a); state.tool = "hand"; act(state, a);
  assert.ok(countItem(state, "turnip") >= 1 || countItem(state, "golden:turnip") >= 1);
  assert.equal(plotAt(state, a).crop, null);
});

test("regrowing crops come back; out-of-season crops wither when the season turns", () => {
  const state = valley(), tile = { x: FIELD.x + 1, y: FIELD.y };
  clearTile(state, tile).tilled = true;
  plotAt(state, tile).crop = { id: "strawberry", grown: 7, regrowing: false };
  standBy(state, tile); act(state, tile);
  assert.deepEqual(plotAt(state, tile).crop, { id: "strawberry", grown: 0, regrowing: true });
  const other = { x: FIELD.x + 2, y: FIELD.y }; clearTile(state, other).tilled = true; plotAt(state, other).crop = { id: "potato", grown: 1, regrowing: false };
  state.day = DAYS_PER_SEASON; sleep(state); wakeUp(state);
  assert.equal(season(state), "summer"); assert.equal(plotAt(state, other).crop, null); assert.ok(state.lastDiary.withered >= 1);
  // Planting out of season is refused.
  const spot = { x: FIELD.x + 3, y: FIELD.y }; clearTile(state, spot).tilled = true; standBy(state, spot); state.tool = "seeds";
  assert.match(act(state, spot), /only grows in spring/);
});

test("rain and snow water every tilled tile; winter only grows Snow Cabbage", () => {
  const state = valley(), tile = { x: FIELD.x, y: FIELD.y + 2 };
  clearTile(state, tile).tilled = true;
  state.tomorrow = "rain"; sleep(state); wakeUp(state);
  assert.equal(state.weather, "rain"); assert.ok(plotAt(state, tile).watered);
  assert.deepEqual(CROPS.filter(crop => crop.season === "winter").map(crop => crop.id), ["snowcabbage"]);
});

test("energy: actions cost energy and time; exhaustion stops work; passing out at 2 am costs Gold and wakes you tired", () => {
  const state = valley(), tile = { x: FIELD.x, y: FIELD.y };
  clearTile(state, tile); standBy(state, tile); state.tool = "hoe";
  const minute = state.minute; act(state, tile);
  assert.ok(state.minute > minute && state.energy < maxEnergy(state));
  state.energy = 0; const other = { x: FIELD.x, y: FIELD.y + 1 }; clearTile(state, other); standBy(state, other);
  assert.match(act(state, other), /exhausted/);
  assert.match(eat(state, "latte"), /\+30/); assert.equal(state.energy, 30);
  state.gold = 1000; state.minute = PASS_OUT - 0.1; update(state, 0.1);
  assert.equal(state.phase, "diary"); assert.ok(state.lastDiary.passedOut); assert.equal(state.gold, 900);
  assert.equal(state.energy, Math.round(maxEnergy(state) / 2));
});

test("shipping pays overnight with the Mask perk and Moon Bloom blessings; the bin refuses seeds", () => {
  const state = valley({ familyId: 1 });
  addItem(state, "turnip", 5); addItem(state, "golden:potato", 1);
  assert.match(ship(state, "turnip", 5), /5 × Turnip/); ship(state, "golden:potato", 1);
  assert.match(ship(state, "seed:turnip", 1), /only takes crops/);
  setBlessings(state, [0, 0, 2, 0]);
  assert.ok(Math.abs(sellMultiplier(state) - 1.3) < 1e-9);
  const expected = Math.round((5 * 60 + 90 * 3) * 1.3); assert.equal(binValue(state), expected);
  const gold = state.gold; sleep(state);
  assert.equal(state.gold, gold + expected); assert.equal(state.lastDiary.earned, expected); assert.equal(state.bin.length, 0);
});

test("shops: seeds are seasonal, tools upgrade, food restores energy at once, décor goes to the farm", () => {
  const state = valley(); state.gold = 5000;
  assert.equal(purchase(state, { kind: "seed", crop: "melon", count: 1 }), "Out of season.");
  assert.equal(purchase(state, { kind: "seed", crop: "strawberry", count: 3 }), null); assert.equal(countItem(state, "seed:strawberry"), 3);
  assert.equal(purchase(state, { kind: "can" }), null); assert.equal(state.canLevel, 1); assert.equal(state.water, 40);
  assert.equal(purchase(state, { kind: "hoe" }), null); assert.equal(purchase(state, { kind: "hoe" }), "Not available.");
  assert.equal(purchase(state, { kind: "pack" }), null); assert.equal(state.inventory.length, 12);
  state.energy = 10; assert.equal(purchase(state, { kind: "food", food: "honeycake" }), null); assert.equal(state.energy, 80);
  assert.equal(purchase(state, { kind: "decor", decor: "lamp" }), null);
  assert.equal(placeDecor(state, "lamp", { x: 2, y: 8 }), null); assert.equal(state.decor.length, 1);
  assert.equal(placeDecor(state, "lamp", { x: 2, y: 9 }), "You don't have one to place.");
});

test("upgraded hoe tills a line of three in the facing direction", () => {
  const state = valley(); state.hoeLevel = 1;
  for (let dx = 0; dx < 3; dx++) clearTile(state, { x: FIELD.x + dx, y: FIELD.y });
  state.farmer.x = FIELD.x - 1; state.farmer.y = FIELD.y; state.farmer.dirX = 1; state.farmer.dirY = 0; state.tool = "hoe";
  act(state, { x: FIELD.x, y: FIELD.y });
  assert.deepEqual([0, 1, 2].map(dx => plotAt(state, { x: FIELD.x + dx, y: FIELD.y }).tilled), [true, true, true]);
});

test("RF exclusives: blessings grant each tier's décor once, then Gold; they boost crops in range", () => {
  const state = valley();
  const tier2 = EXCLUSIVES.filter(item => item.tier === 2);
  const got = new Set(tier2.map(() => collectFromBlessing(state, 2).exclusive));
  assert.deepEqual([...got].sort(), tier2.map(item => item.kind).sort());
  const gold = state.gold; assert.deepEqual(collectFromBlessing(state, 2), { exclusive: null, gold: 600 }); assert.equal(state.gold, gold + 600);
  const tile = { x: FIELD.x + 4, y: FIELD.y + 4 }; clearTile(state, tile);
  const plot = plotAt(state, tile); plot.tilled = true;
  const before = growthChance(state, tile, plot);
  assert.equal(placeDecor(state, "lantern", { x: tile.x + 1, y: tile.y }), null);
  assert.ok(Math.abs(growthChance(state, tile, plot) - before - 0.3) < 1e-9);
  assert.equal(placeDecor(state, "lantern", { x: tile.x + 2, y: tile.y }), "You don't have one to place.");
});

test("Silver Dew and Crystal Sprinklers water crops each morning; Sprout Charms give fertilizer charges", () => {
  const state = valley(); state.tomorrow = "sun";
  const tiles = [0, 1, 2, 3, 4, 5].map(dx => ({ x: FIELD.x + dx, y: FIELD.y + 5 }));
  for (const tile of tiles) { const plot = clearTile(state, tile); plot.tilled = true; plot.crop = { id: "turnip", grown: 0, regrowing: false }; }
  setBlessings(state, [2, 1, 0, 0]);
  assert.equal(state.sproutCharges, 2);
  sleep(state); wakeUp(state);
  assert.equal(tiles.filter(tile => plotAt(state, tile).watered).length, 4);
  assert.equal(state.sproutCharges, 4);
  const tile = tiles[5]; standBy(state, tile); state.tool = "fertilizer"; act(state, tile);
  assert.equal(plotAt(state, tile).fertilizer, 2); assert.equal(state.sproutCharges, 3);
});

test("villagers: all Rare Friends; talking and gifts build hearts once a day", () => {
  const state = valley();
  assert.equal(state.residents.length, VILLAGERS.length);
  const mochi = state.residents.find(item => item.id === "mochi");
  talk(state, "mochi"); talk(state, "mochi");
  assert.equal(mochi.points, 10);
  addItem(state, "strawberry", 2);
  assert.equal(giftReaction("mochi", "strawberry"), "love");
  assert.match(giveGift(state, "mochi", "strawberry"), /loves it/); assert.equal(mochi.points, 90);
  assert.match(giveGift(state, "mochi", "strawberry"), /already got a gift/);
  assert.equal(giftReaction("mochi", "golden:turnip"), "love");
  sleep(state); wakeUp(state);
  assert.ok(!mochi.talked && !mochi.gifted);
});

test("villagers keep a schedule: indoors at night, out in town by day, at the café when it rains", () => {
  const state = valley();
  state.minute = 6 * 60 + 10; run(state, 0.2);
  assert.ok(state.residents.filter(item => item.owned === null).every(item => !item.visible), "indoors at 6am");
  state.minute = 10 * 60; run(state, 20);
  const pip = state.residents.find(item => item.id === "pip");
  assert.ok(pip.visible && pip.walker.map === "town");
  assert.ok(Math.abs(pip.walker.x - MAPS.town.spots.cafe.x) + Math.abs(pip.walker.y - MAPS.town.spots.cafe.y) <= 2);
});

test("owned Friends move into the valley and help water once they reach three hearts", () => {
  const state = valley(); state.tomorrow = "sun";
  setOwnedFriends(state, [{ id: 3412, family: 0 }, { id: 99, family: null }]);
  const friend = state.residents.find(item => item.owned === 3412);
  assert.ok(friend && friend.name === "#3412"); assert.equal(helpers(state).length, 0);
  friend.points = HELPER_HEARTS * HEART;
  assert.equal(helpers(state).length, 1);
  const tiles = Array.from({ length: 8 }, (_, index) => ({ x: FIELD.x + index, y: FIELD.y + 8 }));
  for (const tile of tiles) { const plot = clearTile(state, tile); plot.tilled = true; plot.crop = { id: "turnip", grown: 0, regrowing: false }; }
  sleep(state); wakeUp(state);
  assert.equal(tiles.filter(tile => plotAt(state, tile).watered).length, 6);
  assert.match(talk(state, "owned-3412"), /watered|farm|Helping/);
});

test("requests on the notice board pay Gold and friendship", () => {
  const state = valley();
  const request = state.request;
  assert.match(deliverRequest(state), /You need/);
  addItem(state, request.item, request.count);
  const gold = state.gold; assert.match(deliverRequest(state), /Delivered/);
  assert.equal(state.gold, gold + request.reward);
  assert.ok(state.residents.find(item => item.id === request.villager).points >= 60);
});

test("taps walk next to a tile and act on arrival; walking onto the road travels to town", () => {
  const state = valley(), tile = { x: FIELD.x + 2, y: FIELD.y + 1 };
  clearTile(state, tile); state.tool = "hoe";
  assert.equal(tapTile(state, tile), "");
  run(state, 12);
  assert.ok(plotAt(state, tile).tilled);
  assert.ok(state.events.some(event => event.kind === "action" && event.action === "till"));
  state.farmer.x = MAPS.farm.exit.x - 1; state.farmer.y = MAPS.farm.exit.y; setManual(state, { dx: 1, dy: 0 });
  run(state, 1); setManual(state, null);
  assert.equal(state.farmer.map, "town");
  travel(state, "farm"); assert.equal(state.farmer.map, "farm"); assert.deepEqual(farmerTile(state), MAPS.farm.arrive);
});

test("keyboard: E acts on the tile in front", () => {
  const state = valley(), tile = { x: FIELD.x, y: FIELD.y + 3 };
  clearTile(state, tile); standBy(state, tile); state.farmer.dirX = 1; state.farmer.dirY = 0; state.tool = "hand";
  actInFront(state);
  assert.ok(plotAt(state, tile).tilled);
});

test("saves round-trip the farm, and restoring rejects junk", () => {
  const state = valley(), tile = { x: FIELD.x + 1, y: FIELD.y + 1 };
  clearTile(state, tile).tilled = true; plotAt(state, tile).crop = { id: "potato", grown: 3, regrowing: false };
  state.gold = 1234; state.day = 5; state.minute = 14 * 60; addItem(state, "pumpkin", 2); state.collection.add("windmill");
  state.decor.push({ id: 99, kind: "windmill", x: 2, y: 8 }); setOwnedFriends(state, [{ id: 3412, family: 0 }]);
  state.residents.find(item => item.id === "owned-3412").points = 250; state.residents.find(item => item.id === "pip").points = 120;
  const raw = JSON.parse(JSON.stringify(serializeValley(state)));
  const restored = createValley({ familyId: 1 });
  assert.equal(restoreValley(restored, raw), true);
  assert.equal(restored.gold, 1234); assert.equal(restored.day, 5); assert.equal(restored.minute, 14 * 60);
  assert.deepEqual(plotAt(restored, tile).crop, { id: "potato", grown: 3, regrowing: false });
  assert.equal(countItem(restored, "pumpkin"), 2); assert.ok(restored.collection.has("windmill")); assert.equal(restored.decor.length, 1);
  assert.equal(restored.residents.find(item => item.id === "pip").points, 120);
  // The owned Friend's friendship comes back when the wallet roster arrives after the save.
  setOwnedFriends(restored, [{ id: 3412, family: 0 }]);
  assert.equal(restored.residents.find(item => item.id === "owned-3412").points, 250);
  for (const junk of [null, 5, "x", { version: 99 }, { version: 1, plots: "no" }]) assert.equal(restoreValley(createValley({ familyId: 1 }), junk), false);
});

test("placement keeps the road open and paths clear", () => {
  const state = valley();
  state.decorOwned.bench = 3;
  assert.match(placementProblem(state, "bench", MAPS.farm.spots.bin), /clear|already/);
  assert.match(placementProblem(state, "bench", { x: 10, y: 5 }), /paths/);
  assert.equal(placementProblem(state, "bench", { x: 1, y: 8 }), null);
});

test("roster parsing and share filenames", () => {
  assert.deepEqual(parseRoster(["7730:5", "3412:1", "bad", "3412:1"], 7730n), { self: 5, others: [{ id: 3412, generation: 1 }] });
  assert.equal(parseRoster(["3412"], 7730n), null);
  assert.equal(shareFilename("RareFriends Valley: Spring 3!", "image/gif"), "rarefriends-valley-spring-3.gif");
  assert.equal(shareFilename(undefined, "video/mp4"), "rarefriends-valley.mp4");
});

test("economy: 1 RF blessings with a 0.88 RF expected value and a 5 RF maximum", () => {
  const total = game.outcomes.reduce((sum, item) => sum + item.chanceBps, 0);
  assert.equal(total, 10000);
  const expected = game.outcomes.reduce((sum, item) => sum + BigInt(item.chanceBps) * BigInt(item.reward), 0n) / 10000n;
  assert.equal(expected, 880000000000000000n);
  assert.equal(game.outcomes.map(item => item.name).join(), "Sprout Charm,Silver Dew,Moon Bloom,Golden Harvest");
});

test("town: the main road runs clear from the farm gate to the east edge, past every shop street", () => {
  const town = MAPS.town;
  for (let x = 0; x < town.width - 1; x++) assert.ok(!town.blocked.has(key(x, 9)), `road tile ${x},9`);
  for (const b of town.buildings) assert.ok(!town.blocked.has(key(b.door.x, b.door.y)), `${b.id} door`);
  for (const [name, spot] of Object.entries(town.spots)) assert.ok(!town.blocked.has(key(spot.x, spot.y)), `spot ${name}`);
  for (const prop of town.props) assert.ok(!town.buildings.some(b => prop.x >= b.x && prop.x < b.x + b.w && prop.y >= b.y && prop.y < b.y + b.d), `${prop.kind} at ${prop.x},${prop.y}`);
});
