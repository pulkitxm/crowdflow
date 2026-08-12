import { Buffer } from 'buffer';

/** Decode the documented base64 or JSON gateway body without accepting ambiguous raw bytes. */
export function decodeBroadcastBody(body: unknown): Uint8Array {
  if (typeof body !== 'string') throw new Error('Request body must contain a base64 mesh packet');
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error('Mesh packet is empty');

  if (trimmed.startsWith('{')) {
    let value: unknown;
    try { value = JSON.parse(trimmed); }
    catch { throw new Error('Request body is not valid JSON'); }
    const packet = (value as { packet?: unknown } | null)?.packet;
    if (typeof packet !== 'string') throw new Error('JSON body must contain a base64 packet string');
    return decodeBase64(packet);
  }
  return decodeBase64(trimmed);
}

function decodeBase64(value: string): Uint8Array {
  const encoded = value.trim();
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Mesh packet must be canonical base64');
  }
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}
