import type { MeshMessage, NodeTelemetry, RerouteCommand, StateUpdate } from '../core/contracts';
import { TypedEvent, type Unsubscribe } from '../core/events';
import { epochSeconds, RotatingNodeIdentity, SequenceCounter, shouldComply, type RandomBytes } from '../core/identity';
import type { LocationEngine } from '../location/locationEngine';
import { BroadcastServer } from '../gateway/broadcastServer';
import { DensityEstimator } from '../mesh/densityEstimator';
import { MeshRouter } from '../mesh/meshRouter';
import { TelemetryUploader } from '../network/telemetryUploader';
import { decodeStateUpdate, encodeStateUpdate } from '../protocol/meshCodec';
import { decodeReroute } from '../protocol/rerouteCodec';
import type { SettingsStore } from '../storage/settings';
import type { TransportManager } from '../transports/transportManager';
import type { VenueGraph } from '../venue/venueGraph';
import { initialRuntimeState, type RuntimeState } from './runtimeState';

export class CrowdNodeRuntime {
  readonly changed = new TypedEvent<RuntimeState>();
  private state: RuntimeState;
  private readonly identity: RotatingNodeIdentity;
  private readonly sequence = new SequenceCounter();
  private readonly density = new DensityEstimator();
  private readonly router: MeshRouter;
  private readonly broadcastServer: BroadcastServer;
  private readonly uploader: TelemetryUploader;
  private readonly subscriptions: Unsubscribe[] = [];
  private tick?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setInterval>;
  private starting?: Promise<void>;
  private lifecycle = 0;
  private tickInProgress = false;
  private lastStateAt = 0;
  private lastHeartbeatAt = 0;
  private destinationBeforeReroute?: string;

  constructor(
    private readonly graph: VenueGraph,
    private readonly transports: TransportManager,
    private readonly location: LocationEngine,
    private readonly settings: SettingsStore,
    randomBytes: RandomBytes,
  ) {
    this.identity = new RotatingNodeIdentity(randomBytes);
    this.router = new MeshRouter(transports);
    this.broadcastServer = new BroadcastServer(this.router);
    this.uploader = new TelemetryUploader(settings);
    this.state = {
      ...initialRuntimeState,
      nodeId: this.identity.current(), backendUrl: settings.backendUrl,
      gatewayEnabled: settings.gatewayEnabled,
    };
  }

