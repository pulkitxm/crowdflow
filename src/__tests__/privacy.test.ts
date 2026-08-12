import { describe, expect, it } from 'vitest';
import type { NodeTelemetry } from '../core/contracts';
import { assertPrivatePayload } from '../core/privacy';
import { encodeTelemetryBatch, isNodeTelemetry } from '../protocol/telemetry';

const telemetry: NodeTelemetry = {
  node_id: '8f3a', timestamp: 1_723_300_102, position: { x: 43.2, y: 81.7 },
  position_accuracy: 4.5, velocity: 1.24, direction: 72, zone: 'zone_c17',
  local_density: .74, confidence: .91, source: 'phone',
};

describe('privacy and telemetry contract', () => {
  it('emits canonical telemetry with no forbidden identity fields', () => {
    const body = JSON.parse(encodeTelemetryBatch([telemetry]));
    expect(body.batch[0]).toEqual(telemetry);
    expect(isNodeTelemetry(body.batch[0])).toBe(true);
    expect(() => assertPrivatePayload(body)).not.toThrow();
  });

  it('rejects forbidden nested keys', () => {
    expect(() => assertPrivatePayload({ batch: [{ android_id: 'nope' }] })).toThrow('Forbidden wire field');
  });
});
