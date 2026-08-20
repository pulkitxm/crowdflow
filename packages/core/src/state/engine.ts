import type { CircuitPack, CrowdNode, VenueState, ZoneState } from '@crowdflow/contracts';
import {
  ASSUMED_CONFIDENCE_COUNT_SATURATION,
  ASSUMED_CONFIDENCE_COUNT_WEIGHT,
  ASSUMED_ORPHAN_ZONE_LENGTH_M,
  ASSUMED_ORPHAN_ZONE_WIDTH_M,
  ASSUMED_POSITION_ACCURACY_BEST_M,
  ASSUMED_POSITION_ACCURACY_WORST_M,
  completeZoneState,
  isReportable,
} from '@crowdflow/contracts';
import { flowFromOccupancy, queueExcess } from './flow.js';
import { clamp01, round } from '../statistics.js';

export const DEFAULT_WINDOW_S = 30;
export const STALE_S = 90;

interface Counters { entered: number; exited: number }

export class StateEngine {
  private latest = new Map<string, CrowdNode>();
  private counters = new Map<string, Counters>();
  private lastZone = new Map<string, string>();
  private history = new Map<string, number[]>();
  private lastSeen = new Map<string, number>();

  constructor(
    readonly pack: CircuitPack,
    readonly participationRate: number,
    readonly windowS = DEFAULT_WINDOW_S,
  ) {
    if (!(participationRate > 0 && participationRate <= 1)) throw new Error('participation_rate must be measured and in (0, 1]');
  }

  ingest(nodes: CrowdNode[], now: number): number {
    const seen = new Set<string>();
    let kept = 0;
    for (const node of nodes) {
      const key = `${node.node_id}:${node.timestamp}`;
      if (seen.has(key) || now - node.timestamp > this.windowS) continue;
      seen.add(key);
      const zone = node.zone_id ?? this.nearestZone(node);
      if (!zone) continue;
      const previous = this.lastZone.get(node.node_id);
      if (previous !== zone) {
        this.counter(zone).entered += 1;
        if (previous) this.counter(previous).exited += 1;
        this.lastZone.set(node.node_id, zone);
      }
      const held = this.latest.get(node.node_id);
      if (!held || node.timestamp >= held.timestamp) this.latest.set(node.node_id, { ...node, zone_id: zone });
      this.lastSeen.set(zone, Math.max(this.lastSeen.get(zone) ?? 0, node.timestamp));
      kept += 1;
    }
    return kept;
  }

  snapshot(now: number, sessionId: string | null = null): VenueState {
    for (const [id, node] of this.latest) {
      if (now - node.timestamp > this.windowS) { this.latest.delete(id); this.lastZone.delete(id); }
    }
    const grouped = new Map<string, CrowdNode[]>();
    for (const node of this.latest.values()) {
      if (!node.zone_id) continue;
      const bucket = grouped.get(node.zone_id) ?? [];
      bucket.push(node);
      grouped.set(node.zone_id, bucket);
    }
    const zones: Record<string, ZoneState> = {};
    for (const [zoneId, fresh] of grouped) {
      const count = fresh.length;
      const people = count / this.participationRate;
      const [width, length] = this.zoneDimensions(zoneId);
      const meanSpeed = fresh.reduce((sum, node) => sum + node.speed_ms, 0) / count;
      const [density, , flow] = flowFromOccupancy(people, length, width, meanSpeed);
      const series = this.history.get(zoneId) ?? [];
      series.push(density);
      this.history.set(zoneId, series.slice(-10));
      const counters = this.counter(zoneId);
      const minutes = Math.max(this.windowS / 60, Number.EPSILON);
      zones[zoneId] = completeZoneState({
        zone_id: zoneId,
        timestamp: now,
        observed_nodes: count,
        participation_rate: this.participationRate,
        density_persons_m2: round(density, 4),
        flow_ped_m_min: round(flow, 2),
        queue_excess: round(queueExcess(people, length, width), 1),
        mean_speed_ms: round(meanSpeed, 3),
        dominant_heading_deg: null,
        inflow_per_min: round(counters.entered / minutes, 1),
        outflow_per_min: round(counters.exited / minutes, 1),
        confidence: this.confidence(fresh, now, stability(series)),
      });
      counters.entered = 0;
      counters.exited = 0;
    }
    const unobserved = Object.keys(this.pack.zones ?? {}).filter(
      (id) => !(id in zones) && now - (this.lastSeen.get(id) ?? -Infinity) > STALE_S,
    );
    return { circuit_id: this.pack.id, timestamp: now, session_id: sessionId, zones, unobserved_zones: unobserved };
  }

  private counter(zone: string): Counters {
    const value = this.counters.get(zone) ?? { entered: 0, exited: 0 };
    this.counters.set(zone, value);
    return value;
  }

  private nearestZone(node: CrowdNode): string | null {
    let best: string | null = null;
    let distance = Infinity;
    for (const [id, zone] of Object.entries(this.pack.zones ?? {})) {
      const current = Math.hypot(node.position.x - zone.position.x, node.position.y - zone.position.y);
      if (current < distance) { best = id; distance = current; }
    }
    return best;
  }

  private zoneDimensions(zoneId: string): [number, number] {
    let area = 0;
    let weightedWidth = 0;
    let totalLength = 0;
    for (const edge of Object.values(this.pack.edges ?? {})) {
      if (edge.source !== zoneId && edge.destination !== zoneId) continue;
      area += 0.5 * edge.length_m * edge.width_m.value;
      weightedWidth += edge.width_m.value * edge.length_m;
      totalLength += edge.length_m;
    }
    if (totalLength <= 0 || area <= 0) return [ASSUMED_ORPHAN_ZONE_WIDTH_M, ASSUMED_ORPHAN_ZONE_LENGTH_M];
    const width = weightedWidth / totalLength;
    return [width, area / width];
  }

  private confidence(nodes: CrowdNode[], now: number, stabilityValue: number) {
    const count = nodes.length;
    const freshness = now - Math.max(...nodes.map((node) => node.timestamp));
    const accuracy = nodes.reduce((sum, node) => sum + node.accuracy_m, 0) / count;
    const countTerm = Math.min(1, Math.log1p(count) / Math.log1p(ASSUMED_CONFIDENCE_COUNT_SATURATION));
    const freshTerm = clamp01(1 - freshness / this.windowS);
    const span = ASSUMED_POSITION_ACCURACY_WORST_M - ASSUMED_POSITION_ACCURACY_BEST_M;
    const accuracyTerm = clamp01(1 - (accuracy - ASSUMED_POSITION_ACCURACY_BEST_M) / span);
    const qualityWeight = (1 - ASSUMED_CONFIDENCE_COUNT_WEIGHT) / 3;
    const value = ASSUMED_CONFIDENCE_COUNT_WEIGHT * countTerm
      + qualityWeight * (freshTerm + accuracyTerm + stabilityValue);
    const confidence = {
      value: round(clamp01(value), 3), observed_nodes: count,
      freshness_s: round(freshness, 2), mean_accuracy_m: round(accuracy, 2),
      stability: round(stabilityValue, 3), reportable: false,
    };
    return { ...confidence, reportable: isReportable(confidence) };
  }
}

function stability(history: number[]): number {
  if (history.length < 3) return 0.4;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  if (mean <= 0) return 1;
  const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
  return clamp01(1 - Math.sqrt(variance) / mean);
}
