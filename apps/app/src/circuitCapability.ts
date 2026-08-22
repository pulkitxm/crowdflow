import type { CircuitCapability } from '@crowdflow/contracts';

export interface CircuitCapabilityDetails {
  label: string;
  notice: string;
  operationalGuidance: boolean;
}

const DETAILS: Record<CircuitCapability, CircuitCapabilityDetails> = {
  synthetic_simulation: {
    label: 'SIMULATION ONLY · NOT FOR OPERATIONAL GUIDANCE',
    notice: 'This synthetic circuit pack is for simulation only and is not suitable for operational guidance.',
    operationalGuidance: false,
  },
  venue_imported: {
    label: 'IMPORTED · REVIEW REQUIRED',
    notice: 'This imported venue pack must be reviewed before it is used for operational guidance.',
    operationalGuidance: false,
  },
  venue_reviewed: {
    label: 'VENUE REVIEWED',
    notice: 'This venue pack has been reviewed for operational guidance.',
    operationalGuidance: true,
  },
};

export function circuitCapabilityDetails(capability: CircuitCapability): CircuitCapabilityDetails {
  return DETAILS[capability];
}

export function allowsSatelliteBasemap(capability: CircuitCapability): boolean {
  return capability !== 'synthetic_simulation';
}
