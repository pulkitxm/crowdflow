import type { ZoneState } from '@crowdflow/contracts';
import { CAPACITY_DENSITY } from '@crowdflow/contracts';

/**
 * The fixed, ordered feature vector served to a hosted tabular model.
 * A model on the Hub must be trained against exactly these columns; the names
 * are the column headers of the tabular payload.
 */
export const FEATURE_NAMES = [
  'density_persons_m2',
  'flow_ped_m_min',
  'mean_speed_ms',
  'inflow_per_min',
  'outflow_per_min',
  'net_flow_per_min',
  'queue_excess',
  'estimated_population',
  'observed_nodes',
  'confidence_value',
  'confidence_stability',
  'over_capacity',
  'capacity_utilization',
] as const;

/** Feature values keyed by name; the readable form used in dataset rows. */
export function zoneFeatures(zone: ZoneState): Record<string, number> {
  return {
    density_persons_m2: zone.density_persons_m2,
    flow_ped_m_min: zone.flow_ped_m_min,
    mean_speed_ms: zone.mean_speed_ms,
    inflow_per_min: zone.inflow_per_min,
    outflow_per_min: zone.outflow_per_min,
    net_flow_per_min: zone.net_flow_per_min,
    queue_excess: zone.queue_excess ?? 0,
    estimated_population: zone.estimated_population,
    observed_nodes: zone.observed_nodes,
    confidence_value: zone.confidence.value,
    confidence_stability: zone.confidence.stability,
    over_capacity: zone.over_capacity ? 1 : 0,
    capacity_utilization: zone.density_persons_m2 / CAPACITY_DENSITY,
  };
}

/** The same features in `FEATURE_NAMES` order, for the positional tabular payload. */
export function zoneFeatureRow(zone: ZoneState): number[] {
  const features = zoneFeatures(zone);
  return FEATURE_NAMES.map((name) => features[name]!);
}

/**
 * One tabular-regression batch: each feature is a column, each row is a zone,
 * in the order the rows are supplied. `tabularRegression` returns one number
 * per row, so the output stays aligned with `rows`.
 */
export function toTabularData(rows: Array<{ zone_id: string; features: number[] }>): Record<string, string[]> {
  const data: Record<string, string[]> = {};
  for (let index = 0; index < FEATURE_NAMES.length; index += 1) {
    data[FEATURE_NAMES[index]!] = rows.map((row) => String(row.features[index] ?? 0));
  }
  return data;
}

export function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
