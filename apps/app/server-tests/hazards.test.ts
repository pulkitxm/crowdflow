import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CrowdFlowServer } from '../server/app.js';
import { HazardController } from '../server/hazards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function running() {
  const server = new CrowdFlowServer(root, { databasePath: ':memory:' });
  const session = server.startSession({ population: 60, seed: 9, intervene: false });
  for (const agent of session.sim.agents) agent.depart_at_s = 0;
  session.tickOnce();
  return { server, session, hazards: new HazardController(session) };
}

describe('server hazard model', () => {
  it('creates simultaneous hazards and clears only the selected record', async () => {
    const { server, session, hazards } = running();
    const origin = session.option.origins![0]!;
    const gate = Object.values(session.circuit.pack.zones ?? {}).find((zone) => zone.kind === 'gate' && session.circuit.graph.neighbours(zone.id).length)?.id;
    if (!gate) throw new Error('test circuit has no connected gate');
    const fire = hazards.apply({ type: 'fire', severity: 'high', mode: 'closed', radius_m: 5, location: { zone_id: origin } });
    const blockage = hazards.apply({ type: 'gate_blockage', severity: 'medium', mode: 'restricted', capacity_percent: 35, location: { gate_id: gate } });
    expect(hazards.active().map((hazard) => hazard.id)).toEqual([fire.id, blockage.id]);
    expect(hazards.gateAvailability().find((entry) => entry.id === gate)?.capacity_percent).toBe(35);
    hazards.clear(fire.id);
    expect(hazards.active().map((hazard) => hazard.id)).toEqual([blockage.id]);
    expect(hazards.history().find((hazard) => hazard.id === fire.id)?.status).toBe('cleared');
    await server.close();
  });

  it('closes and restores a walkway in the graph', async () => {
    const { server, session, hazards } = running();
    const edge = Object.keys(session.circuit.pack.edges ?? {})[0]!;
    const record = hazards.apply({ type: 'walkway_blockage', severity: 'critical', mode: 'closed', location: { edge_id: edge } });
    expect(session.circuit.graph.isEdgeAvailable(edge)).toBe(false);
    hazards.clear(record.id);
    expect(session.circuit.graph.isEdgeAvailable(edge)).toBe(true);
    await server.close();
  });

  it('rejects invalid partial capacity and unknown hazard targets', async () => {
    const { server, hazards } = running();
    expect(() => hazards.apply({ type: 'gate_blockage', severity: 'high', mode: 'restricted', capacity_percent: 100, location: { gate_id: 'missing' } })).toThrow('capacity_percent');
    expect(() => hazards.apply({ type: 'walkway_blockage', severity: 'high', mode: 'closed', location: { edge_id: 'missing' } })).toThrow('known edge_id');
    await server.close();
  });
});
