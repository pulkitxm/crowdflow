/**
 * Dev server config.
 *
 * The console talks to the API through this proxy rather than to an absolute
 * URL, so the same build works when the two are served from one origin. `ws:
 * true` matters — without it the live feed silently falls back to polling
 * nothing, which is exactly the class of quiet failure this product exists to
 * eliminate.
 *
 * Contract and wire types resolve through Bun workspaces. They are type-only
 * imports, so nothing crosses the bundle boundary at runtime and there is no
 * generated alias that can drift from the server.
 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Where the Bun API listens by default (see packages/api/src/main.ts). */
const API = process.env.CROWDFLOW_API ?? "http://127.0.0.1:8099";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/ws": { target: API, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        console: fileURLToPath(new URL("index.html", import.meta.url)),
        simulator: fileURLToPath(new URL("simulator.html", import.meta.url)),
      },
    },
  },
});
