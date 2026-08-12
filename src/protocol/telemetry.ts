import type { NodeTelemetry } from '../core/contracts';
import { assertPrivatePayload } from '../core/privacy';

export function encodeTelemetryBatch(batch: NodeTelemetry[]): string {
  const body = { batch };
  assertPrivatePayload(body);
  return JSON.stringify(body);
}

export function isNodeTelemetry(value: unknown): value is NodeTelemetry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<NodeTelemetry>;
  return (
    /^[0-9a-f]{4}$/.test(item.node_id ?? '') &&
    Number.isInteger(item.timestamp) &&
    isFiniteNumber(item.position?.x) &&
    isFiniteNumber(item.position?.y) &&
    isFiniteNumber(item.position_accuracy) &&
    isFiniteNumber(item.velocity) &&
    isFiniteNumber(item.direction) &&
    typeof item.zone === 'string' &&
    isFiniteNumber(item.confidence) && item.confidence! >= 0 && item.confidence! <= 1 &&
    (item.source === 'phone' || item.source === 'mesh_relay')
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
