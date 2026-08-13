/**
 * The view model, tested on the thing it exists for: the difference between a
 * quiet zone and one nobody can see.
 *
 * The fixtures are typed against the generated payload types, so a schema change
 * that removes a field these tests rely on is a compile error rather than a
 * silently passing test.
 */
import { describe, expect, it } from "vitest";
import type { LOSBand, ZoneState } from "@contracts";
import type { TickEnvelope, VenueGeometry } from "@wire";
import { ZoneMemory, buildRows, coverageLines, sortRows } from "./model";

function zoneState(
  id: string,
  density: number,
  band: LOSBand = "nominal",
  nodes = 40,
  reportable = true,
): ZoneState {
  return {
    zone_id: id,
    timestamp: 100,
    observed_nodes: nodes,
    participation_rate: 0.18,
    density_persons_m2: density,
    flow_ped_m_min: density * 40,
    queue_excess: 0,
    mean_speed_ms: 1.1,
    dominant_heading_deg: null,
    inflow_per_min: 12,
    outflow_per_min: 4,
    confidence: {
      value: reportable ? 0.62 : 0.1,
      observed_nodes: nodes,
      freshness_s: 1,
      mean_accuracy_m: 8,
      stability: 0.7,
      reportable,
    },
    estimated_population: Math.round(nodes / 0.18),
    band,
    over_capacity: band === "critical",
    los_grade: "D",
    net_flow_per_min: 8,
  };
}

const geometry = {
  pack: {
    id: "toy",
    name: "Toy",
    geometry_source: "synthetic",
    track_length_m: 1000,
    altitude_m: 0,
    frame: {
      origin_lat: 0,
      origin_lon: 0,
      track_bounds_m: [100, 100],
      venue_bounds_m: [0, 0, 100, 100],
    },
    zones: {
      busy: { id: "busy", kind: "concourse", name: "Bridge", position: { x: 1, y: 1 } },
      quiet: { id: "quiet", kind: "amenity", name: "Kiosks", position: { x: 2, y: 2 } },
      gone: { id: "gone", kind: "gate", name: "Gate 4", position: { x: 3, y: 3 } },
      never: { id: "never", kind: "parking", name: "Car Park 9", position: { x: 4, y: 4 } },
    },
    edges: {},
  },
  track: [],
  integrity_problems: [],
} as unknown as VenueGeometry;

function envelope(overrides: Partial<TickEnvelope> = {}): TickEnvelope {
  return {
    tick: 12,
    time_s: 240,
    compute_ms: 31,
    state: {
      circuit_id: "toy",
      timestamp: 240,
      zones: {
        busy: zoneState("busy", 2.3, "critical"),
        quiet: zoneState("quiet", 0.2),
      },
      unobserved_zones: ["never"],
    },
    forecasts: [],
    actionable: [],
    candidates: [],
    command: null,
    verdict: null,
    dispatched: false,
    silent_zones: ["gone"],
    low_confidence_zones: [],
    coverage: {
      zones_total: 4,
      observed: 2,
      unknown: 1,
      silent: 1,
      low_confidence: 0,
      fraction_observed: 0.5,
    },
    population: {
      total: 100,
      waiting: 10,
      active: 60,
      arrived: 30,
      observed_nodes: 80,
      estimated_present: 444,
    },
    metrics: {
      peak_density: 2.3,
      critical_zone_seconds: 12,
      building_zone_seconds: 40,
      peak_critical_zones: 1,
      total_queue_peak: 0,
      arrived: 30,
      mean_walk_s: 300,
      p95_walk_s: 500,
      interventions: 0,
      rejected_by_safety: 0,
      samples: 12,
    },
    nodes: [],
    events: [],
    ...overrides,
  };
}

