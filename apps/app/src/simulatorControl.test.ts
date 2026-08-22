import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATOR_CONFIG, controlAvailability, hazardRequest, sessionRequest } from './simulatorControl.js';

describe('simulator browser controls', () => {
  it('builds the documented large run without changing its values', () => {
    const request = sessionRequest({ ...DEFAULT_SIMULATOR_CONFIG, population: '500000', join_rate_per_s: '1000', tick_ms: '1000', duration_s: '86400', movement_scale: '90' }, { gates: ['g1'], resetBeforeStart: true, intervene: true });
    expect(request).toMatchObject({ population: 500000, join_rate_per_s: 1000, tick_ms: 1000, duration_s: 86400, movement_scale: 90, gates: ['g1'] });
  });

  it('surfaces invalid numeric fields and impossible join duration', () => {
    expect(() => sessionRequest({ ...DEFAULT_SIMULATOR_CONFIG, population: '500001' }, { gates: [], resetBeforeStart: false, intervene: true })).toThrow('Population');
    expect(() => sessionRequest({ ...DEFAULT_SIMULATOR_CONFIG, population: '1000', join_rate_per_s: '1', duration_s: '10' }, { gates: [], resetBeforeStart: false, intervene: true })).toThrow('Duration');
  });

  it('enables only valid lifecycle transitions', () => {
    expect(controlAvailability('idle', false, false)).toMatchObject({ start: true, pause: false, resume: false, stop: false, reset: false });
    expect(controlAvailability('running', true, false)).toMatchObject({ start: false, pause: true, resume: false, stop: true, reset: true });
    expect(controlAvailability('paused', true, false)).toMatchObject({ pause: false, resume: true, stop: true });
    expect(Object.values(controlAvailability('running', true, true)).every((value) => !value)).toBe(true);
  });

  it('builds full and partial hazard requests from the editor', () => {
    const fire = hazardRequest({ hazardType: 'fire', severity: 'high', mode: 'closed', capacity: '50', radius: '75', targetKind: 'zone', zoneId: 'z1', gateId: '', edgeId: '', locationX: '0', locationY: '0' });
    const gate = hazardRequest({ hazardType: 'gate_blockage', severity: 'medium', mode: 'restricted', capacity: '35', radius: '0', targetKind: 'gate', zoneId: '', gateId: 'g1', edgeId: '', locationX: '0', locationY: '0' });
    const walkway = hazardRequest({ hazardType: 'walkway_blockage', severity: 'critical', mode: 'closed', capacity: '50', radius: '0', targetKind: 'zone', zoneId: '', gateId: '', edgeId: 'e1', locationX: '0', locationY: '0' });
    expect(fire).toMatchObject({ type: 'fire', mode: 'closed', radius_m: 75, location: { zone_id: 'z1' } });
    expect(gate).toMatchObject({ type: 'gate_blockage', mode: 'restricted', capacity_percent: 35, location: { gate_id: 'g1' } });
    expect(walkway).toMatchObject({ type: 'walkway_blockage', mode: 'closed', location: { edge_id: 'e1' } });
    expect(() => hazardRequest({ hazardType: 'gate_blockage', severity: 'medium', mode: 'restricted', capacity: '100', radius: '0', targetKind: 'gate', zoneId: '', gateId: 'g1', edgeId: '', locationX: '0', locationY: '0' })).toThrow('Remaining capacity');
  });
});
