
import type { AnchorPack, CircuitSummary, VenueGeometry } from '@crowdflow/contracts/wire';
import { planAnchors } from '@crowdflow/core/positioning';
import { DEMO_GEOMETRY } from './demo';

interface CircuitChoice {
  id: string;
  name: string;
  track_length_m: number;
}

function toChoice(summary: CircuitSummary): CircuitChoice {
  return {
    id: summary.id,
    name: summary.name,
    track_length_m: summary.track_length_m,
  };
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
  return {
    demo: true,
    async list() {
      return [
        {
          id: DEMO_GEOMETRY.pack.id,
          name: DEMO_GEOMETRY.pack.name,
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
