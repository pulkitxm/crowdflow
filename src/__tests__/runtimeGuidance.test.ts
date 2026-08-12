import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RerouteCommand } from '../core/contracts';
import { TypedEvent } from '../core/events';
import type { VenuePosition } from '../location/locationEngine';
import { demoVenue } from '../venue/demoVenue';

vi.mock('../gateway/broadcastServer', () => ({
  BroadcastServer: class { start() {} stop() {} },
}));
vi.mock('../network/telemetryUploader', () => ({
  TelemetryUploader: class {
    statsChanged = new TypedEvent(); connectivityChanged = new TypedEvent();
    start() {} stop() {} offer() {}
  },
}));

import { CrowdNodeRuntime } from '../runtime/crowdNodeRuntime';

class FakeTransports {
  packets = new TypedEvent(); peersChanged = new TypedEvent(); statusesChanged = new TypedEvent();
  activeName = 'Test';
  async start() {} async stop() {} async updateNodeId() {} async broadcast() {}
  peers() { return []; } statuses() { return []; }
}

class FakeLocation {
  changed = new TypedEvent<VenuePosition>();
  latest?: VenuePosition;
  async start() {} stop() {}
  current() { return this.latest; }
  inject() {}
  move(zoneId: string): void {
    const zone = demoVenue.zone(zoneId);
    this.latest = {
      point: zone.centroid, accuracy: 2, velocity: 1, direction: 0,
      zoneId, confidence: .9, timestamp: Date.now(),
    };
    this.changed.emit(this.latest);
  }
}

class FakeSettings {
  backendUrl = 'http://example.test'; gatewayEnabled = false;
  async setBackendUrl(value: string) { this.backendUrl = value; }
  async setGatewayEnabled(value: boolean) { this.gatewayEnabled = value; }
}

function reroute(destination: string, expiresAt: number): RerouteCommand {
  const now = Math.floor(Date.now() / 1_000);
  return {
    type: 'REROUTE', route_id: 'runtime-test', issued_at: now - 1, expires_at: expiresAt,
    source_zone: 'gate_a', destination_zone: destination, avoid: ['zone_c17'],
    preferred: ['zone_c11'], fraction: 1, reason: 'test', priority: 'EMERGENCY',
  };
}

describe('runtime guidance lifecycle', () => {
  let location: FakeLocation;
  let runtime: CrowdNodeRuntime;

  beforeEach(async () => {
    location = new FakeLocation();
    runtime = new CrowdNodeRuntime(
      demoVenue, new FakeTransports() as never, location as never, new FakeSettings() as never,
      () => Uint8Array.from([0x12, 0x34]),
    );
    await runtime.start();
  });

  it('recomputes the local route when the phone enters another zone', async () => {
    location.move('junction_center');
    expect(runtime.snapshot().route[0]).toBe('junction_center');
    expect(runtime.snapshot().destination).toBe('food_court');
    await runtime.stop();
  });

  it('restores the user destination after a reroute expires', async () => {
    location.move('gate_a');
    const command = reroute('medical', Math.floor(Date.now() / 1_000) + 30);
    expect(runtime.injectReroute(command)).toBe(true);
    expect(runtime.snapshot().destination).toBe('medical');

    command.expires_at = Math.floor(Date.now() / 1_000) - 1;
    location.move('plaza_a');
    expect(runtime.snapshot().destination).toBe('food_court');
    expect(runtime.snapshot().route[0]).toBe('plaza_a');
    expect(runtime.snapshot().guidance?.command).toBeUndefined();
    await runtime.stop();
  });
});
