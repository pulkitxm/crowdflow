export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) throw new RangeError('minimum must not exceed maximum');
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.trunc(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function quantileNearest(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.round(clamp(fraction, 0, 1) * (sorted.length - 1));
  return sorted[index]!;
}

export function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