describe("buildRows", () => {
  it("splits zones three ways, and every pack zone gets a row", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(4);
    expect(byId.get("busy")?.visibility).toBe("observed");
    expect(byId.get("quiet")?.visibility).toBe("observed");
    expect(byId.get("gone")?.visibility).toBe("silent");
    expect(byId.get("never")?.visibility).toBe("unknown");
  });

  it("gives an unobserved zone no density at all — not a zero one", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const unknown = rows.find((r) => r.id === "never")!;
    expect(unknown.density).toBeNull();
    expect(unknown.band).toBeNull();
    expect(unknown.people).toBeNull();
    expect(unknown.word).toBe("UNKNOWN");
    // The number beside UNKNOWN is the device count that produced it.
    expect(unknown.value).toBe("0 nodes");
  });

  it("never labels an unseen zone with a band word", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    for (const row of rows.filter((r) => r.visibility !== "observed")) {
      expect(["NOMINAL", "BUILDING", "CRITICAL"]).not.toContain(row.word);
    }
  });

  it("carries a word AND a number for every single row", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    for (const row of rows) {
      expect(row.word.length).toBeGreaterThan(0);
      expect(row.value.length).toBeGreaterThan(0);
    }
  });

  it("reports how long a zone has been silent, once it has seen one", () => {
    const memory = new ZoneMemory();
    memory.observe(
      envelope({
        state: { ...envelope().state, zones: { gone: zoneState("gone", 1, "building") } },
      }),
    );
    const rows = buildRows(envelope({ time_s: 300 }), geometry, memory);
    const gone = rows.find((r) => r.id === "gone")!;
    expect(gone.silentFor).toBe(60);
    expect(gone.value).toContain("silent");
  });

  it("says so honestly when it has never seen a reading for a silent zone", () => {
    // A console that has just connected does not know how long the silence has
    // lasted, and must not imply that it does.
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const gone = rows.find((r) => r.id === "gone")!;
    expect(gone.silentFor).toBeNull();
    expect(gone.value).toBe("—");
  });

  it("flags a reading the contract says not to lean on, without hiding it", () => {
    const thin = envelope({
      state: {
        circuit_id: "toy",
        timestamp: 240,
        zones: { busy: zoneState("busy", 2.3, "critical", 2, false) },
        unobserved_zones: [],
      },
      silent_zones: [],
    });
    const busy = buildRows(thin, geometry, new ZoneMemory()).find((r) => r.id === "busy")!;
    expect(busy.reportable).toBe(false);
    expect(busy.density).toBe(2.3); // shown, not withheld
  });

  it("falls back to the zone id when geometry has not arrived", () => {
    const rows = buildRows(envelope(), null, new ZoneMemory());
    expect(rows.find((r) => r.id === "busy")?.name).toBe("busy");
  });
});

describe("sortRows", () => {
  it("sorts observed zones by density, worst first", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const sorted = sortRows(rows, { key: "density", descending: true });
    expect(sorted[0]?.id).toBe("busy");
  });

  it("keeps zones with no measurement at the bottom in BOTH directions", () => {
    // The failure this prevents: ascending by density putting every zone the
    // system cannot see at the top, presenting blindness as emptiness.
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    for (const descending of [true, false]) {
      const sorted = sortRows(rows, { key: "density", descending });
      const measured = sorted.filter((r) => r.density !== null);
      const absent = sorted.filter((r) => r.density === null);
      expect(sorted.slice(0, measured.length)).toEqual(measured);
      expect(sorted.slice(measured.length)).toEqual(absent);
    }
  });

  it("is stable on ties, by name", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const sorted = sortRows(rows, { key: "queue", descending: true });
    expect(sorted.map((r) => r.id).slice(0, 2)).toEqual(["busy", "quiet"]);
  });

  it("does not mutate its input", () => {
    const rows = buildRows(envelope(), geometry, new ZoneMemory());
    const order = rows.map((r) => r.id);
    sortRows(rows, { key: "density", descending: false });
    expect(rows.map((r) => r.id)).toEqual(order);
  });
});

describe("coverageLines", () => {
  it("states the denominator as the whole venue", () => {
    const [observed] = coverageLines(envelope());
    expect(observed?.word).toBe("OBSERVED");
    expect(observed?.detail).toContain("of 4 zones");
  });

  it("gives each category a word and a number", () => {
    for (const line of coverageLines(envelope())) {
      expect(line.word).toMatch(/^[A-Z ]+$/);
      expect(line.value).toMatch(/\d/);
    }
  });
});
