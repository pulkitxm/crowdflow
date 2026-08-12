import { Buffer } from 'buffer';
import { BridgeServer, type Request } from 'react-native-http-bridge-refurbished';
import { decodeMeshMessage } from '../protocol/meshCodec';
import type { MeshRouter } from '../mesh/meshRouter';

export const GATEWAY_BROADCAST_PORT = 8_765;

/** LAN endpoint used by the backend to inject an already packed mesh packet. */
export class BroadcastServer {
  private server?: BridgeServer;

  constructor(private readonly router: MeshRouter) {}

  start(): void {
    if (this.server) return;
    const server = new BridgeServer('crowdflow_mesh_gateway');
    server.get('/health', async () => ({ status: 'ok' }));
    server.post('/broadcast', async (request, response) => {
      try {
        const bytes = decodeRequestBody(request);
        if (bytes.length === 0) throw new Error('Empty mesh packet');
        await this.router.originate(decodeMeshMessage(bytes));
        response.json({ accepted: true }, 202);
      } catch (error) {
        response.json({ accepted: false, error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });
    server.listen(GATEWAY_BROADCAST_PORT);
    this.server = server;
  }

  stop(): void {
    this.server?.stop(); this.server = undefined;
  }
}

function decodeRequestBody(request: Request<unknown>): Uint8Array {
  const raw = request.postData;
  if (typeof raw !== 'string') return new Uint8Array();
  const trimmed = raw.trim();
  // Primary format is base64 because the bridge exposes parsed HTTP bodies as UTF-8 strings.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return new Uint8Array(Buffer.from(trimmed, 'base64'));
  try {
    const json = JSON.parse(trimmed) as { packet?: string };
    if (typeof json.packet === 'string') return new Uint8Array(Buffer.from(json.packet, 'base64'));
  } catch { /* let the protocol validator reject arbitrary bytes */ }
  return new Uint8Array(Buffer.from(raw, 'latin1'));
}
