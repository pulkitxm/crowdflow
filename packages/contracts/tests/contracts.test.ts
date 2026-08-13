import { describe, expect, it } from 'vitest';
import {
  bandForDensity,
  completeZoneState,
  densityForFlow,
  isActionable,
  isDispatchable,
  isReportable,
  LOS_C_MAX,
  LOS_E_MAX,
} from '../src/index.js';

describe('load-bearing contract conclusions', () => {
  it('classifies zones on density and exposes the unreachable flow boundary', () => {
    expect(densityForFlow(LOS_C_MAX)).toBeCloseTo(0.7501, 3);
    expect(densityForFlow(LOS_E_MAX)).toBeNull();
    expect(bandForDensity(0)).toBe('nominal');
    expect(bandForDensity(3)).toBe('critical');
  });

  it('does not let three clean phones clear the actionable confidence floor', () => {
    const confidence = {
      value: 0.49,
      observed_nodes: 3,
      freshness_s: 0,
      mean_accuracy_m: 5,
      stability: 1,
      reportable: true,
    };
    expect(isReportable(confidence)).toBe(true);
    expect(isActionable({
      zone_id: 'gate', issued_at: 0, horizon_s: 300, target_band: 'critical',
      probability: 0.95, time_to_threshold_s: 30,
      projected_peak_density_persons_m2: 2.5, confidence: confidence.value,
      model_id: 'test', actionable: false,
    })).toBe(false);
  });

  it('serves every derived zone conclusion from one implementation', () => {
    const zone = completeZoneState({
      zone_id: 'gate', timestamp: 0, observed_nodes: 20, participation_rate: 0.2,
      density_persons_m2: 2.1, flow_ped_m_min: 20, queue_excess: 0,
      mean_speed_ms: 0.2, dominant_heading_deg: null, inflow_per_min: 10,
      outflow_per_min: 3,
      confidence: { value: 0.8, observed_nodes: 20, freshness_s: 0,
        mean_accuracy_m: 5, stability: 1, reportable: false },
    });
    expect(zone.band).toBe('critical');
    expect(zone.over_capacity).toBe(true);
    expect(zone.net_flow_per_min).toBe(7);
    expect(zone.confidence.reportable).toBe(true);
  });

  it('only dispatches the exact approved command', () => {
    expect(isDispatchable({ command_id: 'x', outcome: 'approved', reason: 'ok', dispatchable: false })).toBe(true);
    expect(isDispatchable({ command_id: 'x', outcome: 'modified', reason: 'change it', dispatchable: true })).toBe(false);
  });
});
