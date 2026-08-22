export function easeOutCubic(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return 1 - (1 - t) ** 3;
}

export function revealProgress(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return Math.min(Math.max((value - start) / (end - start), 0), 1);
}

export interface LayerView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function layerTransform(from: LayerView, to: LayerView): { scale: number; x: number; y: number } {
  const scale = to.scale / Math.max(from.scale, 0.000001);
  return {
    scale,
    x: to.offsetX - from.offsetX * scale,
    y: to.offsetY - from.offsetY * scale,
  };
}
