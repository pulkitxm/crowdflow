/**
 * Dev server config.
 *
 * The console talks to the API through this proxy rather than to an absolute
 * URL, so the same build works when the two are served from one origin. `ws:
 * true` matters — without it the live feed silently falls back to polling
 * nothing, which is exactly the class of quiet failure this product exists to
 * eliminate.
 *
 * Contract types resolve to the *generated* files in packages/. They are
 * type-only imports, so nothing crosses the bundle boundary at runtime; the
 * alias exists so a stale schema is a compile error rather than a wrong number
 * on a wall.
 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Where `crowdflow-api` listens by default (see packages/api __main__.py). */
const API = process.env.CROWDFLOW_API ?? "http://127.0.0.1:8099";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@contracts": `${repoRoot}packages/contracts/ts/index.ts`,
      "@wire": `${repoRoot}packages/api/ts/index.ts`,
    },
  },
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/ws": { target: API, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
