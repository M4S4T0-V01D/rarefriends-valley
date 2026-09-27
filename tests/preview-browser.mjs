// Preview page check: builds /preview/ and confirms the record button plays the game's Morning Sprouts
// at an audible level after a click (desktop) or tap (phone), and stops again.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const dir = path.join(await mkdtemp(path.join(tmpdir(), "cafe-preview-")), "preview");
execFileSync("node", ["scripts/build-preview.mjs", "--outdir", dir], { stdio: "inherit" });
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const file = path.join(dir, request.url.split("?")[0].replace(/^\/preview\/?/, "/").replace(/\/$/, "/index.html"));
  try { response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
try {
  for (const [name, viewport, touch] of [["desktop", { width: 1280, height: 800 }, false], ["phone", { width: 390, height: 780 }, true]]) {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: "reduce" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const Native = window.AudioContext, probes = window.__probe = [];
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); const analyser = this.createAnalyser(); analyser.fftSize = 2048; probes.push({ context: this, analyser, sum: 0, count: 0 }); }
      };
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (target, ...rest) {
        const probe = target instanceof AudioDestinationNode && probes.find(item => item.context === target.context);
        if (probe) connect.call(this, probe.analyser);
        return connect.call(this, target, ...rest);
      };
      setInterval(() => { for (const probe of probes) { const data = new Float32Array(2048); probe.analyser.getFloatTimeDomainData(data);
        probe.sum += data.reduce((sum, value) => sum + value * value, 0) / data.length; probe.count++; } }, 40);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
    /** Average output level since the last call. */
    const level = () => page.evaluate(() => Math.max(0, ...window.__probe.map(probe => { const rms = Math.sqrt(probe.sum / Math.max(1, probe.count)); probe.sum = 0; probe.count = 0; return rms; })));
    const button = page.locator("#music");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => window.__probe.length), 0, "no audio before a gesture");
    await (touch ? button.tap() : button.click());
    await page.waitForTimeout(1000); await level(); await page.waitForTimeout(2500);
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.match(await button.innerText(), /Morning Sprouts/);
    const playing = await level();
    assert.ok(playing > 0.03, `${name}: music too quiet (${playing})`);
    await (touch ? button.tap() : button.click());
    await page.waitForTimeout(1200); await level(); await page.waitForTimeout(800);
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    assert.ok(await level() < 0.002, `${name}: music kept playing after stop`);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); server.close(); }
console.log("PASS preview page music");
