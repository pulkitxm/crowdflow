import type { Position } from "@crowdflow/contracts";

export type MapLayer = "live" | "kinds";
export type MapRotation = 0 | 90 | 180 | 270;

export interface MapQueryState {
  full: boolean;
  zoom: number;
  center: Position | null;
  rotation: MapRotation;
  layer: MapLayer;
  grid: boolean;
}

export function readMapQuery(search: string): MapQueryState {
  const query = new URLSearchParams(search);
  const zoom = Number(query.get("zoom"));
  const centerXValue = query.get("cx");
  const centerYValue = query.get("cy");
  const centerX = Number(centerXValue);
  const centerY = Number(centerYValue);
  const rotationText = query.get("rotation");
  const rotationValue = Number(rotationText);
  const rotation: MapRotation = rotationText !== null && (rotationValue === 0 || rotationValue === 90 || rotationValue === 180 || rotationValue === 270)
    ? rotationValue
    : 270;
  return {
    full: query.get("map") === "full",
    zoom: Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 50 ? zoom : 1,
    center: centerXValue !== null && centerYValue !== null && Number.isFinite(centerX) && Number.isFinite(centerY)
      ? { x: centerX, y: centerY }
      : null,
    rotation,
    layer: query.get("layer") === "kinds" ? "kinds" : "live",
    grid: query.get("grid") === "on",
  };
}

export function writeMapQuery(search: string, state: MapQueryState): string {
  const query = new URLSearchParams(search);
  if (state.full) query.set("map", "full");
  else query.delete("map");
  query.set("zoom", compact(state.zoom, 3));
  query.set("rotation", String(state.rotation));
  query.set("layer", state.layer);
  if (state.grid) query.set("grid", "on");
  else query.delete("grid");
  if (state.center) {
    query.set("cx", compact(state.center.x, 1));
    query.set("cy", compact(state.center.y, 1));
  } else {
    query.delete("cx");
    query.delete("cy");
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

function compact(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}
