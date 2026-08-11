// Mock sensor fusion layer: the counts the optimiser "ingests" are derived
// from the simulation, with per-device health, latency and confidence.

import { EDGES, FACILITIES, GATES, NODE_MAP, ZONES } from "./venue";
import { edgeKey, type SimState } from "./sim";

export type FeedKind = "cctv" | "wifi" | "turnstile" | "lidar" | "app";

export interface Feed {
  id: string;
  kind: FeedKind;
  name: string;
  location: string;
  value: number;
  unit: string;
  health: "online" | "degraded" | "offline";
  latencyMs: number;
  confidence: number;
}

export const FEED_META: Record<FeedKind, { label: string; unit: string; blurb: string }> = {
  cctv: { label: "CCTV people-counting", unit: "people in frame", blurb: "Vision model counts heads per camera tile every 2s." },
  wifi: { label: "Wi-Fi / BLE probes", unit: "devices", blurb: "Anonymised MAC rotation counts scaled by device-per-person ratio." },
  turnstile: { label: "Turnstile scans", unit: "scans/min", blurb: "Ticket validations straight from the access-control system." },
  lidar: { label: "Walkway LiDAR", unit: "people/min", blurb: "Bidirectional flow counters mounted over the concourse." },
  app: { label: "Spectator app pings", unit: "opted-in users", blurb: "GPS pings from attendees who opted into live guidance." },
};

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
};

function healthOf(id: string, t: number): Feed["health"] {
  const h = hash(id);
  if (h % 37 === 0) return "offline";
  if ((h + Math.floor(t / 40)) % 23 === 0) return "degraded";
  return "online";
}

export function buildFeeds(state: SimState): Feed[] {
  const feeds: Feed[] = [];

  ZONES.forEach((z, i) => {
    const occ = state.occupancy[z.id] ?? 0;
    const health = healthOf(`cam-${z.id}`, state.t);
    feeds.push({
      id: `cam-${z.id}`,
      kind: "cctv",
      name: `CAM-${String(i + 1).padStart(2, "0")}`,
      location: z.name,
      value: health === "offline" ? 0 : Math.round(occ * 0.18),
      unit: FEED_META.cctv.unit,
      health,
      latencyMs: 120 + (hash(z.id) % 220),
      confidence: health === "online" ? 0.93 : health === "degraded" ? 0.61 : 0,
    });
    feeds.push({
      id: `wifi-${z.id}`,
      kind: "wifi",
      name: `AP-${z.id.toUpperCase().slice(0, 4)}`,
      location: z.name,
      value: Math.round(occ * 0.74),
      unit: FEED_META.wifi.unit,
      health: healthOf(`wifi-${z.id}`, state.t),
      latencyMs: 700 + (hash(z.id) % 900),
      confidence: 0.78,
    });
  });

  GATES.forEach((g) => {
    const q = state.queues[g.id] ?? 0;
    feeds.push({
      id: `turn-${g.id}`,
      kind: "turnstile",
      name: `TRN-${g.id.toUpperCase()}`,
      location: g.name,
      value: Math.round(g.capacity / 35),
      unit: FEED_META.turnstile.unit,
      health: healthOf(`turn-${g.id}`, state.t),
      latencyMs: 40 + (hash(g.id) % 60),
      confidence: 0.99,
    });
    feeds.push({
      id: `cam-${g.id}`,
      kind: "cctv",
      name: `CAM-${g.id.toUpperCase()}Q`,
      location: `${g.name} queue`,
      value: Math.round(q * 0.4),
      unit: FEED_META.cctv.unit,
      health: healthOf(`camq-${g.id}`, state.t),
      latencyMs: 150 + (hash(g.id) % 200),
      confidence: 0.88,
    });
  });

  EDGES.slice(0, 14).forEach((e, i) => {
    const flow = state.flows[edgeKey(e.a, e.b)] ?? 0;
    feeds.push({
      id: `lidar-${edgeKey(e.a, e.b)}`,
      kind: "lidar",
      name: `LID-${String(i + 1).padStart(2, "0")}`,
      location: `${NODE_MAP[e.a]?.name ?? e.a} → ${NODE_MAP[e.b]?.name ?? e.b}`,
      value: Math.round(flow),
      unit: FEED_META.lidar.unit,
      health: healthOf(`lidar-${e.a}${e.b}`, state.t),
      latencyMs: 90 + (hash(e.a + e.b) % 120),
      confidence: 0.95,
    });
  });

  FACILITIES.slice(0, 6).forEach((f) => {
    feeds.push({
      id: `app-${f.id}`,
      kind: "app",
      name: `APP-${f.id.toUpperCase().slice(0, 5)}`,
      location: f.name,
      value: Math.round((state.occupancy[f.id] ?? 0) * 0.22),
      unit: FEED_META.app.unit,
      health: healthOf(`app-${f.id}`, state.t),
      latencyMs: 300 + (hash(f.id) % 400),
      confidence: 0.7,
    });
  });

  return feeds;
}

export function feedSummary(feeds: Feed[]) {
  return {
    total: feeds.length,
    online: feeds.filter((f) => f.health === "online").length,
    degraded: feeds.filter((f) => f.health === "degraded").length,
    offline: feeds.filter((f) => f.health === "offline").length,
    avgLatency: Math.round(feeds.reduce((s, f) => s + f.latencyMs, 0) / Math.max(1, feeds.length)),
    coverage:
      feeds.filter((f) => f.health !== "offline").length / Math.max(1, feeds.length),
  };
}