  snapshot(): RuntimeState { return { ...this.state, peers: [...this.state.peers], route: [...this.state.route] }; }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.state.running) return Promise.resolve();
    const lifecycle = ++this.lifecycle;
    this.update({ running: true, connectivity: 'starting', lastError: undefined });
    const operation = this.startInternal(lifecycle).finally(() => {
      if (this.starting === operation) this.starting = undefined;
    });
    this.starting = operation;
    return operation;
  }

  async stop(): Promise<void> {
    this.lifecycle += 1;
    this.update({ running: false });
    if (this.tick) clearInterval(this.tick); if (this.expiry) clearInterval(this.expiry);
    this.tick = undefined; this.expiry = undefined;
    this.broadcastServer.stop(); this.uploader.stop(); this.router.stop(); this.location.stop();
    await this.transports.stop();
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.update({ connectivity: 'stopped', activeTransport: 'Stopped', peers: [], transportStatuses: [] });
  }

  private async startInternal(lifecycle: number): Promise<void> {
    this.bindEvents();
    this.router.start(); this.uploader.start();
    if (this.settings.gatewayEnabled) {
      try { this.broadcastServer.start(); }
      catch (error) { this.update({ lastError: String(error) }); }
    }

    let locationReady = true;
    try { await this.location.prepare(); }
    catch (error) {
      locationReady = false;
      if (lifecycle === this.lifecycle) this.update({ lastError: String(error) });
    }
    if (lifecycle !== this.lifecycle || !this.state.running) return;

    const results = await Promise.allSettled([
      this.transports.start(this.identity.current()),
      locationReady ? this.location.start() : Promise.resolve(),
    ]);
    if (lifecycle !== this.lifecycle || !this.state.running) return;
    results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .forEach((result) => this.update({ lastError: String(result.reason) }));
    this.tick = setInterval(() => void this.onTick(), 1_000);
    this.expiry = setInterval(() => this.expireGuidance(), 1_000);
    this.setDestination(this.state.destination);
  }

  setDestination(destination: string): void {
    const current = this.location.current()?.zoneId ?? 'gate_a';
    const guidance = this.normalGuidance(current, destination);
    this.destinationBeforeReroute = undefined;
    this.update({ destination, ...guidance });
  }

  async setBackendUrl(url: string): Promise<void> {
    await this.settings.setBackendUrl(url); this.update({ backendUrl: this.settings.backendUrl });
  }

  async setGatewayEnabled(enabled: boolean): Promise<void> {
    await this.settings.setGatewayEnabled(enabled);
    if (this.state.running) {
      try { if (enabled) this.broadcastServer.start(); else this.broadcastServer.stop(); }
      catch (error) { this.update({ lastError: String(error) }); }
    }
    this.update({ gatewayEnabled: enabled });
  }

  injectPosition(x: number, y: number): void { this.location.inject({ x, y }); }
  injectReroute(command: RerouteCommand): boolean { return this.handleReroute(command); }

  private bindEvents(): void {
    if (this.subscriptions.length > 0) return;
    this.subscriptions.push(this.transports.statusesChanged.subscribe((statuses) =>
      this.update({ transportStatuses: statuses, activeTransport: this.transports.activeName })));
    this.subscriptions.push(this.transports.peersChanged.subscribe((peers) =>
      this.update({ peers, localDensity: this.density.estimate(peers) })));
    this.subscriptions.push(this.location.changed.subscribe((position) => this.update({
      position: position.point, positionAccuracy: position.accuracy, currentZone: position.zoneId,
      ...this.guidanceFor(position.zoneId),
    })));
    this.subscriptions.push(this.router.statsChanged.subscribe((meshStats) => this.update({ meshStats })));
    this.subscriptions.push(this.router.messages.subscribe((message) => this.handleMessage(message)));
    this.subscriptions.push(this.uploader.statsChanged.subscribe((uploadStats) => this.update({ uploadStats })));
    this.subscriptions.push(this.uploader.connectivityChanged.subscribe((connectivity) =>
      this.update({ connectivity })));
  }

  private async onTick(): Promise<void> {
    if (this.tickInProgress || !this.state.running) return;
    this.tickInProgress = true;
    const lifecycle = this.lifecycle;
    try {
      const now = epochSeconds(); const nodeId = this.identity.current(now);
      if (nodeId !== this.state.nodeId) { this.update({ nodeId }); await this.transports.updateNodeId(nodeId); }
      if (lifecycle !== this.lifecycle || !this.state.running) return;
      const position = this.location.current();
      if (position) {
        const localDensity = this.density.estimate(this.transports.peers());
        const telemetry: NodeTelemetry = {
          node_id: nodeId, timestamp: now, position: position.point, position_accuracy: position.accuracy,
          velocity: position.velocity, direction: position.direction, zone: position.zoneId,
          local_density: localDensity, confidence: position.confidence, source: 'phone',
        };
        this.uploader.offer(telemetry); this.update({ localDensity });
        if (now - this.lastStateAt >= 2) {
          this.lastStateAt = now;
          await this.safeOriginate({
            type: 'STATE_UPDATE', source: nodeId, sequence: this.sequence.next(), ttl: 4, timestamp: now,
            payload: encodeStateUpdate({ zoneIndex: this.graph.indexOf(position.zoneId), density: localDensity,
              velocity: position.velocity, direction: position.direction, confidence: position.confidence }),
          });
        }
      }
      if (lifecycle !== this.lifecycle || !this.state.running) return;
      if (now - this.lastHeartbeatAt >= 10) {
        this.lastHeartbeatAt = now;
        await this.safeOriginate({ type: 'HEARTBEAT', source: nodeId, sequence: this.sequence.next(), ttl: 4, timestamp: now, payload: new Uint8Array() });
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  private handleMessage(message: MeshMessage): void {
    if (message.type === 'STATE_UPDATE') this.handleRemoteState(message);
    if (message.type === 'REROUTE') {
      try { this.handleReroute(decodeReroute(message.payload, message.timestamp, this.graph)); }
      catch { /* malformed count already appears in router diagnostics */ }
    }
  }

  private handleRemoteState(message: MeshMessage): void {
    let state: StateUpdate;
    try { state = decodeStateUpdate(message.payload); } catch { return; }
    let zone;
    try { zone = this.graph.zoneAtIndex(state.zoneIndex); } catch { return; }
    if (this.settings.gatewayEnabled) {
      this.uploader.offer({
        node_id: message.source, timestamp: message.timestamp, position: zone.centroid,
        position_accuracy: 10, velocity: state.velocity, direction: state.direction, zone: zone.id,
        local_density: state.density, confidence: state.confidence, source: 'mesh_relay',
      });
    }
  }

  private handleReroute(command: RerouteCommand): boolean {
    const now = epochSeconds();
    if (now < command.issued_at || now >= command.expires_at || !shouldComply(this.state.nodeId, command)) return false;
    const current = this.location.current()?.zoneId ?? this.state.currentZone; if (!current) return false;
    const route = this.graph.shortestPath(current, command.destination_zone, new Set(command.avoid), new Set(command.preferred));
    if (route.length === 0) return false;
    if (!this.state.guidance?.command) this.destinationBeforeReroute = this.state.destination;
    this.update({ destination: command.destination_zone, ...this.rerouteGuidance(command, route) });
    return true;
  }

  private expireGuidance(): void {
    const command = this.state.guidance?.command;
    if (!command || epochSeconds() < command.expires_at) return;
    const current = this.location.current()?.zoneId ?? this.state.currentZone ?? 'gate_a';
    this.update(this.guidanceFor(current));
  }

  private guidanceFor(current: string): Partial<RuntimeState> {
    const command = this.state.guidance?.command;
    if (command && epochSeconds() < command.expires_at) {
      const route = this.graph.shortestPath(current, command.destination_zone, new Set(command.avoid), new Set(command.preferred));
      return route.length > 0 ? this.rerouteGuidance(command, route) : {};
    }
    if (command) {
      const destination = this.destinationBeforeReroute ?? this.state.destination;
      this.destinationBeforeReroute = undefined;
      return { destination, ...this.normalGuidance(current, destination, 'Route restored') };
    }
    return this.normalGuidance(current, this.state.destination);
  }

  private normalGuidance(current: string, destination: string, headline?: string): Pick<RuntimeState, 'route' | 'guidance'> {
    const route = this.graph.shortestPath(current, destination);
    const next = route[1] ? this.graph.zone(route[1]).label : this.graph.zone(destination).label;
    return {
      route,
      guidance: { route, headline: headline ?? `Recommended route: ${next}`, detail: this.estimateTime(route) },
    };
  }

  private rerouteGuidance(command: RerouteCommand, route: string[]): Pick<RuntimeState, 'route' | 'guidance'> {
    const next = route[1] ? this.graph.zone(route[1]).label : this.graph.zone(command.destination_zone).label;
    return {
      route,
      guidance: { route, headline: 'Crowd building ahead', detail: `Take ${next} instead · ${this.estimateTime(route)}`, command },
    };
  }

  private estimateTime(route: string[]): string {
    const seconds = route.slice(0, -1).reduce((sum, from, index) => {
      const to = route[index + 1];
      const edge = this.graph.edges.find((item) => (item.from === from && item.to === to) || (item.bidirectional && item.from === to && item.to === from));
      return sum + (edge ? edge.lengthMetres / edge.freeFlowSpeed : 0);
    }, 0);
    return route.length < 2 ? 'You are here' : `~${Math.max(1, Math.round(seconds / 60))} min`;
  }

  private async safeOriginate(message: MeshMessage): Promise<void> {
    try { await this.router.originate(message); }
    catch (error) { if (this.state.running) this.update({ lastError: String(error) }); }
  }

  private update(update: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...update }; this.changed.emit(this.snapshot());
  }
}
