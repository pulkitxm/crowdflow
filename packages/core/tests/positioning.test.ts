import { describe, expect, it } from 'vitest';
import {
  ASSUMED_BLE_RSSI_AT_1M_DBM,
  ASSUMED_WIFI_RSSI_AT_1M_DBM,
  validateCrowdNode,
  type AnchorPack,
  type CircuitPack,
  type CoordinateFrame,
  type PositionFix,
  type Position,
  type RadioAnchor,
  type RadioObservation,
} from '@crowdflow/contracts';
import {
  AnchorMap,
  NodeIdentity,
  PositionFuser,
  anchorIdFor,
  bearingOf,
  crowdNodeFrom,
  curveFor,
  distanceFromRssi,
  headingToVenue,
  insideVenue,
  metresPerDegreeLat,
  rangeSigmaM,
  rssiFromDistance,
  toGeo,
  toVenue,
  trilaterate,
  weightedCentroid,
  Random,
} from '../src/index.js';

const measured = (value: number) => ({ value, provenance: 'measured' as const, samples: 64 });
const assumed = (value: number) => ({ value, provenance: 'assumed' as const });

const FRAME: CoordinateFrame = {
  origin_lat: 52.063513,
  origin_lon: -1.024286,
  rotation_deg: 0,
  track_bounds_m: [1028, 1714],
  venue_bounds_m: [-200, -200, 200, 200],
};

function anchor(id: string, x: number, y: number, kind: RadioAnchor['kind'] = 'wifi_ap'): RadioAnchor {
  return {
    anchor_id: id,
    kind,
    position: { x, y },
    rssi_at_1m_dbm: measured(kind === 'ble_beacon' ? ASSUMED_BLE_RSSI_AT_1M_DBM : ASSUMED_WIFI_RSSI_AT_1M_DBM),
    path_loss_exponent: measured(2.2),
  };
}

/** The forward model, used to manufacture a scan from a known position. Tests
 *  that solve a position out of RSSI must put it in through the same law, or
 *  they are testing two implementations of path loss against each other. */
function scanFrom(truth: Position, anchors: RadioAnchor[], at: number, noise?: { rng: Random; sigmaDb: number }): RadioObservation[] {
  return anchors.map((a) => ({
    anchor_id: a.anchor_id,
    kind: a.kind,
    rssi_dbm: rssiFromDistance(Math.hypot(truth.x - a.position.x, truth.y - a.position.y), curveFor(a))
      + (noise ? noise.rng.gauss(0, noise.sigmaDb) : 0),
    timestamp: at,
  }));
}

describe('venue frame', () => {
  it('projects a geographic point and brings it back unchanged', () => {
    const point = { lat: 52.07, lon: -1.02 };
    const back = toGeo(FRAME, toVenue(FRAME, point));
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lon).toBeCloseTo(point.lon, 9);
  });

  it('puts the origin at the origin', () => {
    const position = toVenue(FRAME, { lat: FRAME.origin_lat, lon: FRAME.origin_lon });
    expect(position.x).toBeCloseTo(0, 9);
    expect(position.y).toBeCloseTo(0, 9);
  });

  it('measures a thousandth of a degree of latitude as about 111 metres', () => {
    const position = toVenue(FRAME, { lat: FRAME.origin_lat + 0.001, lon: FRAME.origin_lon });
    expect(position.y).toBeCloseTo(metresPerDegreeLat(FRAME.origin_lat) / 1000, 6);
    expect(position.y).toBeGreaterThan(111.0);
    expect(position.y).toBeLessThan(111.4);
  });

  it('shortens a degree of longitude at higher latitude', () => {
    // The flattening the WGS84 series exists to capture: a degree of latitude
    // is longer near the pole than at the equator.
    expect(metresPerDegreeLat(60)).toBeGreaterThan(metresPerDegreeLat(0));
  });

  it('rotates a frame whose y axis is not north', () => {
    // +y bearing 90 means venue north points true east, so a point due true
    // north of the origin sits on the venue frame's -x axis.
    const rotated: CoordinateFrame = { ...FRAME, rotation_deg: 90 };
    const position = toVenue(rotated, { lat: FRAME.origin_lat + 0.001, lon: FRAME.origin_lon });
    expect(position.y).toBeCloseTo(0, 6);
    expect(position.x).toBeLessThan(-110);
  });

  it('reads a platform heading in the frame the positions use', () => {
    expect(headingToVenue(FRAME, 90)).toBeCloseTo(90);
    expect(headingToVenue({ ...FRAME, rotation_deg: 30 }, 20)).toBeCloseTo(350);
  });

  it('holds the venue boundary, with slack for a fix that breathes', () => {
    expect(insideVenue(FRAME, { x: 0, y: 0 })).toBe(true);
    expect(insideVenue(FRAME, { x: 240, y: 0 })).toBe(false);
    expect(insideVenue(FRAME, { x: 240, y: 0 }, 50)).toBe(true);
  });
});

