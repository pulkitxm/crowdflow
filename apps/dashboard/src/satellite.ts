import type { Position } from "@crowdflow/contracts";

export interface SatelliteAsset {
  url: string;
  topLeft: Position;
  topRight: Position;
  bottomLeft: Position;
}

const SATELLITE_ASSETS: Record<string, SatelliteAsset> = {
  silverstone: {
    url: "/maps/silverstone/sentinel-2-2026-07-29.webp",
    topLeft: { x: -2893.684293, y: 3875.584621 },
    topRight: { x: 3790.061664, y: 3693.192715 },
    bottomLeft: { x: -3060.267632, y: -2383.346474 },
  },
};

export function satelliteAsset(circuitId: string): SatelliteAsset | null {
  return SATELLITE_ASSETS[circuitId] ?? null;
}

export function isLocalSatelliteUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}
