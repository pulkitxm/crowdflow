import type { PeerInfo } from '../core/contracts';

export class DensityEstimator {
  constructor(
    private readonly participationRate = .20,
    private readonly sensingRadiusMetres = 10,
    private readonly minimumRssi = -82,
  ) {}

  estimate(peers: PeerInfo[], now = Date.now()): number {
    const nearby = peers.filter((peer) =>
      now - peer.lastSeen <= 15_000 &&
      (peer.distanceMetres !== undefined ? peer.distanceMetres <= this.sensingRadiusMetres :
        peer.rssi !== undefined ? peer.rssi >= this.minimumRssi : true),
    ).length;
    const population = (nearby + 1) / Math.max(.05, this.participationRate);
    return Math.min(12.75, population / (Math.PI * this.sensingRadiusMetres ** 2));
  }
}