describe('path loss', () => {
  it('inverts its own forward model', () => {
    const curve = { rssi_at_1m_dbm: -40, path_loss_exponent: 2.2 };
    for (const distance of [1, 5, 20, 75]) {
      expect(distanceFromRssi(rssiFromDistance(distance, curve), curve)).toBeCloseTo(distance, 6);
    }
  });

  it('reads a stronger signal as nearer', () => {
    const curve = { rssi_at_1m_dbm: -40, path_loss_exponent: 2.2 };
    expect(distanceFromRssi(-50, curve)).toBeLessThan(distanceFromRssi(-70, curve));
  });

  it('grows the range error in proportion to the range', () => {
    const curve = { rssi_at_1m_dbm: -40, path_loss_exponent: 2.2 };
    const near = rangeSigmaM(5, curve);
    const far = rangeSigmaM(50, curve);
    // Proportional, not additive: ten times the distance is ten times the error.
    expect(far / near).toBeCloseTo(10, 1);
  });

  it('charges an assumed curve more uncertainty than a measured one', () => {
    const guessed = { ...anchor('a', 0, 0), rssi_at_1m_dbm: assumed(-40), path_loss_exponent: assumed(2.2) };
    const walked = anchor('b', 0, 0);
    const observation = (id: string): RadioObservation => ({ anchor_id: id, kind: 'wifi_ap', rssi_dbm: -60, timestamp: 0 });
    const map = new AnchorMap({ circuit_id: 't', anchors: { a: guessed, b: walked } });
    const ranges = map.resolve([observation('a'), observation('b')], 0).ranges;
    const a = ranges.find((r) => r.anchor_id === 'a')!;
    const b = ranges.find((r) => r.anchor_id === 'b')!;
    expect(a.distance_m).toBeCloseTo(b.distance_m, 6);
    expect(a.sigma_m).toBeGreaterThan(b.sigma_m);
  });

  it('separates a BLE beacon curve from a Wi-Fi one', () => {
    const beacon = curveFor(anchor('b', 0, 0, 'ble_beacon'));
    const ap = curveFor(anchor('a', 0, 0, 'wifi_ap'));
    expect(beacon.rssi_at_1m_dbm).toBeLessThan(ap.rssi_at_1m_dbm);
  });
});

