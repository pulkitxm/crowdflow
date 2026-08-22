import { describe, expect, it } from 'vitest';
import type { Forecast, VenueState } from '@crowdflow/contracts';
import { AdvisoryDesk, ADVISORY_INTERVAL_S } from '../src/advisory.js';

function forecast(over: Partial<Forecast> = {}): Forecast {
  return {
    zone_id: 'n1', issued_at: 0, horizon_s: 300, target_band: 'critical', probability: 0.9,
    time_to_threshold_s: 40, projected_peak_density_persons_m2: 3, confidence: 0.9,
    model_id: 'baseline-v1', causes: ['density rising'], actionable: true, ...over,
  };
}

const emptyState: VenueState = { circuit_id: 'toy', timestamp: 0, zones: {}, unobserved_zones: [] };

describe('advisory desk', () => {
  it('raises an advisory from an actionable forecast, with wording for spectators', () => {
    const desk = new AdvisoryDesk();
    const open = desk.sweep(0, emptyState, [forecast()], null, (id) => `Zone ${id}`);
    expect(open).toHaveLength(1);
    expect(open[0]!.severity).toBe('critical');
    expect(open[0]!.headline).toContain('Zone n1');
    expect(open[0]!.crowd_message).toContain('Zone n1');
    expect(open[0]!.approved).toBe(false);
  });

  it('throttles so it does not raise the same advisory every tick', () => {
    const desk = new AdvisoryDesk();
    desk.sweep(0, emptyState, [forecast()], null, (id) => id);
    desk.sweep(1, emptyState, [forecast()], null, (id) => id);
    expect(desk.advisories()).toHaveLength(1);
    desk.sweep(ADVISORY_INTERVAL_S + 1, emptyState, [forecast()], null, (id) => id);
    expect(desk.advisories()).toHaveLength(1);
  });

  it('publishes a spectator notice only when an operator approves', () => {
    const desk = new AdvisoryDesk();
    const [advisory] = desk.sweep(0, emptyState, [forecast()], null, (id) => id);
    expect(desk.notices(0)).toHaveLength(0);
    const notice = desk.approve(advisory!.id, 100, 600);
    expect(notice.message).toBe(advisory!.crowd_message);
    expect(notice.approved_by).toBe('operator');
    expect(desk.notices(200)).toHaveLength(1);
    expect(desk.notices(900)).toHaveLength(0);
  });

  it('refuses to publish twice or publish something unknown', () => {
    const desk = new AdvisoryDesk();
    const [advisory] = desk.sweep(0, emptyState, [forecast()], null, (id) => id);
    desk.approve(advisory!.id, 10, 600);
    expect(() => desk.approve(advisory!.id, 20, 600)).toThrow('already published');
    expect(() => desk.approve('adv-nope', 20, 600)).toThrow('no advisory');
  });

  it('ignores forecasts the contract did not call actionable', () => {
    const desk = new AdvisoryDesk();
    expect(desk.sweep(0, emptyState, [forecast({ actionable: false })], null, (id) => id)).toHaveLength(0);
  });
});
