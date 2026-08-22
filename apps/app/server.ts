#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import next from "next";
import { CrowdFlowServer } from "./server/app.js";

function repositoryRoot(): string {
  let current = process.cwd();
  while (current !== dirname(current)) {
    if (existsSync(join(current, "circuits", "index.yaml"))) return current;
    current = dirname(current);
  }
  throw new Error("could not locate circuits/index.yaml");
}

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const host = value("host", process.env.HOST ?? "127.0.0.1");
const port = Number(value("port", process.env.PORT ?? "5199"));
const development = process.env.NODE_ENV !== "production";
const crowd = new CrowdFlowServer(repositoryRoot());
const web = next({
  dev: development,
  dir: dirname(new URL(import.meta.url).pathname),
  hostname: host,
  port,
  httpServer: crowd.server,
  webpack: true,
});

await web.prepare();
crowd.setFallback(web.getRequestHandler());
const session = crowd.startSession({
  circuit_id: value("circuit", "silverstone"),
  scenario: value("scenario", "egress"),
  population: Number(value("population", "2500")),
  seed: Number(value("seed", "42")),
  participation: Number(value("participation", "0.18")),
  speed: Number(value("speed", "1")),
  intervene: !args.includes("--no-intervene"),
});
crowd.startLive({ circuit_id: value("circuit", "silverstone"), participation: Number(value("live-participation", "1")) });
if (!args.includes("--paused")) session.control("play");
await crowd.listen(port, host);
console.log(`CrowdFlow app http://${host}:${port}`);