describe('trilateration', () => {
  const anchors = [anchor('n', 0, 60), anchor('e', 60, 0), anchor('s', 0, -60), anchor('w', -60, 0)];

  it('recovers a position from a noiseless scan', () => {
    const truth = { x: 12, y: -7 };
    const map = new AnchorMap({ circuit_id: 't', anchors: Object.fromEntries(anchors.map((a) => [a.anchor_id, a])) });
    const { ranges } = map.resolve(scanFrom(truth, anchors, 100), 100);
    const solution = trilaterate(ranges);
    expect(solution.trilaterated).toBe(true);
    expect(solution.position.x).toBeCloseTo(truth.x, 2);
    expect(solution.position.y).toBeCloseTo(truth.y, 2);
    expect(solution.residual_m).toBeLessThan(0.01);
  });

  it('stays inside its own error bar under realistic shadowing', () => {
    const rng = new Random(42);
    const map = new AnchorMap({ circuit_id: 't', anchors: Object.fromEntries(anchors.map((a) => [a.anchor_id, a])) });
    let inside = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const truth = { x: rng.uniform(-30, 30), y: rng.uniform(-30, 30) };
      const { ranges } = map.resolve(scanFrom(truth, anchors, 100, { rng, sigmaDb: 6 }), 100);
      const solution = trilaterate(ranges);
      const error = Math.hypot(solution.position.x - truth.x, solution.position.y - truth.y);
      if (error <= 3 * solution.accuracy_m) inside += 1;
    }
    // A one-sigma claim checked at three sigma. The point is not the exact
    // coverage but that accuracy_m is a bound the solver actually respects
    // rather than a decorative number.
    expect(inside / trials).toBeGreaterThan(0.9);
  });

  it('reports a large residual when an anchor has moved since the survey', () => {
    const truth = { x: 10, y: 10 };
    const stale = [...anchors.slice(0, 3), anchor('w', -60, 250)];
    const observed = scanFrom(truth, anchors, 100);
    const map = new AnchorMap({ circuit_id: 't', anchors: Object.fromEntries(stale.map((a) => [a.anchor_id, a])) });
    const { ranges } = map.resolve(observed, 100);
    const solution = trilaterate(ranges);
    // The signature of a wrong map, not a confused phone: the geometry still
    // closes on something, and the residual is what will not reconcile.
    expect(solution.residual_m).toBeGreaterThan(10);
  });

  it('refuses to trilaterate colinear anchors', () => {
    const line = [anchor('a', -50, 0), anchor('b', 0, 0), anchor('c', 50, 0)];
    const map = new AnchorMap({ circuit_id: 't', anchors: Object.fromEntries(line.map((a) => [a.anchor_id, a])) });
    const { ranges } = map.resolve(scanFrom({ x: 0, y: 0 }, line, 100), 100);
    const solution = trilaterate(ranges);
    expect(solution.trilaterated).toBe(false);
  });

  it('calls a two-anchor answer a centroid, not a fix', () => {
    const pair = anchors.slice(0, 2);
    const map = new AnchorMap({ circuit_id: 't', anchors: Object.fromEntries(pair.map((a) => [a.anchor_id, a])) });
    const { ranges } = map.resolve(scanFrom({ x: 5, y: 5 }, pair, 100), 100);
    const solution = trilaterate(ranges);
    expect(solution.trilaterated).toBe(false);
    expect(solution.anchors_used).toBe(2);
    expect(solution.accuracy_m).toBeGreaterThan(10);
  });

  it('leans a centroid toward the nearer anchor', () => {
    const map = new AnchorMap({ circuit_id: 't', anchors: { a: anchor('a', 0, 0), b: anchor('b', 100, 0) } });
    const { ranges } = map.resolve([
      { anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -45, timestamp: 0 },
      { anchor_id: 'b', kind: 'wifi_ap', rssi_dbm: -85, timestamp: 0 },
    ], 0);
    expect(weightedCentroid(ranges).x).toBeLessThan(25);
  });
});

describe('anchor map', () => {
  const pack: AnchorPack = {
    circuit_id: 't',
    surveyed_at: '2026-07-01T09:00:00Z',
    anchors: { a: anchor('a', 0, 0), b: anchor('b', 30, 0), z: anchor('z', 0, 30, 'ble_beacon') },
  };

  it('hashes a hardware identifier stably and ignores its formatting', () => {
    expect(anchorIdFor('wifi_ap', 'AA:BB:CC:DD:EE:FF')).toBe(anchorIdFor('wifi_ap', 'aa-bb-cc-dd-ee-ff'));
    expect(anchorIdFor('wifi_ap', 'AA:BB:CC:DD:EE:FF')).not.toBe(anchorIdFor('ble_beacon', 'AA:BB:CC:DD:EE:FF'));
    expect(anchorIdFor('wifi_ap', 'AA:BB:CC:DD:EE:FF')).toHaveLength(16);
    expect(anchorIdFor('wifi_ap', 'AA:BB:CC:DD:EE:FF')).not.toContain('AA');
  });

  it('counts what it heard but does not recognise', () => {
    const map = new AnchorMap(pack);
    const resolved = map.resolve([
      { anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -55, timestamp: 100 },
      { anchor_id: 'unsurveyed-1', kind: 'wifi_ap', rssi_dbm: -60, timestamp: 100 },
      { anchor_id: 'unsurveyed-2', kind: 'wifi_ap', rssi_dbm: -70, timestamp: 100 },
    ], 100);
    expect(resolved.matched).toBe(1);
    expect(resolved.unmatched).toBe(2);
  });

  it('drops an observation older than the window', () => {
    const map = new AnchorMap(pack);
    const resolved = map.resolve([{ anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -55, timestamp: 0 }], 100);
    expect(resolved.stale).toBe(1);
    expect(resolved.matched).toBe(0);
  });

  it('collapses a dual-band access point to its strongest radio', () => {
    const map = new AnchorMap(pack);
    const resolved = map.resolve([
      { anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -75, timestamp: 100, frequency_mhz: 5180 },
      { anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -55, timestamp: 100, frequency_mhz: 2437 },
    ], 100);
    expect(resolved.matched).toBe(1);
    expect(resolved.ranges[0]!.rssi_dbm).toBe(-55);
  });

  it('resolves one radio at a time when asked', () => {
    const map = new AnchorMap(pack);
    const observations: RadioObservation[] = [
      { anchor_id: 'a', kind: 'wifi_ap', rssi_dbm: -55, timestamp: 100 },
      { anchor_id: 'z', kind: 'ble_beacon', rssi_dbm: -65, timestamp: 100 },
    ];
    expect(map.resolve(observations, 100, ['wifi_ap']).matched).toBe(1);
    expect(map.resolve(observations, 100, ['ble_beacon']).matched).toBe(1);
    expect(map.resolve(observations, 100).matched).toBe(2);
    expect(map.countOf('ble_beacon')).toBe(1);
    expect(map.countOf('wifi_ap')).toBe(2);
  });
});

