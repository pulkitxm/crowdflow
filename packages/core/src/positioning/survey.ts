/**
 * Two things a venue needs before radio positioning is anything but a claim:
 * a plan for where the anchors go, and a number for how well it would work.
 *
 * `planAnchors` answers the first. It is a DEPLOYMENT PLAN, not a survey, and
 * the distinction is enforced rather than documented: every anchor it emits
 * carries `provenance: 'assumed'`, which the solver already charges extra
 * uncertainty for and the console already renders as untrustworthy. Nothing in
 * this file can produce a measured anchor, because measuring one means walking
 * to it with a meter.
 *
 * `positioningAccuracy` answers the second, and it is the reason this file is in
 * `core` rather than in a script. Radio positioning either works at a venue or
 * it does not, and the only honest way to find out before a race weekend is to
 * put a known position in, generate the scan physics would produce, solve it
 * blind and measure how far off the answer was. That is a headless, seeded
 * experiment over a real circuit pack — the same kind of thing `sim ab` is for
 * the intervention loop — and it can be run in a second on a laptop instead of
 * a day on foot.
 *
 * The harness is not a substitute for the walk test. It cannot be: it generates
 * its observations from the same log-distance law the solver inverts, so it
 * measures the GEOMETRY of an anchor layout — whether the anchors are spread
 * well enough, at that spacing, to constrain a position — and not whether the
 * law holds at the venue. A layout that fails here will fail on site. A layout
 * that passes here has earned a walk test, nothing more.
 */

import type { AnchorPack, CircuitPack, Position, RadioAnchor, RadioObservation, Sourced } from '@crowdflow/contracts';
import { ASSUMED_FIX_ACCURACY_CEILING_M, ASSUMED_MIN_ANCHORS_FOR_FIX } from '@crowdflow/contracts';
import { Random } from '../random.js';
import { AnchorMap } from './anchors.js';
import { quantileNearest, round } from '../statistics.js';
import { anchorIdFor } from './anchors.js';
import { PATH_LOSS, curveFor, rssiFromDistance } from './pathloss.js';
import { trilaterate } from './solve.js';

/**
 * The weakest signal a scan reports.
 *
 * Android's Wi-Fi scan and a BLE scan both stop reporting well before the
 * radio's theoretical noise floor, and this cutoff matters more than it looks:
 * it is what makes an anchor layout's SPACING the thing that decides whether a
 * fix is possible. Anchors two hundred metres apart are all below the floor from
 * the middle of the gap, so a phone there hears nothing and the layout fails —
 * which is exactly the result the harness exists to surface before somebody
 * installs it.
 */
export const SCAN_FLOOR_DBM = { wifi_ap: -92, ble_beacon: -98 } as const;

/** Android's scan list is capped in practice, and a phone in a crowd of a
 *  hundred thousand hears far more than this. The strongest survive. */
export const SCAN_LIST_MAX = 30;

const assumed = (value: number, note: string): Sourced => ({ value, provenance: 'assumed', samples: null, note });

export interface AnchorPlanOptions {
  /** Metres between anchors along a walkable edge. */
  spacing_m?: number;
  /** Environment for the assumed path-loss exponent. A concourse is 'crowd'. */
  environment?: keyof typeof PATH_LOSS;
  /** Zone kinds that also get a BLE beacon: the covered, indoor-ish places where
   *  the sky is gone and Wi-Fi coverage is thinnest. */
  beacon_kinds?: string[];
  seed?: number;
}

/**
 * Where anchors would have to go for this circuit to be positionable.
 *
 * Anchors are placed at every zone and then along every edge at the given
 * spacing, because that is where people are: a grid over the venue bounding box
 * would put a third of the plan inside the track infield where nobody walks and
 * nothing needs locating.
 *
 * The `anchor_id` is derived from the placement, not from hardware, since there
 * is no hardware yet — it is a slot to be filled in when a real AP is installed
 * there and its BSSID recorded. That keeps the ids stable across regenerations
 * of the plan, so a partially completed survey is not invalidated by re-running
 * this.
 */
