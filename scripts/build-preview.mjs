// Build the shareable /preview/ page: copy the page and screenshots, and bundle its music player
// (the game's procedural audio) into music.js.
import { build } from "esbuild";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), index = args.indexOf("--outdir");
const outdir = path.resolve(index >= 0 ? args[index + 1] : path.join(root, "games/rarefriends-valley/.friendsdk/preview"));

await mkdir(path.join(outdir, "img"), { recursive: true });
await cp(path.join(root, "site/preview/index.html"), path.join(outdir, "index.html"));
for (const file of await readdir(path.join(root, "docs"))) if (/\.(png|gif)$/.test(file)) await cp(path.join(root, "docs", file), path.join(outdir, "img", file));
await build({
  entryPoints: [path.join(root, "site/preview/music.ts")], outfile: path.join(outdir, "music.js"),
  bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, logLevel: "warning",
});
console.log(`Built ${outdir}`);