describe('fusion ladder', () => {
  const fix = (over: Partial<PositionFix> & Pick<PositionFix, 'source' | 'timestamp'>): PositionFix => ({
    position: { x: 0, y: 0 }, accuracy_m: 10, anchors_used: 0, residual_m: null, speed_ms: null, heading_deg: null, ...over,
  });

  it('prefers the tighter of two live sources', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'gnss', timestamp: 100, accuracy_m: 25 }));
    fuser.offer(fix({ source: 'wifi', timestamp: 100, accuracy_m: 8, anchors_used: 4 }));
    expect(fuser.resolve(100).fix?.source).toBe('wifi');
  });

  it('does not hand the lead to a source that is only marginally better', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'wifi', timestamp: 100, accuracy_m: 10, anchors_used: 4 }));
    expect(fuser.resolve(100).fix?.source).toBe('wifi');
    // Ten per cent better is inside the noise on an accuracy estimate. Switching
    // on it makes the dot flicker between two answers that are both fine.
    fuser.offer(fix({ source: 'ble', timestamp: 110, accuracy_m: 9, anchors_used: 3 }));
    fuser.offer(fix({ source: 'wifi', timestamp: 110, accuracy_m: 10, anchors_used: 4 }));
    expect(fuser.resolve(110).fix?.source).toBe('wifi');
  });

  it('hands the lead over when the challenger is decisively better', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'gnss', timestamp: 100, accuracy_m: 30 }));
    expect(fuser.resolve(100).fix?.source).toBe('gnss');
    fuser.offer(fix({ source: 'ble', timestamp: 110, accuracy_m: 6, anchors_used: 4 }));
    fuser.offer(fix({ source: 'gnss', timestamp: 110, accuracy_m: 30 }));
    expect(fuser.resolve(110).fix?.source).toBe('ble');
  });

  it('rejects a fix too wide to place in a zone', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'gnss', timestamp: 100, accuracy_m: 400 }));
    const result = fuser.resolve(100);
    expect(result.fix).toBeNull();
    expect(result.rejected).toContainEqual({ source: 'gnss', reason: 'too_wide' });
  });

  it('stops when the position leaves the circuit', () => {
    const fuser = new PositionFuser(FRAME, { venue_margin_m: 10 });
    fuser.offer(fix({ source: 'gnss', timestamp: 100, position: { x: 5000, y: 5000 }, accuracy_m: 12 }));
    const result = fuser.resolve(100);
    expect(result.fix).toBeNull();
    expect(result.rejected).toContainEqual({ source: 'gnss', reason: 'outside_venue' });
  });

  it('refuses a reading that teleports a walking person', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'wifi', timestamp: 100, position: { x: 0, y: 0 }, accuracy_m: 5, anchors_used: 4 }));
    fuser.resolve(100);
    fuser.offer(fix({ source: 'wifi', timestamp: 101, position: { x: 180, y: 0 }, accuracy_m: 5, anchors_used: 4 }));
    const result = fuser.resolve(101);
    expect(result.rejected).toContainEqual({ source: 'wifi', reason: 'implausible_jump' });
  });

  it('derives speed and heading from successive fixes', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'gnss', timestamp: 100, position: { x: 0, y: 0 }, accuracy_m: 10 }));
    fuser.resolve(100);
    fuser.offer(fix({ source: 'gnss', timestamp: 110, position: { x: 0, y: 13.4 }, accuracy_m: 10 }));
    const moved = fuser.resolve(110).fix!;
    expect(moved.speed_ms).toBeGreaterThan(1);
    // Walking along +y is walking toward venue north.
    expect(moved.heading_deg).toBeCloseTo(0, 3);
  });

  it('reports no heading for a phone standing still', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'gnss', timestamp: 100, position: { x: 0, y: 0 }, accuracy_m: 10 }));
    fuser.resolve(100);
    fuser.offer(fix({ source: 'gnss', timestamp: 130, position: { x: 0.2, y: 0 }, accuracy_m: 10 }));
    const still = fuser.resolve(130).fix!;
    expect(still.speed_ms).toBe(0);
    expect(still.heading_deg).toBeNull();
  });

  it('carries a moving node across a scan gap, then stops', () => {
    const fuser = new PositionFuser(FRAME, { dead_reckoning_max_s: 15 });
    fuser.offer(fix({ source: 'wifi', timestamp: 100, position: { x: 0, y: 0 }, accuracy_m: 8, anchors_used: 4 }));
    fuser.resolve(100);
    fuser.offer(fix({ source: 'wifi', timestamp: 110, position: { x: 0, y: 13 }, accuracy_m: 8, anchors_used: 4 }));
    fuser.resolve(110);

    const carried = fuser.resolve(120).fix!;
    expect(carried.source).toBe('dead_reckoning');
    expect(carried.position.y).toBeGreaterThan(13);
    // Extrapolation is wrong by however far it guessed, and says so.
    expect(carried.accuracy_m).toBeGreaterThan(8);

    expect(fuser.resolve(140).fix).toBeNull();
  });

  it('forgets everything on reset, so an epoch cannot be joined to the last one', () => {
    const fuser = new PositionFuser(FRAME);
    fuser.offer(fix({ source: 'wifi', timestamp: 100, position: { x: 0, y: 0 }, accuracy_m: 8, anchors_used: 4 }));
    fuser.resolve(100);
    fuser.reset();
    expect(fuser.last).toBeNull();
    expect(fuser.resolve(105).fix).toBeNull();
  });

  it('measures a bearing clockwise from venue north', () => {
    expect(bearingOf(0, 1)).toBeCloseTo(0);
    expect(bearingOf(1, 0)).toBeCloseTo(90);
    expect(bearingOf(0, -1)).toBeCloseTo(180);
    expect(bearingOf(-1, 0)).toBeCloseTo(270);
  });
});

