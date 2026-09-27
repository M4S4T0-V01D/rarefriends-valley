// Capture the README / preview screenshots and the showcase clip from the real game on the custom host.
// Each scene loads a crafted per-wallet save (built with the game's own engine) into the mock wallet's storage,
// so the pictures show a grown farm in every season. Docs tool only; not part of CI. Usage: node scripts/capture-docs.mjs
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createGameServer } from "@rarefriends/friendsdk/serve";
import { OWNER, installTwoFriendWallet } from "../tests/host-fixture.mjs";
import { createValley, plotAt, serializeValley } from "../games/rarefriends-valley/engine.ts";
import { CROPS } from "../games/rarefriends-valley/data.ts";
import { FIELD } from "../games/rarefriends-valley/world.ts";

/** A farm a few weeks in: planted rows at different stages, RF décor, some friendships. */
function farmSave({ season = 1, minute = 11 * 60, weather = "sun", map = "farm", at = { x: 12, y: 6 } } = {}) {
  const state = createValley({ familyId: 5 });
  state.started = true; state.season = season; state.day = 4; state.year = 1; state.minute = minute; state.weather = weather; state.gold = 2480;
  const crops = CROPS.filter(crop => crop.season === ["spring", "summer", "autumn", "winter"][season]);
  for (let y = FIELD.y; y < FIELD.y + FIELD.d; y++) for (let x = FIELD.x; x < FIELD.x + FIELD.w; x++) {
    const plot = plotAt(state, { x, y });
    if (x > FIELD.x + 8 && y > FIELD.y + 5) continue; // leave a wild corner
    plot.debris = null;
    if (y === FIELD.y + 3 || x === FIELD.x + 4) continue; // grass walkways
    plot.tilled = true; plot.watered = (x + y) % 3 !== 0 || weather !== "sun";
    const crop = crops[Math.floor((y - FIELD.y) / 2) % crops.length], total = crop.days;
    const stage = [total, total, Math.ceil(total * 0.7), Math.ceil(total * 0.35), 1][(x + Math.floor(y / 2)) % 5];
    if ((x * 7 + y * 3) % 11 !== 0) plot.crop = { id: crop.id, grown: Math.min(total, stage), regrowing: false };
    if ((x + y) % 5 === 0) plot.fertilizer = 1;
  }
  for (const kind of ["windmill", "lantern", "scarecrow", "sprinkler", "beehive", "statue"]) state.collection.add(kind);
  state.decor = [
    { id: 1, kind: "windmill", x: FIELD.x + 4, y: FIELD.y + 3 }, { id: 2, kind: "scarecrow", x: FIELD.x + 1, y: FIELD.y + 3 }, { id: 3, kind: "lantern", x: FIELD.x + 7, y: FIELD.y + 3 },
    { id: 4, kind: "sprinkler", x: FIELD.x + 4, y: FIELD.y + 1 }, { id: 5, kind: "statue", x: 10, y: 3 }, { id: 6, kind: "beehive", x: FIELD.x + 4, y: FIELD.y + 6 },
    { id: 7, kind: "flowerbed", x: 2, y: 6 }, { id: 8, kind: "lamp", x: 6, y: 6 }, { id: 9, kind: "bench", x: 14, y: 4 }, { id: 10, kind: "flowerbed", x: 16, y: 4 },
  ];
  for (const resident of state.residents) resident.points = 180 + (resident.id.length * 37) % 300;
  state.farmer = { ...state.farmer, map, x: at.x, y: at.y, dirX: 0, dirY: 1 };
  return serializeValley(state);
}

const outdir = await mkdtemp(join(tmpdir(), "valley-docs-"));
let browser, server;
try {
  execFileSync("node", ["scripts/build.mjs", "--outdir", join(outdir, "dist")], { stdio: "inherit" });
  server = createGameServer(join(outdir, "dist"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const key = `rarefriends-valley:save:v1:${OWNER.toLowerCase()}`;
  async function scene(name, save, { width = 960, height = 800, then } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "no-preference", hasTouch: width < 500, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await installTwoFriendWallet(page, origin);
    await page.addInitScript(([storageKey, value]) => { if (window === window.top) localStorage.setItem(storageKey, value); }, [key, JSON.stringify(save)]);
    await page.goto(origin);
    await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    const game = page.frameLocator("iframe");
    await game.getByRole("button", { name: "Keep farming" }).click();
    await page.waitForTimeout(2200);
    if (then) await then(page, game);
    if (name) await page.locator(".rf-game-frame").screenshot({ path: `docs/${name}.png` });
    console.log(`captured ${name ?? "clip"}`);
    await context.close();
  }
  await scene("farm-summer", farmSave());
  await scene("farm-rotated", farmSave({ season: 0, minute: 9 * 60 }), { then: async page => { await page.keyboard.press("r"); await page.waitForTimeout(900); } });
  await scene("farm-autumn", farmSave({ season: 2, minute: 16 * 60 + 30 }));
  await scene("farm-winter", farmSave({ season: 3, minute: 13 * 60, weather: "snow" }));
  await scene("farm-night", farmSave({ season: 0, minute: 21 * 60 }));
  await scene("town", farmSave({ season: 1, minute: 12 * 60, map: "town", at: { x: 12, y: 9 } }));
  await scene("phone", farmSave({ season: 0, minute: 10 * 60 }), { width: 390, height: 760 });
  // The showcase clip: recorded in-game with the slow camera orbit, saved through the host as a GIF.
  await scene(null, farmSave({ season: 1, minute: 17 * 60 + 20 }), { then: async (page, game) => {
    await game.getByRole("button", { name: "Record a clip" }).click();
    await game.getByRole("heading", { name: "Your clip" }).waitFor({ timeout: 60_000 });
    await page.locator(".rf-game-frame").screenshot({ path: "docs/clip-menu.png" });
    const download = page.waitForEvent("download");
    await game.getByRole("button", { name: "Save GIF" }).click();
    await (await download).saveAs("docs/clip.gif");
  } });
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(outdir, { recursive: true, force: true });
}
