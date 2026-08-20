import type { LiveSnapshot, PeopleQueryResult, VenueGeometry, ZoneState } from "@crowdflow/api/wire";

export type SectorVisibility = "observed" | "silent" | "unknown";
export type SectorSortKey = "name" | "density" | "flow" | "nodes" | "people" | "queue" | "net" | "confidence";

export interface SectorRow {
  id: string;
  name: string;
  visibility: SectorVisibility;
  zoneCount: number;
  observedZoneCount: number;
  word: string;
  band: "nominal" | "building" | "critical" | null;
  density: number | null;
  flow: number | null;
  speed: number | null;
  nodes: number;
  people: number;
  queue: number | null;
  net: number | null;
  confidence: number | null;
  reportable: boolean;
  losGrade: string;
  overCapacity: boolean;
}

export interface SectorSort {
  key: SectorSortKey;
  descending: boolean;
}

interface SectorAnchor {
  id: string;
  name: string;
  x: number;
  y: number;
}

export function buildSectorRows(live: LiveSnapshot, geometry: VenueGeometry, grid: PeopleQueryResult | null): SectorRow[] {
  const zones = Object.values(geometry.pack.zones ?? {});
  const anchors = sectorAnchors(geometry);
  if (!anchors.length) return [];
  const members = new Map(anchors.map((anchor) => [anchor.id, [] as string[]]));
  for (const zone of zones) members.get(nearest(anchorPoint(zone.position.x, zone.position.y), anchors).id)?.push(zone.id);
  const crowd = new Map(anchors.map((anchor) => [anchor.id, 0]));
  for (const cell of grid?.cells ?? []) {
    const anchor = nearest(anchorPoint((cell.min_x + cell.max_x) / 2, (cell.min_y + cell.max_y) / 2), anchors);
    crowd.set(anchor.id, (crowd.get(anchor.id) ?? 0) + cell.count);
  }
  const states = live.state.zones ?? {};
  const unknown = new Set(live.state.unobserved_zones ?? []);
  return anchors.map((anchor) => aggregateSector(anchor, members.get(anchor.id) ?? [], states, unknown, crowd.get(anchor.id) ?? 0));
}

export function sortSectorRows(rows: SectorRow[], sort: SectorSort): SectorRow[] {
  const copy = [...rows];
  if (sort.key === "name") return copy.sort((a, b) => a.name.localeCompare(b.name) * (sort.descending ? -1 : 1));
  const value = (row: SectorRow): number | null => {
    if (sort.key === "nodes") return row.visibility === "observed" ? row.nodes : null;
    if (sort.key === "density") return row.density;
    if (sort.key === "flow") return row.flow;
    if (sort.key === "people") return row.people;
    if (sort.key === "queue") return row.queue;
    if (sort.key === "net") return row.net;
    return row.confidence;
  };
  return copy.sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.name.localeCompare(b.name);
    return sort.descending ? right - left : left - right;
  });
}

function sectorAnchors(geometry: VenueGeometry): SectorAnchor[] {
  const zones = Object.values(geometry.pack.zones ?? {});
  const viewing = zones.filter((zone) => zone.kind === "viewing" && zone.name);
  const candidates = viewing.length ? viewing : zones.filter((zone) => zone.name);
  return candidates
    .map((zone) => ({ id: zone.id, name: zone.name ?? zone.id, x: zone.position.x, y: zone.position.y }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function anchorPoint(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

function nearest(point: { x: number; y: number }, anchors: SectorAnchor[]): SectorAnchor {
  let best = anchors[0]!;
  let distance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const next = (point.x - anchor.x) ** 2 + (point.y - anchor.y) ** 2;
    if (next < distance) {
      best = anchor;
      distance = next;
    }
  }
  return best;
}

function aggregateSector(
  anchor: SectorAnchor,
  zoneIds: string[],
  states: Record<string, ZoneState>,
  unknown: Set<string>,
  people: number,
): SectorRow {
  const observed = zoneIds.flatMap((id) => states[id] ? [states[id]!] : []);
  const visibility: SectorVisibility = observed.length ? "observed" : zoneIds.some((id) => !unknown.has(id)) ? "silent" : "unknown";
  const worst = observed.reduce<ZoneState | null>((current, state) => current == null || state.density_persons_m2 > current.density_persons_m2 ? state : current, null);
  const nodes = observed.reduce((total, state) => total + state.observed_nodes, 0);
  const weighted = (read: (state: ZoneState) => number): number | null => {
    if (!observed.length) return null;
    const weight = observed.reduce((total, state) => total + Math.max(state.observed_nodes, 1), 0);
    return observed.reduce((total, state) => total + read(state) * Math.max(state.observed_nodes, 1), 0) / weight;
  };
  return {
    id: anchor.id,
    name: anchor.name,
    visibility,
    zoneCount: zoneIds.length,
    observedZoneCount: observed.length,
    word: worst ? worst.band.toUpperCase() : visibility.toUpperCase(),
    band: worst?.band ?? null,
    density: worst?.density_persons_m2 ?? null,
    flow: weighted((state) => state.flow_ped_m_min),
    speed: weighted((state) => state.mean_speed_ms),
    nodes,
    people,
    queue: observed.length ? observed.reduce((total, state) => total + (state.queue_excess ?? 0), 0) : null,
    net: observed.length ? observed.reduce((total, state) => total + state.net_flow_per_min, 0) : null,
    confidence: weighted((state) => state.confidence.value),
    reportable: observed.length > 0 && observed.every((state) => state.confidence.reportable),
    losGrade: observed.reduce((grade, state) => state.los_grade > grade ? state.los_grade : grade, "A"),
    overCapacity: observed.some((state) => state.over_capacity),
  };
}
