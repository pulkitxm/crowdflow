import { describe, expect, it } from 'vitest';
import { allowsSatelliteBasemap, circuitCapabilityDetails } from './circuitCapability';

describe('circuit capability display', () => {
  it('makes synthetic packs unambiguously simulation-only', () => {
    const details = circuitCapabilityDetails('synthetic_simulation');
    expect(details.label).toContain('SIMULATION ONLY');
    expect(details.notice).toContain('not suitable for operational guidance');
    expect(details.operationalGuidance).toBe(false);
    expect(allowsSatelliteBasemap('synthetic_simulation')).toBe(false);
  });

  it('distinguishes imported and reviewed venue packs', () => {
    expect(circuitCapabilityDetails('venue_imported')).toMatchObject({ operationalGuidance: false });
    expect(circuitCapabilityDetails('venue_reviewed')).toMatchObject({ operationalGuidance: true });
    expect(allowsSatelliteBasemap('venue_imported')).toBe(true);
    expect(allowsSatelliteBasemap('venue_reviewed')).toBe(true);
  });
});
