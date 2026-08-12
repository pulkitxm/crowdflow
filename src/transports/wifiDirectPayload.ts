export interface WifiDirectPayload {
  encoded: string;
  fromAddress?: string;
}

const MAX_BASE64_PACKET_LENGTH = 340; // ceil(255 / 3) * 4

/** Normalize the package's string and metadata receive modes before decoding. */
export function parseWifiDirectPayload(value: unknown): WifiDirectPayload | undefined {
  const encoded = typeof value === 'string'
    ? value
    : isRecord(value) && typeof value.message === 'string' ? value.message : undefined;
  if (!encoded || encoded.length > MAX_BASE64_PACKET_LENGTH || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return undefined;
  const fromAddress = isRecord(value) && typeof value.fromAddress === 'string'
    ? value.fromAddress : undefined;
  return { encoded, fromAddress };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
