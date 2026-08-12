import { BridgeServer } from 'react-native-http-bridge-refurbished';
import type { MeshMessage } from '../core/contracts';
import { decodeMeshMessage } from '../protocol/meshCodec';
import type { MeshRouter } from '../mesh/meshRouter';
import { decodeBroadcastBody } from './broadcastPayload';

export const GATEWAY_BROADCAST_PORT = 8_765;

/** LAN endpoint used by the backend to inject an already packed mesh packet. */
export class BroadcastServer {
  private server?: BridgeServer;

  constructor(private readonly router: MeshRouter) {}

  start(): void {
    if (this.server) return;
    const server = new BridgeServer('crowdflow_mesh_gateway', __DEV__);
    server.get('/health', async () => ({ status: 'ok' }));
    server.post('/broadcast', async (request, response) => {
      let message: MeshMessage;
      try {
        message = decodeMeshMessage(decodeBroadcastBody(request.postData));
      } catch (error) {
        response.json({ accepted: false, error: errorMessage(error) }, 400);
        return;
      }
      try {
        const applied = await this.router.inject(message);
        response.json({ accepted: true, duplicate: !applied }, 202);
      } catch (error) {
        response.json({ accepted: false, error: errorMessage(error) }, 503);
      }
    });
    server.use(async (_request, response) => {
      response.json({ error: 'Not found' }, 404);
    });
    server.listen(GATEWAY_BROADCAST_PORT);
    this.server = server;
  }

  stop(): void {
    this.server?.stop(); this.server = undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
