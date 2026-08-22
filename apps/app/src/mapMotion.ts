export function easeOutCubic(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return 1 - (1 - t) ** 3;
}

export function revealProgress(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return Math.min(Math.max((value - start) / (end - start), 0), 1);
}

/** Exponential approach toward a target — continuous, not a restarted timeline. */
export function smoothToward(current: number, target: number, dtMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return target;
  const t = 1 - 0.5 ** (Math.max(dtMs, 0) / halfLifeMs);
  return current + (target - current) * t;
}

/** Decay a 2D velocity with the same half-life model used for zoom settling. */
export function decayVelocity(
  velocity: { x: number; y: number },
  dtMs: number,
  halfLifeMs: number,
): { x: number; y: number } {
  if (halfLifeMs <= 0) return { x: 0, y: 0 };
  const factor = 0.5 ** (Math.max(dtMs, 0) / halfLifeMs);
  return { x: velocity.x * factor, y: velocity.y * factor };
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
