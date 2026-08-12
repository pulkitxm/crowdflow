import type { Guidance, MeshMessage, NodeTelemetry, RerouteCommand, StateUpdate } from '../core/contracts';
import { TypedEvent, type Unsubscribe } from '../core/events';
import { epochSeconds, RotatingNodeIdentity, SequenceCounter, shouldComply, type RandomBytes } from '../core/identity';
import type { LocationEngine } from '../location/locationEngine';
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
  private readonly uploader: TelemetryUploader;
  private readonly subscriptions: Unsubscribe[] = [];
  private tick?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setInterval>;
  private lastStateAt = 0;
  private lastHeartbeatAt = 0;
  private guidanceBeforeReroute?: Guidance;

  constructor(
    private readonly graph: VenueGraph,
    private readonly transports: TransportManager,
    private readonly location: LocationEngine,
    private readonly settings: SettingsStore,
    randomBytes: RandomBytes,
  ) {
    this.identity = new RotatingNodeIdentity(randomBytes);
    this.router = new MeshRouter(transports);
    this.uploader = new TelemetryUploader(settings);
    this.state = {
      ...initialRuntimeState,
      nodeId: this.identity.current(), backendUrl: settings.backendUrl,
      gatewayEnabled: settings.gatewayEnabled,
    };
  }

  snapshot(): RuntimeState { return { ...this.state, peers: [...this.state.peers], route: [...this.state.route] }; }

  async start(): Promise<void> {
    if (this.state.running) return;
    this.update({ running: true, connectivity: 'starting', lastError: undefined });
    this.bindEvents();
    this.router.start(); this.uploader.start();
    const results = await Promise.allSettled([this.transports.start(this.identity.current()), this.location.start()]);
    results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .forEach((result) => this.update({ lastError: String(result.reason) }));
    this.tick = setInterval(() => void this.onTick(), 1_000);
    this.expiry = setInterval(() => this.expireGuidance(), 1_000);
    this.setDestination(this.state.destination);
  }

  async stop(): Promise<void> {
    if (this.tick) clearInterval(this.tick); if (this.expiry) clearInterval(this.expiry);
    this.tick = undefined; this.expiry = undefined;
    this.uploader.stop(); this.router.stop(); this.location.stop();
    await this.transports.stop();
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.update({ running: false, connectivity: 'stopped', activeTransport: 'Stopped', peers: [], transportStatuses: [] });
  }

  setDestination(destination: string): void {
    const current = this.location.current()?.zoneId ?? 'gate_a';
    const route = this.graph.shortestPath(current, destination);
    const next = route[1] ? this.graph.zone(route[1]).label : this.graph.zone(destination).label;
    this.update({
      destination, route,
      guidance: { route, headline: `Recommended route: ${next}`, detail: this.estimateTime(route) },
    });
  }

  async setBackendUrl(url: string): Promise<void> {
    await this.settings.setBackendUrl(url); this.update({ backendUrl: this.settings.backendUrl });
  }

  async setGatewayEnabled(enabled: boolean): Promise<void> {
    await this.settings.setGatewayEnabled(enabled); this.update({ gatewayEnabled: enabled });
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
    })));
    this.subscriptions.push(this.router.statsChanged.subscribe((meshStats) => this.update({ meshStats })));
    this.subscriptions.push(this.router.messages.subscribe((message) => this.handleMessage(message)));
    this.subscriptions.push(this.uploader.statsChanged.subscribe((uploadStats) => this.update({ uploadStats })));
    this.subscriptions.push(this.uploader.connectivityChanged.subscribe((connectivity) => {
      this.update({ connectivity });
      if (connectivity === 'restored') setTimeout(() => {
        if (this.state.connectivity === 'restored') this.update({ connectivity: 'online' });
      }, 2_000);
    }));
  }

  private async onTick(): Promise<void> {
    const now = epochSeconds(); const nodeId = this.identity.current(now);
    if (nodeId !== this.state.nodeId) { this.update({ nodeId }); await this.transports.updateNodeId(nodeId); }
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
        await this.safeOriginate({
          type: 'STATE_UPDATE', source: nodeId, sequence: this.sequence.next(), ttl: 4, timestamp: now,
          payload: encodeStateUpdate({ zoneIndex: this.graph.indexOf(position.zoneId), density: localDensity,
            velocity: position.velocity, direction: position.direction, confidence: position.confidence }),
        });
        this.lastStateAt = now;
      }
    }
    if (now - this.lastHeartbeatAt >= 10) {
      await this.safeOriginate({ type: 'HEARTBEAT', source: nodeId, sequence: this.sequence.next(), ttl: 4, timestamp: now, payload: new Uint8Array() });
      this.lastHeartbeatAt = now;
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
    this.guidanceBeforeReroute = this.state.guidance;
    const next = route[1] ? this.graph.zone(route[1]).label : this.graph.zone(command.destination_zone).label;
    this.update({
      destination: command.destination_zone, route,
      guidance: { route, headline: 'Crowd building ahead', detail: `Take ${next} instead · ${this.estimateTime(route)}`, command },
    });
    return true;
  }

  private expireGuidance(): void {
    const command = this.state.guidance?.command;
    if (!command || epochSeconds() < command.expires_at) return;
    const current = this.location.current()?.zoneId ?? this.state.currentZone ?? 'gate_a';
    const route = this.graph.shortestPath(current, this.state.destination);
    this.update({ route, guidance: this.guidanceBeforeReroute ?? { route, headline: 'Route restored', detail: this.estimateTime(route) } });
    this.guidanceBeforeReroute = undefined;
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
    catch (error) { this.update({ lastError: String(error) }); }
  }

  private update(update: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...update }; this.changed.emit(this.snapshot());
  }
}
