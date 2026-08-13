import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.VIDEO_DEMO_URL ?? "http://127.0.0.1:4173";
const outDir = resolve("public/video/screens");

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--font-render-hinting=none"],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
});

const page = await context.newPage();

const settle = async () => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.documentElement.style.scrollBehavior = "auto";
  });
  const pause = page.getByRole("button", { name: "Pause" }).first();
  if (await pause.isVisible().catch(() => false)) await pause.click();
  await page.waitForTimeout(300);
};

const capture = async (name, path, prepare) => {
  await page.goto(new URL(path, baseUrl).href);
  await settle();
  if (prepare) {
    await prepare(page);
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  console.log(`captured ${name}.png`);
};

await capture("live-map", "/");
await capture("alerts", "/alerts");
await capture("routing", "/routing");
await capture("evacuation", "/evacuation", async (p) => {
  await p.getByRole("button", { name: /Fire in a grandstand/i }).click();
});
await capture("spectator", "/spectator");
await capture("feeds", "/feeds");
await capture("copilot", "/copilot", async (p) => {
  await p.getByRole("button", { name: /What will go wrong in the next 30 minutes/i }).click();
});
await capture("circuits", "/circuits");

await browser.close();
