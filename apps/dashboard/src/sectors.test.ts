import { describe, expect, it } from "vitest";
import type { LiveSnapshot, PeopleQueryResult, VenueGeometry, ZoneState } from "@crowdflow/api/wire";
import { buildSectorAreas, buildSectorRows, sortSectorRows } from "./sectors";

function state(id: string, density: number, nodes: number): ZoneState {
  return {
    zone_id: id, timestamp: 10, observed_nodes: nodes, participation_rate: 1, density_persons_m2: density,
    flow_ped_m_min: density * 40, queue_excess: 2, mean_speed_ms: 1.1, inflow_per_min: 8, outflow_per_min: 3,
    confidence: { value: 0.8, observed_nodes: nodes, freshness_s: 0, mean_accuracy_m: 4, stability: 0.9, reportable: true },
    estimated_population: nodes, band: density >= 2 ? "critical" : "nominal", over_capacity: density >= 2,
    los_grade: density >= 2 ? "F" : "A", net_flow_per_min: 5,
  };
}

const geometry = {
  pack: {
    id: "toy", name: "Toy", geometry_source: "test", track_length_m: 1000, altitude_m: 0,
    frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [1000, 100], venue_bounds_m: [0, 0, 1000, 100] },
    zones: {
      west: { id: "west", name: "West Stand", kind: "viewing", position: { x: 0, y: 0 } },
      west_walk: { id: "west_walk", kind: "concourse", position: { x: 100, y: 0 } },
      east: { id: "east", name: "East Stand", kind: "viewing", position: { x: 1000, y: 0 } },
      east_walk: { id: "east_walk", kind: "concourse", position: { x: 900, y: 0 } },
    },
    edges: {}, epsilon: 0.1, noise_radius_m: 1,
  },
  track: [], integrity_problems: [],
} as VenueGeometry;

function live(): LiveSnapshot {
  return {
    circuit_id: "toy", server_time: 10, last_report_age_s: 0, participation: 1, participation_provenance: "assumed",
    state: { circuit_id: "toy", timestamp: 10, zones: { west: state("west", 0.2, 5), west_walk: state("west_walk", 2.1, 3), east: state("east", 0.1, 4) }, unobserved_zones: ["east_walk"] },
    reporting_devices: 12, accepted_total: 12, rejected_total: 0,
    coverage: { zones_total: 4, observed: 3, unknown: 1, silent: 0, low_confidence: 0, fraction_observed: 0.75 },
  };
}

function grid(west: number, east: number): PeopleQueryResult {
  return {
    circuit_id: "toy", coordinates: [], zoom: 1, grid_size_m: 100, matched_count: west + east, returned_count: 0, people: [],
    cells: [
      { id: "west", min_x: 0, min_y: 0, max_x: 100, max_y: 100, count: west, person_ids: [] },
      { id: "east", min_x: 900, min_y: 0, max_x: 1000, max_y: 100, count: east, person_ids: [] },
    ],
  };
}

describe("live sectors", () => {
  it("groups venue zones and exact live crowd around named viewing sectors", () => {
    const rows = buildSectorRows(live(), geometry, grid(120, 35));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === "west")).toMatchObject({ zoneCount: 2, observedZoneCount: 2, people: 120, density: 2.1, word: "CRITICAL" });
    expect(rows.find((row) => row.id === "east")).toMatchObject({ zoneCount: 2, observedZoneCount: 1, people: 35, density: 0.1 });
  });

  it("updates and sorts live crowd independently of the scenario tick", () => {
    const rows = buildSectorRows(live(), geometry, grid(20, 180));
    expect(sortSectorRows(rows, { key: "people", descending: true })[0]).toMatchObject({ id: "east", people: 180 });
  });

  it("builds a map area around every named sector anchor", () => {
    const areas = buildSectorAreas(geometry);
    expect(areas).toHaveLength(2);
    expect(areas.find((area) => area.id === "west")?.polygon).toContainEqual({ x: 500, y: 0 });
    expect(areas.find((area) => area.id === "east")?.polygon).toContainEqual({ x: 500, y: 100 });
  });
});
