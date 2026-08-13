import { describe, expect, it } from 'vitest';
import type { CircuitPack, VenueState } from '@crowdflow/contracts';
import { SafetyEngine, VenueGraph } from '@crowdflow/core';
import { CrowdOpsAgent, DEFAULT_ANTHROPIC_MODEL, DEFAULT_THINKING_BUDGET_TOKENS, FakeModelClient, InsightEngine, Toolbox, toAnthropic } from '../src/index.js';

const sourced = { value: 2, provenance: 'measured' as const, samples: 64 };
const pack: CircuitPack = {
  id: 'toy', name: 'Toy', geometry_source: 'synthetic', track_length_m: 100, altitude_m: 0,
  frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [100, 10], venue_bounds_m: [0, 0, 100, 10] },
  zones: { a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } }, forbidden: { id: 'forbidden', kind: 'concourse', position: { x: 50, y: 0 } }, b: { id: 'b', kind: 'exit', position: { x: 100, y: 0 } } },
  edges: { af: { id: 'af', source: 'a', destination: 'forbidden', length_m: 50, width_m: sourced }, fb: { id: 'fb', source: 'forbidden', destination: 'b', length_m: 50, width_m: sourced } },
  crossings: {}, constraints: { never_route_through: ['forbidden'], emergency_exits: ['b'] },
};
const state: VenueState = { circuit_id: 'toy', timestamp: 0, session_id: null, zones: {}, unobserved_zones: ['a', 'forbidden', 'b'] };

describe('TypeScript Crowd Ops Agent', () => {
  it('cannot produce an unreviewed or dispatched proposal', async () => {
    const graph = new VenueGraph(pack); const toolbox = new Toolbox({ pack, graph, safety: new SafetyEngine(pack), state, now: 0 });
    const client = new FakeModelClient([
      { tool_calls: [{ id: '1', name: 'create_reroute', arguments: { source_zone: 'a', destination_zone: 'b', avoid: [], prefer: [], target_fraction: 0.3, reason: 'test' } }], thinking_blocks: [] },
      { text: 'There is no permissible route.', tool_calls: [], thinking_blocks: [] },
    ]);
    const run = await new CrowdOpsAgent(client, toolbox).ask('reroute them');
    expect(run.proposals).toHaveLength(0); // tool cannot cost a forbidden-only path
    expect(JSON.stringify(run.turns)).toContain('cannot cost reroute');
    expect(JSON.stringify(run.turns)).not.toContain('"dispatched":true');
  });

  it('round-trips provider continuity blocks before tool calls', () => {
    const thinking = { type: 'thinking', thinking: 'opaque', signature: 'signed' };
    const rendered = toAnthropic([{ role: 'assistant', text: 'checking', thinking_blocks: [thinking], tool_calls: [{ id: '1', name: 'get_venue_state', arguments: {} }] }]);
    expect((rendered[0]!.content as any[])[0]).toEqual(thinking);
    expect((rendered[0]!.content as any[])[2].type).toBe('tool_use');
  });

  it('uses a currently supported Anthropic model family and permits explicit configuration', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toMatch(/^claude-/); expect(DEFAULT_THINKING_BUDGET_TOKENS).toBeGreaterThanOrEqual(1024);
  });

  it('detects a gate departing from its own baseline without model arithmetic', () => {
    const engine = new InsightEngine(pack); const zone = (density: number) => ({ zone_id: 'a', timestamp: 0, observed_nodes: 20, participation_rate: 0.2, density_persons_m2: density, flow_ped_m_min: 10, queue_excess: 0, mean_speed_ms: 1, dominant_heading_deg: null, inflow_per_min: 1, outflow_per_min: 1, confidence: { value: 0.8, observed_nodes: 20, freshness_s: 0, mean_accuracy_m: 5, stability: 1, reportable: true }, estimated_population: 100, band: 'nominal' as const, over_capacity: false, los_grade: 'A', net_flow_per_min: 0 });
    for (const density of [1, 1.1, 0.9, 1.05, 0.95, 1.02, 0.98, 1.08, 2]) engine.observe({ ...state, session_id: 'practice', zones: { a: zone(density) } }); expect(engine.insights()[0]?.kind).toBe('self_baseline');
  });

  it('offers the complete read/propose surface and no dispatch tool', () => {
    const toolbox = new Toolbox({ pack, graph: new VenueGraph(pack), safety: new SafetyEngine(pack), state, now: 0 });
    const names = toolbox.schemas().map((tool) => tool.name); expect(names).toContain('get_event_schedule'); expect(names).toContain('generate_insight'); expect(names).not.toContain('dispatch');
  });
});