describe('reporting', () => {
  const pack: CircuitPack = {
    id: 't', name: 'Toy', geometry_source: 'synthetic', track_length_m: 100, altitude_m: 0,
    frame: FRAME,
    zones: { a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } } },
    edges: {},
  };

  it('rotates the pseudonym on the clock, not on first use', () => {
    const rotation = 900;
    const identity = new NodeIdentity(1_000_000, rotation);
    const first = identity.nodeId;
    expect(identity.refresh(1_000_010)).toBe(false);
    expect(identity.nodeId).toBe(first);
    // The boundary is derived from the clock so every handset crosses it at the
    // same instant; a staggered rotation is linkable by when the old id fell
    // silent.
    const boundary = (Math.floor(1_000_000 / rotation) + 1) * rotation;
    expect(identity.expiresIn(1_000_000)).toBeCloseTo(boundary - 1_000_000);
    expect(identity.refresh(boundary)).toBe(true);
    expect(identity.nodeId).not.toBe(first);
    expect(identity.epoch).toBe(Math.floor(boundary / rotation));
  });

  it('shapes a fix into a node the contract validator accepts', () => {
    const identity = new NodeIdentity(1000, 900, (bytes) => 'ab'.repeat(bytes));
    const node = crowdNodeFrom({
      position: { x: 12.34567, y: -7.65432 }, accuracy_m: 9.87654, source: 'wifi',
      timestamp: 1000.7, anchors_used: 4, residual_m: 1.2, speed_ms: 1.234, heading_deg: 371.2,
    }, identity, pack)!;
    expect(() => validateCrowdNode(node)).not.toThrow();
    // Decimetres: everything past the first decimal of a metre is noise that
    // would be stored and eventually joined against something.
    expect(node.position.x).toBe(12.3);
    expect(node.position.y).toBe(-7.7);
    expect(node.heading_deg).toBeCloseTo(11.2);
    expect(node.zone_id).toBeUndefined();
  });

  it('refuses to report a position outside the venue', () => {
    const identity = new NodeIdentity(1000, 900, (bytes) => 'cd'.repeat(bytes));
    const outside = crowdNodeFrom({
      position: { x: 9000, y: 9000 }, accuracy_m: 8, source: 'gnss',
      timestamp: 1000, anchors_used: 0,
    }, identity, pack);
    expect(outside).toBeNull();
  });
});
