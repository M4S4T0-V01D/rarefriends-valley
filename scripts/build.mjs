// Build (or, with --dev, watch and serve) RareFriends Valley: the SDK CLI builds the sandboxed game and its
// runtime page, then host/runtime.tsx replaces the runtime page's script with the roster-, save- and share-aware host.
import { context } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createGameServer } from "@rarefriends/friendsdk/serve";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const game = path.join(root, "games/rarefriends-valley");
const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const dev = args.includes("--dev"), outdir = path.resolve(option("--outdir") ?? path.join(game, ".friendsdk"));

const build = await buildGame(game, { outdir, watch: dev });
const host = await context({
  entryPoints: [path.join(root, "host/runtime.tsx")], outfile: path.join(outdir, "runtime.js"),
  bundle: true, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", minify: true, logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { react: path.dirname(require.resolve("react/package.json")), "react-dom": path.dirname(require.resolve("react-dom/package.json")) },
});
await host.rebuild();
if (!dev) {
  await host.dispose();
  console.log(`Built ${outdir}`);
} else {
  await host.watch();
  const port = Number(option("--port") ?? 4173), hostname = option("--host") ?? "127.0.0.1";
  const server = createGameServer(outdir);
  server.listen(port, hostname, () => console.log(`RareFriends Valley: http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}  (Ctrl+C to stop)`));
  const stop = async () => { server.close(); await host.dispose(); await build.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
