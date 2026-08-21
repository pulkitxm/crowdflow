export interface PeerObservation {
  node_id: string;
  epoch: number;
  rssi_dbm: number | null;
  last_seen_ms: number;
}

export interface PeerLifecycleConfig {
  admission_observations: number;
  join_rssi_dbm: number;
  leave_rssi_dbm: number;
  lost_after_ms: number;
  max_peers: number;
}

export const DEFAULT_PEER_LIFECYCLE: PeerLifecycleConfig = {
  admission_observations: 2,
  join_rssi_dbm: -82,
  leave_rssi_dbm: -90,
  lost_after_ms: 12_000,
  max_peers: 8,
};

export interface TopologyChange {
  connect: string[];
  disconnect: string[];
  connected: string[];
}

interface Candidate extends PeerObservation {
  observations: number;
}

/**
 * Converts noisy discovery snapshots into a stable, bounded set of direct links.
 * The wider leave threshold is intentional hysteresis: one weak scan must not
 * cause every phone in a moving crowd to renegotiate at once.
 */
export class PeerLifecycle {
  private readonly candidates = new Map<string, Candidate>();
  private connected = new Set<string>();

  constructor(private readonly config: PeerLifecycleConfig = DEFAULT_PEER_LIFECYCLE) {
    if (config.admission_observations < 1 || config.max_peers < 1 || config.lost_after_ms <= 0) {
      throw new Error('peer lifecycle limits must be positive');
    }
    if (config.leave_rssi_dbm > config.join_rssi_dbm) {
      throw new Error('leave RSSI must be weaker than or equal to join RSSI');
    }
  }

  update(observations: PeerObservation[], nowMs: number): TopologyChange {
    const observed = new Set<string>();
    const forcedDisconnect = new Set<string>();
    for (const peer of observations) {
      if (!peer.node_id || peer.last_seen_ms > nowMs) continue;
      observed.add(peer.node_id);
      const previous = this.candidates.get(peer.node_id);
      const sameEpoch = previous?.epoch === peer.epoch;
      const freshObservation = sameEpoch && peer.last_seen_ms > previous.last_seen_ms;
      this.candidates.set(peer.node_id, {
        ...peer,
        observations: freshObservation ? previous.observations + 1 : sameEpoch ? previous.observations : 1,
      });
      if (!sameEpoch && this.connected.delete(peer.node_id)) forcedDisconnect.add(peer.node_id);
    }

    for (const [nodeId, peer] of this.candidates) {
      if (nowMs - peer.last_seen_ms > this.config.lost_after_ms) {
        this.candidates.delete(nodeId);
      } else if (!observed.has(nodeId)) {
        // Keep the last observation until the loss timeout. Discovery APIs often
        // omit a reachable peer for one scan while radios are negotiating.
      }
    }

    const eligible = [...this.candidates.values()].filter((peer) => {
      const threshold = this.connected.has(peer.node_id) ? this.config.leave_rssi_dbm : this.config.join_rssi_dbm;
      const signalOkay = peer.rssi_dbm == null || peer.rssi_dbm >= threshold;
      return (
        signalOkay && (this.connected.has(peer.node_id) || peer.observations >= this.config.admission_observations)
      );
    });
    eligible.sort(
      (a, b) =>
        Number(this.connected.has(b.node_id)) - Number(this.connected.has(a.node_id)) ||
        (b.rssi_dbm ?? -Infinity) - (a.rssi_dbm ?? -Infinity) ||
        b.last_seen_ms - a.last_seen_ms ||
        a.node_id.localeCompare(b.node_id),
    );

    const next = new Set(eligible.slice(0, this.config.max_peers).map((peer) => peer.node_id));
    const connect = [...next].filter((nodeId) => !this.connected.has(nodeId)).sort();
    const disconnect = [
      ...new Set([...forcedDisconnect, ...[...this.connected].filter((nodeId) => !next.has(nodeId))]),
    ].sort();
    this.connected = next;
    return { connect, disconnect, connected: [...next].sort() };
  }

  reset(): TopologyChange {
    const disconnect = [...this.connected].sort();
    this.connected.clear();
    this.candidates.clear();
    return { connect: [], disconnect, connected: [] };
  }
}
