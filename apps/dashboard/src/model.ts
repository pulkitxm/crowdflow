/**
 * The console's view model: one row per zone, every tick.
 *
 * This module exists because the payload has three ways of saying "no reading"
 * and the screen must have three ways of showing it:
 *
 *   OBSERVED  a device reported — there is a band, a density and a confidence
 *   SILENT    reported inside the stale window, nothing this tick
 *   UNKNOWN   the state engine declares the zone unobserved
 *
 * None of them is "quiet". A zone with no reporting device is not an empty zone,
 * and under opportunistic uplinks that is the common case, not the edge case:
 * on the Silverstone pack roughly 97% of zones are unobserved at any instant.
 * The one rule that follows is that an absent measurement never sorts, colours
 * or renders as a zero.
 *
 * Nothing here classifies. `band` arrives already computed by
 * `standards.band_for_density`; this file only decides which word goes beside
 * which number.
 */
import type { LOSBand, ZoneKind, ZoneState } from "@crowdflow/contracts";
import type { TickEnvelope, VenueGeometry } from "@crowdflow/api/wire";
import { NO_VALUE, age, fixed, integer } from "./format";

type Visibility = "observed" | "silent" | "unknown";

export interface ZoneRow {
  id: string;
  name: string;
  kind: ZoneKind | "unknown";
  visibility: Visibility;
  /** The WORD. Never omitted, never replaced by a colour. */
  word: string;
  /** The NUMBER that belongs beside that word. Never a stand-in zero. */
  value: string;
  band: LOSBand | null;
  density: number | null;
  flow: number | null;
  speed: number | null;
  nodes: number;
  people: number | null;
  queue: number | null;
  net: number | null;
  confidence: number | null;
  reportable: boolean;
  losGrade: string;
  overCapacity: boolean;
  /** Seconds since this console last had a reading. Null when it never has. */
  silentFor: number | null;
  state: ZoneState | null;
}

export const BAND_WORD: Record<LOSBand, string> = {
  nominal: "NOMINAL",
  building: "BUILDING",
  critical: "CRITICAL",
};

/**
 * Remembers when each zone last produced a reading.
 *
 * Client-side because the payload does not carry it: the state engine keeps a
 * last-seen clock internally but publishes only the three-way split. A console
 * that has been connected can therefore say "silent for 42s"; one that has just
 * connected says so honestly by showing a dash rather than a confident zero.
 */
export class ZoneMemory {
  private lastSeen = new Map<string, number>();

  observe(envelope: TickEnvelope): void {
    for (const id of Object.keys(envelope.state.zones ?? {})) {
      this.lastSeen.set(id, envelope.time_s);
    }
  }

  silentFor(id: string, now: number): number | null {
    const seen = this.lastSeen.get(id);
    return seen === undefined ? null : Math.max(0, now - seen);
  }
}

function unknownRow(
  id: string,
  name: string,
  kind: ZoneKind | "unknown",
  visibility: Visibility,
  silentFor: number | null,
): ZoneRow {
  // The number beside UNKNOWN is the device count that produced it: zero. Beside
  // SILENT it is how long the silence has lasted. Both are facts about the
  // observation, which is the only thing the system actually knows.
  const word = visibility === "unknown" ? "UNKNOWN" : "SILENT";
  const value =
    visibility === "unknown"
      ? "0 nodes"
      : silentFor === null
        ? NO_VALUE
        : `${age(silentFor)} silent`;
  return {
    id,
    name,
    kind,
    visibility,
    word,
    value,
    band: null,
    density: null,
    flow: null,
    speed: null,
    nodes: 0,
    people: null,
    queue: null,
    net: null,
    confidence: null,
    reportable: false,
    losGrade: NO_VALUE,
    overCapacity: false,
    silentFor,
    state: null,
  };
}

export function buildRows(
  envelope: TickEnvelope,
  geometry: VenueGeometry | null,
  memory: ZoneMemory,
): ZoneRow[] {
  const zones = geometry?.pack.zones ?? {};
  const naming = (id: string) => zones[id]?.name ?? id;
  const kindOf = (id: string): ZoneKind | "unknown" => zones[id]?.kind ?? "unknown";

  const rows: ZoneRow[] = [];
  const observed = envelope.state.zones ?? {};

  for (const [id, state] of Object.entries(observed)) {
    rows.push({
      id,
      name: naming(id),
      kind: kindOf(id),
      visibility: "observed",
      word: BAND_WORD[state.band],
      value: fixed(state.density_persons_m2, 2),
      band: state.band,
      density: state.density_persons_m2,
      flow: state.flow_ped_m_min,
      speed: state.mean_speed_ms,
      nodes: state.observed_nodes,
      people: state.estimated_population,
      queue: state.queue_excess ?? 0,
      net: state.net_flow_per_min,
      confidence: state.confidence.value,
      // The contract's served judgement, never a TypeScript threshold copy.
      reportable: state.confidence.reportable,
      losGrade: state.los_grade,
      overCapacity: state.over_capacity,
      silentFor: 0,
      state,
    });
  }

  for (const id of envelope.silent_zones ?? []) {
    rows.push(
      unknownRow(id, naming(id), kindOf(id), "silent", memory.silentFor(id, envelope.time_s)),
    );
  }
  for (const id of envelope.state.unobserved_zones ?? []) {
    rows.push(
      unknownRow(id, naming(id), kindOf(id), "unknown", memory.silentFor(id, envelope.time_s)),
    );
  }
  return rows;
}

export type SortKey =
  | "density"
  | "flow"
  | "nodes"
  | "people"
  | "queue"
  | "net"
  | "confidence"
  | "name";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

const NUMERIC: Record<Exclude<SortKey, "name">, (row: ZoneRow) => number | null> = {
  density: (r) => r.density,
  flow: (r) => r.flow,
  nodes: (r) => (r.visibility === "observed" ? r.nodes : null),
  people: (r) => r.people,
  queue: (r) => r.queue,
  net: (r) => r.net,
  confidence: (r) => r.confidence,
};

/**
 * Sort, keeping absent measurements out of the ranking.
 *
 * Rows with no value always sink to the bottom, in both directions. Letting them
 * sort as zero would put every unobserved zone at the head of an ascending
 * density sort, presenting the parts of the venue the system cannot see as the
 * emptiest parts of it.
 */
export function sortRows(rows: ZoneRow[], sort: Sort): ZoneRow[] {
  const copy = [...rows];
  if (sort.key === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name) * (sort.descending ? -1 : 1));
    return copy;
  }
  const value = NUMERIC[sort.key];
  copy.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return a.name.localeCompare(b.name);
    return sort.descending ? y - x : x - y;
  });
  return copy;
}

export interface CoverageLine {
  word: string;
  value: string;
  detail: string;
}

/** The coverage strip: three words, three numbers, one denominator. */
export function coverageLines(envelope: TickEnvelope): CoverageLine[] {
  const c = envelope.coverage;
  return [
    {
      word: "OBSERVED",
      value: integer(c.observed),
      detail: `${((c.observed / Math.max(c.zones_total, 1)) * 100).toFixed(1)}% of ${integer(c.zones_total)} zones`,
    },
    { word: "SILENT", value: integer(c.silent), detail: "seen recently, nothing now" },
    { word: "UNKNOWN", value: integer(c.unknown), detail: "no reporting device" },
    {
      word: "LOW CONF",
      value: integer(c.low_confidence),
      detail: "reading exists, do not lean on it",
    },
  ];
}
