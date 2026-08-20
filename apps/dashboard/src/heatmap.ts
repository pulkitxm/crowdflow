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

export const HEAT_BANDS: Array<{ band: HeatBand; label: string; range: string; colour: string }> = [
  { band: "low", label: "LOW", range: "< 0.005 ped/m²", colour: "#2b83f6" },
  { band: "active", label: "ACTIVE", range: "0.005–0.02 ped/m²", colour: "#18c886" },
  { band: "busy", label: "BUSY", range: "0.02–0.05 ped/m²", colour: "#ffb11b" },
  { band: "peak", label: "PEAK", range: "≥ 0.05 ped/m²", colour: "#ff4057" },
];

export function densityForCell(cell: GridCell): number {
  const area = Math.max((cell.max_x - cell.min_x) * (cell.max_y - cell.min_y), 1);
  return cell.count / area;
}

export function heatBandForDensity(density: number): HeatBand {
  if (density >= 0.05) return "peak";
  if (density >= 0.02) return "busy";
  if (density >= 0.005) return "active";
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
