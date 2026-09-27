// Shared browser-test helpers: read the game's data attributes and walk with the keyboard.
import assert from "node:assert/strict";

export const attr = async (frame, name) => await frame.locator(".valley-game").getAttribute(`data-${name}`);
export const number = async (frame, name) => Number(await attr(frame, name));
export const tile = async frame => (await attr(frame, "tile")).split(",").map(Number);
/** Walk with the keyboard (screen-relative; the camera is at its starting angle) until standing on x, y. */
export async function walkTo(page, frame, x, y, order = "xy") {
  for (const axis of order) {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const [cx, cy] = await tile(frame), delta = axis === "x" ? x - cx : y - cy;
      if (!delta) break;
      assert.ok(Date.now() < deadline, `stuck walking to ${x},${y} (at ${cx},${cy})`);
      const key = axis === "x" ? (delta > 0 ? "d" : "a") : (delta > 0 ? "s" : "w");
      await page.keyboard.down(key);
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(25);
        const [nx, ny] = await tile(frame);
        if ((axis === "x" ? nx : ny) === (axis === "x" ? x : y) || await attr(frame, "map") !== "farm" && await attr(frame, "map") !== "town") break;
      }
      await page.keyboard.up(key);
    }
  }
}
export const face = async (page, key) => { await page.keyboard.down(key); await page.waitForTimeout(20); await page.keyboard.up(key); };