export function planAnchors(pack: CircuitPack, options: AnchorPlanOptions = {}): AnchorPack {
  const spacing = options.spacing_m ?? 60;
  const environment = options.environment ?? 'crowd';
  const beaconKinds = options.beacon_kinds ?? ['gate', 'crossing', 'amenity'];
  const exponent = PATH_LOSS[environment];
  const anchors: Record<string, RadioAnchor> = {};

  const place = (kind: RadioAnchor['kind'], slot: string, position: Position, note: string): void => {
    const anchorId = anchorIdFor(kind, `plan:${pack.id}:${slot}`);
    anchors[anchorId] = {
      anchor_id: anchorId,
      kind,
      position: { x: Number(position.x.toFixed(1)), y: Number(position.y.toFixed(1)) },
      rssi_at_1m_dbm: assumed(kind === 'ble_beacon' ? -59 : -40, 'plan default; replace with a metered reading at install'),
      path_loss_exponent: assumed(exponent, `assumed ${environment} environment; measure on the walk test`),
      floor: null,
      note,
    };
  };

  for (const zone of Object.values(pack.zones ?? {})) {
    place('wifi_ap', `zone:${zone.id}`, zone.position, `planned at zone ${zone.id}`);
    if (beaconKinds.includes(zone.kind)) place('ble_beacon', `beacon:${zone.id}`, zone.position, `planned beacon at ${zone.kind} ${zone.id}`);
  }

  for (const edge of Object.values(pack.edges ?? {})) {
    const from = pack.zones?.[edge.source]?.position;
    const to = pack.zones?.[edge.destination]?.position;
    if (!from || !to) continue;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.floor(span / spacing);
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1);
      place('wifi_ap', `edge:${edge.id}:${step}`, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, `planned along edge ${edge.id}`);
    }
  }

  return {
    circuit_id: pack.id,
    // Null, and it must stay null until somebody walks it. The loader, the
    // solver and the console all read this field as "has this been measured",
    // and a plausible date here would answer yes on behalf of work nobody did.
    surveyed_at: null,
    anchors,
  };
}

export interface ScanOptions {
  /** Spread of a single reading, dB. Shadowing in a built environment. */
  sigma_db?: number;
  floor_dbm?: Partial<typeof SCAN_FLOOR_DBM>;
  list_max?: number;
  kinds?: RadioAnchor['kind'][];
}

/**
 * The scan a handset at `truth` would produce, given this anchor map.
 *
 * Generated through the same forward law the solver inverts, plus the two things
 * that actually decide whether a fix happens: the scan floor and the list cap.
 * Noise is Gaussian in dB, which is the standard log-normal shadowing model and
 * is the right shape — the errors are multiplicative in distance, which is why
 * `rangeSigmaM` is proportional.
 */
export function simulateScan(
  anchors: RadioAnchor[],
  truth: Position,
  now: number,
  rng: Random,
  options: ScanOptions = {},
): RadioObservation[] {
  const sigma = options.sigma_db ?? 6;
  const listMax = options.list_max ?? SCAN_LIST_MAX;
  const heard: RadioObservation[] = [];

  for (const anchor of anchors) {
    if (options.kinds && !options.kinds.includes(anchor.kind)) continue;
    const distance = Math.hypot(truth.x - anchor.position.x, truth.y - anchor.position.y);
    const rssi = rssiFromDistance(distance, curveFor(anchor)) + rng.gauss(0, sigma);
    const floor = options.floor_dbm?.[anchor.kind] ?? SCAN_FLOOR_DBM[anchor.kind];
    if (rssi < floor) continue;
    heard.push({ anchor_id: anchor.anchor_id, kind: anchor.kind, rssi_dbm: Number(rssi.toFixed(1)), timestamp: now });
  }

  heard.sort((a, b) => b.rssi_dbm - a.rssi_dbm);
  return heard.slice(0, listMax);
}

export interface AccuracyReport {
  circuit_id: string;
  anchors: number;
  wifi_anchors: number;
  ble_anchors: number;
  samples: number;
  /** samples where enough anchors were heard to solve at all */
  solved: number;
  /** solved samples the fusion ceiling would have accepted */
  usable: number;
  /** median true error, metres. The number that decides whether this works. */
  p50_error_m: number;
  p95_error_m: number;
  /** median claimed accuracy. Compared against p50 error: the estimate is
   *  worthless if it does not track the truth. */
  p50_claimed_m: number;
  /** share of usable fixes whose true error was inside three sigma of the claim */
  within_3_sigma: number;
  mean_anchors_heard: number;
  seed: number;
  sigma_db: number;
}

