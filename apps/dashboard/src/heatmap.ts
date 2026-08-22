import {
  ASSUMED_VIEWPORT_DENSITY_ACTIVE,
  ASSUMED_VIEWPORT_DENSITY_BUSY,
  ASSUMED_VIEWPORT_DENSITY_PEAK,
} from "@crowdflow/contracts";
import type { GridCell, PeopleQueryResult } from "@crowdflow/api/wire";

export type HeatBand = "low" | "active" | "busy" | "peak";

export interface HeatSpot {
  id: string;
  x: number;
  y: number;
  count: number;
  density: number;
  band: HeatBand;
}

const UNIT = "ped/m²";

export const HEAT_BANDS: Array<{ band: HeatBand; label: string; range: string; colour: string }> = [
  { band: "low", label: "LOW", range: `< ${ASSUMED_VIEWPORT_DENSITY_ACTIVE} ${UNIT}`, colour: "#3186e9" },
  { band: "active", label: "ACTIVE", range: `${ASSUMED_VIEWPORT_DENSITY_ACTIVE}–${ASSUMED_VIEWPORT_DENSITY_BUSY} ${UNIT}`, colour: "#00ca85" },
  { band: "busy", label: "BUSY", range: `${ASSUMED_VIEWPORT_DENSITY_BUSY}–${ASSUMED_VIEWPORT_DENSITY_PEAK} ${UNIT}`, colour: "#f3b539" },
  { band: "peak", label: "PEAK", range: `≥ ${ASSUMED_VIEWPORT_DENSITY_PEAK} ${UNIT}`, colour: "#f84b4b" },
];

export function densityForCell(cell: GridCell): number {
  const area = Math.max((cell.max_x - cell.min_x) * (cell.max_y - cell.min_y), 1);
  return cell.count / area;
}

export function heatBandForDensity(density: number): HeatBand {
  if (density >= ASSUMED_VIEWPORT_DENSITY_PEAK) return "peak";
  if (density >= ASSUMED_VIEWPORT_DENSITY_BUSY) return "busy";
  if (density >= ASSUMED_VIEWPORT_DENSITY_ACTIVE) return "active";
  return "low";
}

export function heatSpots(grid: PeopleQueryResult | null): HeatSpot[] {
  if (!grid) return [];
  return grid.cells.map((cell) => {
    const density = densityForCell(cell);
    return {
      id: cell.id,
      x: (cell.min_x + cell.max_x) / 2,
      y: (cell.min_y + cell.max_y) / 2,
      count: cell.count,
      density,
      band: heatBandForDensity(density),
    };
  });
}
