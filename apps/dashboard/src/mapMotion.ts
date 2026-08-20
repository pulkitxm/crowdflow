export function easeOutCubic(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return 1 - (1 - t) ** 3;
}

export function revealProgress(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return Math.min(Math.max((value - start) / (end - start), 0), 1);
}