export interface AccuracyOptions extends ScanOptions {
  samples?: number;
  seed?: number;
  /** the accuracy above which the fusion ladder drops a fix */
  ceiling_m?: number;
}

/**
 * How well an anchor layout would locate people walking this circuit.
 *
 * Sample positions are drawn along edges rather than uniformly over the venue
 * box, for the same reason the plan places anchors there: the answer for the
 * infield is irrelevant and would flatter or damn the layout depending on which
 * way the box happened to sit.
 *
 * Read the report as three questions in order. Is `usable / samples` high enough
 * that most phones get a fix at all — because a perfect fix on a tenth of
 * handsets is worse coverage than a mediocre one on all of them. Is `p50_error_m`
 * small compared to a zone, since a fix that cannot say which concourse someone
 * is on adds nothing to a density estimate. And does `within_3_sigma` hold near
 * one, because everything downstream weights on `accuracy_m` and a layout whose
 * error bars lie is more dangerous than one that is simply imprecise.
 */
export function positioningAccuracy(
  pack: CircuitPack,
  anchorPack: AnchorPack,
  options: AccuracyOptions = {},
): AccuracyReport {
  const sampleCount = options.samples ?? 500;
  const seed = options.seed ?? 42;
  const sigma = options.sigma_db ?? 6;
  const ceiling = options.ceiling_m ?? ASSUMED_FIX_ACCURACY_CEILING_M;
  const rng = new Random(seed);
  const anchors = Object.values(anchorPack.anchors ?? {});
  const map = new AnchorMap(anchorPack, { rssi_sigma_db: sigma });

  const errors: number[] = [];
  const claims: number[] = [];
  let solved = 0;
  let usable = 0;
  let within = 0;
  let heardTotal = 0;

  for (let index = 0; index < sampleCount; index++) {
    const truth = samplePosition(pack, rng);
    if (!truth) break;
    const observations = simulateScan(anchors, truth, 1000, rng, options);
    const resolved = map.resolve(observations, 1000, options.kinds);
    heardTotal += resolved.matched;
    if (resolved.matched < ASSUMED_MIN_ANCHORS_FOR_FIX) continue;
    solved += 1;
    const solution = trilaterate(resolved.ranges);
    const error = Math.hypot(solution.position.x - truth.x, solution.position.y - truth.y);
    if (solution.accuracy_m > ceiling) continue;
    usable += 1;
    errors.push(error);
    claims.push(solution.accuracy_m);
    if (error <= 3 * solution.accuracy_m) within += 1;
  }

  errors.sort((a, b) => a - b);
  claims.sort((a, b) => a - b);
  return {
    circuit_id: pack.id,
    anchors: anchors.length,
    wifi_anchors: anchors.filter((anchor) => anchor.kind === 'wifi_ap').length,
    ble_anchors: anchors.filter((anchor) => anchor.kind === 'ble_beacon').length,
    samples: sampleCount,
    solved,
    usable,
    p50_error_m: round(quantileNearest(errors, 0.5), 2),
    p95_error_m: round(quantileNearest(errors, 0.95), 2),
    p50_claimed_m: round(quantileNearest(claims, 0.5), 2),
    within_3_sigma: usable ? within / usable : 0,
    mean_anchors_heard: sampleCount ? heardTotal / sampleCount : 0,
    seed,
    sigma_db: sigma,
  };
}

/** A point somewhere a person could walk: uniformly along a uniformly chosen
 *  edge. Weighting edges by length would be more faithful to where a crowd is,
 *  but it would also let one enormous car-park edge dominate the report and hide
 *  a layout that fails everywhere people actually queue. */
function samplePosition(pack: CircuitPack, rng: Random): Position | null {
  const edges = Object.values(pack.edges ?? {});
  if (!edges.length) {
    const zones = Object.values(pack.zones ?? {});
    return zones.length ? zones[Math.floor(rng.random() * zones.length)]!.position : null;
  }
  const edge = edges[Math.floor(rng.random() * edges.length)]!;
  const from = pack.zones?.[edge.source]?.position;
  const to = pack.zones?.[edge.destination]?.position;
  if (!from || !to) return null;
  const t = rng.random();
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
