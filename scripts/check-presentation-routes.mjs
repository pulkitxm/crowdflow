import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const routes = [
  {
    path: "apps/presentation/index.html",
    title: "VMAX | Round Presentations",
    required: ['href="online-round/"', 'href="final-round/"'],
  },
  {
    path: "apps/presentation/online-round/index.html",
    title: "VMAX | Online Round",
    required: ['href="../styles.css', "Online Round / crowd intelligence"],
  },
  {
    path: "apps/presentation/final-round/index.html",
    title: "VMAX | Final Round",
    required: ['href="../styles.css', "Hugging Face Hub"],
    slides: 4,
  },
];

const localReference = /(?:href|src|data)="([^"#][^"]*)"/g;
const cnamePath = "apps/presentation/CNAME";

if (readFileSync(cnamePath, "utf8").trim() !== "vmax-ppts.pulkit.page") {
  throw new Error(`Unexpected GitHub Pages domain in ${cnamePath}`);
}

for (const route of routes) {
  if (!existsSync(route.path)) throw new Error(`Missing presentation route: ${route.path}`);
  const html = readFileSync(route.path, "utf8");
  if (!html.includes(`<title>${route.title}</title>`)) throw new Error(`Unexpected title in ${route.path}`);
  for (const value of route.required) {
    if (!html.includes(value)) throw new Error(`Missing required content in ${route.path}: ${value}`);
  }
  if (route.slides) {
    const slideCount = [...html.matchAll(/<section(?:\s|>)/g)].length;
    if (slideCount !== route.slides) throw new Error(`Expected ${route.slides} slides in ${route.path}, found ${slideCount}`);
  }
  for (const match of html.matchAll(localReference)) {
    const reference = match[1].split("?")[0];
    if (/^(?:https?:|mailto:|tel:)/.test(reference) || reference.endsWith("/")) continue;
    const target = resolve(dirname(route.path), reference);
    if (!existsSync(target)) throw new Error(`Broken local reference in ${route.path}: ${reference}`);
  }
}

console.log("Presentation routes and local assets are valid.");
