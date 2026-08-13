import type {
  Availability,
  Confidence,
  Forecast,
  MeshMessage,
  SafetyVerdict,
  Sourced,
  ZoneState,
} from './types.js';
import {
  ASSUMED_ACTIONABLE_CONFIDENCE_FLOOR,
  ASSUMED_ACTIONABLE_PROBABILITY_FLOOR,
  ASSUMED_REPORTABLE_CONFIDENCE_FLOOR,
  ASSUMED_REPORTABLE_NODE_FLOOR,
  MEASURED_SAMPLE_FLOOR,
  bandForDensity,
  losGradeForFlow,
} from './standards.js';

export function isReportable(confidence: Confidence): boolean {
  return confidence.value >= ASSUMED_REPORTABLE_CONFIDENCE_FLOOR
    && confidence.observed_nodes >= ASSUMED_REPORTABLE_NODE_FLOOR;
}

export function isActionable(forecast: Forecast): boolean {
  return forecast.time_to_threshold_s != null
    && forecast.time_to_threshold_s > 0
    && forecast.probability >= ASSUMED_ACTIONABLE_PROBABILITY_FLOOR
    && forecast.confidence >= ASSUMED_ACTIONABLE_CONFIDENCE_FLOOR;
}

export function isDispatchable(verdict: SafetyVerdict): boolean {
  return verdict.outcome === 'approved';
}

export function isTrustworthy(source: Sourced): boolean {
  if (source.provenance === 'measured') {
    return (source.samples ?? 0) >= MEASURED_SAMPLE_FLOOR;
  }
  return source.provenance !== 'assumed';
}

export function isOpenDuring(availability: Availability, session: string | null): boolean {
  if (availability.always_open ?? true) return true;
  if (session == null) return false;
  if ((availability.closed_when ?? []).includes(session)) return false;
  const open = availability.open_when ?? [];
  return open.length === 0 || open.includes(session);
}

export function completeZoneState(
  state: Omit<ZoneState, 'estimated_population' | 'band' | 'over_capacity' | 'los_grade' | 'net_flow_per_min'>,
): ZoneState {
  const band = bandForDensity(state.density_persons_m2);
  return {
    ...state,
    confidence: { ...state.confidence, reportable: isReportable(state.confidence) },
    estimated_population: Math.round(state.observed_nodes / state.participation_rate),
    band,
    over_capacity: band === 'critical',
    los_grade: losGradeForFlow(state.flow_ped_m_min),
    net_flow_per_min: state.inflow_per_min - state.outflow_per_min,
  };
}

export function hopMessage(message: MeshMessage): MeshMessage {
  return { ...message, ttl: Math.max(0, message.ttl - 1) };
}

export function messageExpired(message: MeshMessage): boolean {
  return message.ttl <= 0;
}

export function validCommandAt(
  command: { issued_at: number; expires_at: number },
  time: number,
): boolean {
  return command.issued_at <= time && time < command.expires_at;
}
