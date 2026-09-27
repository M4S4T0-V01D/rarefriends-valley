// Automated browser check with the SDK's mock wallet fixture (tests only; real play needs an eligible wallet).
// Uses the SDK CLI's own runtime page; tests/host-browser.mjs covers the custom host (owned Friends, saves, sharing).
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { attr, face, number, tile, walkTo } from "./walk.mjs";

const game = "./games/rarefriends-valley";
const shot = (page, name) => page.locator(".rf-game-frame").screenshot({ path: `./artifacts/${name}.png` });
await testGame(game, {
  screenshot: "./artifacts/desktop-final.png",
  timeout: 90_000,
  check: async ({ page, game: frame }) => {
    await frame.getByRole("heading", { name: "Welcome to RareFriends Valley" }).waitFor();
    await shot(page, "desktop-intro");
    await frame.getByRole("button", { name: "Start farming" }).click();
    assert.equal(await attr(frame, "phase"), "play");
    const canvas = frame.locator("canvas[tabindex]");
    await canvas.focus();

    // Farm: clear-free patch by the house. Hands till, plant and water with E.
    await walkTo(page, frame, 7, 6); await walkTo(page, frame, 7, 7, "y");
    await face(page, "d");
    const [x, y] = await tile(frame); assert.deepEqual([x, y], [7, 7]);
    for (const step of ["tilled", "crops", "watered"]) {
      const before = await number(frame, step);
      await page.keyboard.press("e"); await page.waitForTimeout(150);
      assert.equal(await number(frame, step), before + 1, step);
    }
    const energy = await number(frame, "energy"); assert.ok(energy < 100, `energy ${energy}`);
    // Tools: the hoe tills the next tile south.
    await page.keyboard.press("2"); assert.equal(await attr(frame, "tool"), "hoe");
    await walkTo(page, frame, 7, 8, "y"); await face(page, "d"); await page.keyboard.press("e"); await page.waitForTimeout(120);
    assert.equal(await number(frame, "tilled"), 2);
    await page.keyboard.press("1");
    await shot(page, "desktop-farming");

    // The arrow keys rotate the camera in quarter turns (← / →), as do Q / R and the buttons.
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(700);
    assert.equal(await number(frame, "angle"), 1);
    await shot(page, "desktop-rotated");
    await frame.getByRole("button", { name: "Rotate camera left" }).click(); await page.waitForTimeout(500);
    assert.equal(await number(frame, "angle"), 0);
    await canvas.focus();

    // Bag.
    await frame.getByRole("button", { name: "Bag", exact: true }).click();
    await frame.getByRole("option", { name: /Friend Latte/ }).click();
    await frame.getByRole("button", { name: "Eat", exact: true }).click();
    await shot(page, "desktop-bag");
    await frame.getByRole("button", { name: "Close Bag · 500 G" }).click().catch(async () => { await page.keyboard.press("Escape"); });
    await frame.locator(".rf-frame-scrim").waitFor({ state: "hidden" });

    // Friend Films: record a clip, get a GIF (and a video where supported).
    await frame.getByRole("button", { name: "Record a clip" }).click();
    await frame.getByRole("button", { name: "Stop recording" }).waitFor();
    assert.equal(await attr(frame, "recording"), "on");
    await page.waitForTimeout(1800);
    await frame.getByRole("button", { name: "Stop recording" }).click();
    await frame.getByRole("heading", { name: "Your clip" }).waitFor({ timeout: 30_000 });
    const gif = frame.getByRole("img", { name: "Your recorded GIF" });
    await gif.waitFor();
    assert.ok(await gif.evaluate(image => image.complete && image.naturalWidth > 100), "GIF decodes");
    assert.ok(await frame.getByRole("button", { name: "Post GIF to X" }).isVisible());
    await shot(page, "desktop-clip");
    await frame.getByRole("button", { name: "Close Your clip" }).click();
    await canvas.focus();

    // To town along the road, then shop at the General Store.
    await walkTo(page, frame, 4, 5, "xy"); await walkTo(page, frame, 21, 5, "x"); await walkTo(page, frame, 21, 10, "y");
    await page.keyboard.down("d"); for (let i = 0; i < 60 && await attr(frame, "map") === "farm"; i++) await page.waitForTimeout(50); await page.keyboard.up("d");
    assert.equal(await attr(frame, "map"), "town");
    await page.waitForTimeout(300);
    await shot(page, "desktop-town");
    await walkTo(page, frame, 5, 9, "x"); await walkTo(page, frame, 5, 5, "y"); await face(page, "w"); await page.keyboard.press("e");
    await frame.getByRole("heading", { name: /General Store/ }).waitFor();
    const gold = await number(frame, "gold");
    await frame.getByRole("button", { name: "60 G" }).click();
    assert.equal(await number(frame, "gold"), gold - 60);
    await frame.getByRole("tab", { name: "Décor" }).click();
    await frame.getByRole("button", { name: "120 G" }).click();
    await shot(page, "desktop-store");
    await page.keyboard.press("Escape").catch(() => {});
    await frame.getByRole("button", { name: /^Close General Store/ }).click().catch(() => {});
    await frame.locator(".rf-frame-scrim").waitFor({ state: "hidden" });
    await canvas.focus();

    // Moonlight Market: buy and open a simulated RF blessing, get RF décor.
    await walkTo(page, frame, 5, 9, "y"); await walkTo(page, frame, 19, 9, "x"); await walkTo(page, frame, 19, 5, "y"); await face(page, "w"); await page.keyboard.press("e");
    await frame.getByRole("heading", { name: "Moonlight Market" }).waitFor();
    // Buying and opening each go through the runtime's confirmation.
    await frame.getByRole("button", { name: /^Buy 1 · 1 RF$/ }).click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await frame.getByRole("button", { name: "Open one" }).click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await frame.getByRole("heading", { name: "Blessing opened" }).waitFor();
    assert.ok(await frame.getByText(/New RF décor:/).isVisible());
    await shot(page, "desktop-blessing");
    await frame.getByRole("button", { name: "Keep the rest" }).click();
    await frame.getByRole("heading", { name: "Moonlight Market" }).waitFor();
    await frame.getByRole("tab", { name: /RF décor · 1\/8/ }).click();
    await shot(page, "desktop-collection");
    await frame.getByRole("button", { name: "Close Moonlight Market" }).click();
    await canvas.focus();

    // Home, decorate, and bed.
    await walkTo(page, frame, 19, 9, "y"); await walkTo(page, frame, 1, 9, "x");
    await page.keyboard.down("a"); for (let i = 0; i < 60 && await attr(frame, "map") === "town"; i++) await page.waitForTimeout(50); await page.keyboard.up("a");
    assert.equal(await attr(frame, "map"), "farm");
    await walkTo(page, frame, 21, 5, "y"); await walkTo(page, frame, 9, 5, "x");
    await frame.getByRole("button", { name: "Decorate" }).click();
    await frame.getByRole("heading", { name: "Decorate your farm" }).waitFor();
    await frame.locator(".valley-collection button", { hasText: "Place" }).first().click();
    await canvas.focus();
    await face(page, "s"); await face(page, "s"); await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    if (await number(frame, "decor") === 0) { await face(page, "a"); await page.keyboard.press("Enter"); }
    assert.ok(await number(frame, "decor") >= 1, "décor placed");
    await frame.getByRole("button", { name: "Done" }).click().catch(() => {});
    await canvas.focus();
    await shot(page, "desktop-decor");
    await walkTo(page, frame, 4, 5, "x"); await face(page, "w"); await page.keyboard.press("e");
    await frame.getByRole("heading", { name: "Your house" }).waitFor();
    await frame.getByRole("button", { name: "Sleep until morning" }).click();
    assert.equal(await attr(frame, "phase"), "diary");
    await frame.getByRole("img", { name: "Your farm diary card" }).waitFor();
    await shot(page, "desktop-diary");
    await frame.getByRole("button", { name: "Start the day" }).click();
    assert.equal(await attr(frame, "day"), "0-2");
    assert.equal(await number(frame, "minute"), 360);
    // The watered turnip grew overnight; settings has the music picker.
    await frame.getByRole("button", { name: "Settings" }).click();
    await frame.getByRole("radio", { name: /Street Bossa/ }).click();
    assert.equal(await frame.getByRole("radio", { name: /Street Bossa/ }).getAttribute("aria-checked"), "true");
    await shot(page, "desktop-settings");
    await frame.getByRole("button", { name: "Close Settings" }).click();
  },
});
console.log("PASS desktop gameplay check");

await testGame(game, {
  width: 390, height: 760, screenshot: "./artifacts/phone-final.png", timeout: 60_000,
  check: async ({ page, game: frame }) => {
    await frame.getByRole("button", { name: "Start farming" }).tap();
    const canvas = frame.locator("canvas[tabindex]"), box = await canvas.boundingBox();
    // Tap near your Friend: walking and tile taps work by touch.
    const before = await attr(frame, "tile");
    await page.touchscreen.tap(box.x + box.width * 0.62, box.y + box.height * 0.62);
    await page.waitForTimeout(1500);
    assert.notEqual(await attr(frame, "tile"), before, "tap to walk");
    await frame.getByRole("button", { name: "Rotate camera right" }).tap();
    await frame.getByRole("button", { name: "Hoe" }).tap();
    assert.equal(await attr(frame, "tool"), "hoe");
    const bar = await frame.locator(".valley-hotbar").boundingBox();
    assert.ok(bar.x >= box.x - 1 && bar.x + bar.width <= box.x + box.width + 1, "hotbar fits the phone frame");
    await page.waitForTimeout(600);
    await shot(page, "phone-farm");
  },
});
console.log("PASS phone check");
