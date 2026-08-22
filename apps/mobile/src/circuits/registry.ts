
import type { AnchorPack, CircuitCapability, CircuitPack, CircuitSummary, VenueGeometry } from '@crowdflow/contracts/wire';
import { planAnchors } from '@crowdflow/core/positioning';
import { DEMO_GEOMETRY } from './demo';

export interface CircuitChoice {
  id: string;
  name: string;
  layout_id: string;
  capability: CircuitCapability;
  track_length_m: number;
}

function toChoice(summary: CircuitSummary): CircuitChoice {
  return {
    id: summary.id,
    name: summary.name,
    layout_id: summary.layout_id,
    capability: summary.capability,
    track_length_m: summary.track_length_m,
  };
}

export function circuitCapabilityChip(capability: CircuitCapability): string {
  if (capability === 'synthetic_simulation') return 'simulation only';
  if (capability === 'venue_imported') return 'review required';
  return 'venue reviewed';
}

export function supportsOperationalGuidance(capability: CircuitCapability): boolean {
  return capability === 'venue_reviewed';
}

export function circuitCapabilityNotice(circuit: Pick<CircuitChoice, 'layout_id' | 'capability'>): string {
  const layout = `Layout ${circuit.layout_id}`;
  if (circuit.capability === 'synthetic_simulation') return `${layout} uses a synthetic circuit pack for simulation only. It is not suitable for operational guidance.`;
  if (circuit.capability === 'venue_imported') return `${layout} uses imported venue data that must be reviewed before operational guidance.`;
  return `${layout} has venue-reviewed data for operational guidance.`;
}

async function json<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return (await response.json()) as T;
}

export interface CircuitSource {
  demo: boolean;
  list(): Promise<CircuitChoice[]>;
  geometry(id: string): Promise<VenueGeometry>;
  anchors(id: string): Promise<AnchorPack>;
}

export function liveSource(api: string): CircuitSource {
  return {
    demo: false,
    async list() {
      const summaries = await json<CircuitSummary[]>(api, '/api/circuits');
      return summaries.map(toChoice);
    },
    async geometry(id: string) {
      return json<VenueGeometry>(api, `/api/circuits/${id}/geometry`);
    },
    async anchors(id: string) {
      return json<AnchorPack>(api, `/api/circuits/${id}/anchors`);
    },
  };
}

export function demoSource(): CircuitSource {
  const pack = DEMO_GEOMETRY.pack as unknown as CircuitPack;
  return {
    demo: true,
    async list() {
      return [
        {
          id: DEMO_GEOMETRY.pack.id,
          name: DEMO_GEOMETRY.pack.name,
          layout_id: pack.layout_id ?? pack.geometry_source,
          capability: pack.capability ?? 'synthetic_simulation',
          track_length_m: DEMO_GEOMETRY.pack.track_length_m,
        },
      ];
    },
    async geometry(id: string) {
      if (id !== DEMO_GEOMETRY.pack.id) throw new Error(`demo pack has no ${id}`);
      return DEMO_GEOMETRY as unknown as VenueGeometry;
    },
    async anchors(id: string) {
      if (id !== DEMO_GEOMETRY.pack.id) throw new Error(`demo pack has no ${id}`);
      return planAnchors(DEMO_GEOMETRY.pack as never, { spacing_m: 40 });
    },
  };
}

export function createCircuitSource(api: string | undefined): CircuitSource {
  return api ? liveSource(api) : demoSource();
}
