// End-to-end check of the custom runtime page (host/runtime.tsx) with the SDK's mock wallet fixture:
// a wallet holding two Friends (#7730 farmer, #3412 moves into town), sharing a clip GIF and the diary card, and per-wallet save + restore.
// Automated test only: public builds always use the real wallet and ownership gate.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createGameServer } from "@rarefriends/friendsdk/serve";
import { OWNER, installTwoFriendWallet } from "./host-fixture.mjs";
import { attr, face, number, walkTo } from "./walk.mjs";

const outdir = await mkdtemp(join(tmpdir(), "valley-host-"));
let browser, server;
const errors = [];
try {
  execFileSync("node", ["scripts/build.mjs", "--outdir", join(outdir, "dist")], { stdio: "inherit" });
  server = createGameServer(join(outdir, "dist"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 960, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await installTwoFriendWallet(page, origin);
  const game = page.frameLocator("iframe");
  const valley = game.locator(".valley-game");
  const shot = name => page.locator(".rf-game-frame").screenshot({ path: `./artifacts/${name}.png` });
  const enter = async () => {
    await page.goto(origin);
    await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    await valley.waitFor();
  };

  await enter();
  await game.getByRole("heading", { name: "Welcome to RareFriends Valley" }).waitFor();
  await game.locator('.valley-game[data-owned="1"][data-linked="yes"]').waitFor();
  assert.match(await game.locator(".rf-frame-menu").innerText(), /1 of your own Friends/);
  await game.getByRole("button", { name: "Start farming" }).click();
  const canvas = game.locator("canvas[tabindex]");
  await canvas.focus();
  await walkTo(page, game, 7, 6); await walkTo(page, game, 7, 7, "y"); await face(page, "d");
  for (let i = 0; i < 3; i++) { await page.keyboard.press("e"); await page.waitForTimeout(120); }
  assert.equal(await number(game, "crops"), 1); assert.equal(await number(game, "watered"), 1);

  // A clip: the GIF goes out through the host (saved, then a prefilled X post opens); the video saves too.
  await game.getByRole("button", { name: "Record a clip" }).click();
  await page.waitForTimeout(1500);
  await game.getByRole("button", { name: "Stop recording" }).click();
  await game.getByRole("heading", { name: "Your clip" }).waitFor({ timeout: 30_000 });
  const gifDownload = page.waitForEvent("download");
  await game.getByRole("button", { name: "Post GIF to X" }).click();
  assert.match((await gifDownload).suggestedFilename(), /^rarefriends-valley-clip\.gif$/);
  await game.getByText(/File saved and X opened/).waitFor();
  let shared = await page.evaluate(() => window.__shared);
  assert.equal(shared.opened.length, 1);
  const clipPost = new URL(shared.opened[0]).searchParams.get("text");
  for (const tag of ["@RareFriendsNFT", "#RareFriends", "#RareFriendsValley", "https://rarefriends.com/", "#7730"]) assert.ok(clipPost.includes(tag), `clip post includes ${tag}`);
  if (await game.getByRole("button", { name: /^Save video/ }).count()) {
    const videoDownload = page.waitForEvent("download");
    await game.getByRole("button", { name: /^Save video/ }).click();
    assert.match((await videoDownload).suggestedFilename(), /^rarefriends-valley-clip\.(mp4|webm)$/);
  }
  await shot("host-clip");
  await game.getByRole("button", { name: "Close Your clip" }).click();
  await canvas.focus();

  // Bed: the diary card is copied as a picture and the X post opens.
  await walkTo(page, game, 7, 5, "y"); await walkTo(page, game, 4, 5, "x"); await face(page, "w"); await page.keyboard.press("e");
  await game.getByRole("button", { name: "Sleep until morning" }).click();
  await game.getByRole("img", { name: "Your farm diary card" }).waitFor();
  await game.getByRole("button", { name: "Post to X", exact: true }).click();
  await game.getByText(/Picture copied and X opened/).waitFor();
  shared = await page.evaluate(() => window.__shared);
  assert.equal(shared.opened.length, 2);
  const diaryPost = new URL(shared.opened[1]).searchParams.get("text");
  for (const tag of ["@RareFriendsNFT", "#RareFriends", "#RareFriendsValley", "Spring 1", "#7730"]) assert.ok(diaryPost.includes(tag), `diary post includes ${tag}`);
  assert.deepEqual(shared.copied, [["image/png"]], "the diary card is copied as a PNG picture");
  const card = await game.getByRole("img", { name: "Your farm diary card" }).evaluate(image => {
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return { width: image.naturalWidth, height: image.naturalHeight, data: canvas.toDataURL("image/png").split(",")[1] };
  });
  assert.deepEqual([card.width, card.height], [1200, 675]);
  (await import("node:fs")).writeFileSync("./artifacts/diary-card.png", Buffer.from(card.data, "base64"));
  await shot("host-diary");
  await game.getByRole("button", { name: "Start the day" }).click();
  await page.waitForTimeout(4500);

  // The farm is saved for this wallet address, and comes back on reload.
  const key = `rarefriends-valley:save:v1:${OWNER.toLowerCase()}`;
  const saved = JSON.parse(await page.evaluate(name => localStorage.getItem(name), key));
  assert.equal(saved?.day, 2, "progress is saved for this wallet address");
  assert.ok(saved.plots.some(entry => entry[5] === "turnip" && entry[6] === 1), "the watered turnip grew and was saved");
  await enter();
  await game.getByRole("heading", { name: "Welcome back to the valley" }).waitFor();
  assert.equal(await attr(game, "day"), "0-2");
  assert.equal(await number(game, "crops"), 1);
  await shot("host-welcome-back");
  assert.deepEqual([...errors, ...fixture.errors], [], "browser errors");
  assert((await page.evaluate(() => window.__friendWalletTest.state.requests)).every(method =>
    ["eth_accounts", "eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain"].includes(method)), "no signing requests");
  console.log("PASS custom host: owned Friends, clip and diary sharing, per-wallet save/restore");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(outdir, { recursive: true, force: true });
}
