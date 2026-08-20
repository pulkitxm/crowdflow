/**
 * The circuit catalogue: what a spectator can pick, and the geometry that
 * draws it.
 *
 * There are two sources, chosen at startup:
 *
 *   * **live** — the same API the operator console uses. The map a visitor
 *     sees and the map an operator watches are one drawing of one data set;
 *     when the venue pack is refined, the console shows it and this app shows
 *     it, because neither keeps its own copy.
 *   * **demo** — a small bundled copy of the seed circuit, so the landing page
 *     and picker work without a server. It is a fixture, never a fallback that
 *     silently pretends to be live: it is marked as the demo everywhere it
 *     appears.
 */

import type { AnchorPack, CircuitSummary, VenueGeometry } from '@crowdflow/api/wire';
import { planAnchors } from '@crowdflow/core/positioning';
import { DEMO_GEOMETRY } from './demo';

export interface CircuitChoice {
  id: string;
  name: string;
  track_length_m: number;
}

export function toChoice(summary: CircuitSummary): CircuitChoice {
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

/** A place the circuit list and maps come from. */
export interface CircuitSource {
  /** Whether this is the bundled demo rather than the live feed. */
  demo: boolean;
  list(): Promise<CircuitChoice[]>;
  geometry(id: string): Promise<VenueGeometry>;
  /**
   * The radio survey, for placing a phone by Wi-Fi or Bluetooth.
   *
   * Always returns a pack, empty when the venue has never been surveyed. That
   * is a fact the handset must act on — it means fall through to GNSS — and it
   * should not have to infer it from a missing response.
   */
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
    /**
     * A PLAN for the demo pack, not a survey — every anchor is
     * provenance=assumed and `surveyed_at` is null, which the solver charges
     * extra uncertainty for and the status screen labels.
     *
     * Generated rather than omitted because it is what makes rehearsal mode work
     * with no server: the simulated radios need somewhere to put their anchors,
     * and the whole point of rehearsal is that everything except the radio is
     * the real code path.
     */
    async anchors(id: string) {
      if (id !== DEMO_GEOMETRY.pack.id) throw new Error(`demo pack has no ${id}`);
      return planAnchors(DEMO_GEOMETRY.pack as never, { spacing_m: 40 });
    },
  };
}

/** Pick the source from the environment: live when an API is configured. */
export function createCircuitSource(api: string | undefined): CircuitSource {
  return api ? liveSource(api) : demoSource();
}
