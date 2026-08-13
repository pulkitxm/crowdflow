import type { Position, TraceFragment } from '@crowdflow/contracts';
import {
  ASSUMED_FRAGMENT_MAX_DURATION_S,
  GEOIND_EPSILON_VENUE,
  GEOIND_PRIVACY_LEVEL,
} from '@crowdflow/contracts';
import { Random } from '../random.js';

const W_LOWER_BOUND = -800;
export function lambertWMinus1(x: number): number {
  if (!(x >= -1 / Math.E && x < 0)) throw new Error(`W_-1 is defined on [-1/e, 0), got ${x}`);
  if (x === -1 / Math.E) return -1;
  const target = Math.log(-x);
  let low = W_LOWER_BOUND; let high = -1;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (Math.log(-middle) + middle < target) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

export function planarLaplace(point: Position, epsilon: number, rng: Random): Position {
  const angle = rng.uniform(0, 2 * Math.PI);
  const radius = -(lambertWMinus1((rng.random() - 1) / Math.E) + 1) / epsilon;
  return { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
}

export interface FragmentPolicy { epsilon: number; max_duration_s: number; privacy_level: number }
export const DEFAULT_FRAGMENT_POLICY: FragmentPolicy = {
  epsilon: GEOIND_EPSILON_VENUE,
  max_duration_s: ASSUMED_FRAGMENT_MAX_DURATION_S,
  privacy_level: GEOIND_PRIVACY_LEVEL,
};

export function noiseFragment(
  points: Position[], tStart: number, tEnd: number, rng: Random,
  policy: FragmentPolicy = DEFAULT_FRAGMENT_POLICY, fragmentId?: string,
): TraceFragment {
  if (points.length < 2) throw new Error('a fragment needs at least two points');
  if (tEnd - tStart > policy.max_duration_s) throw new Error('fragment exceeds privacy duration cap');
  return {
    fragment_id: fragmentId ?? `frag-${Math.trunc(rng.random() * Number.MAX_SAFE_INTEGER).toString(16)}`,
    points: points.map((point) => planarLaplace(point, policy.epsilon, rng)),
    t_start: tStart, t_end: tEnd, epsilon: policy.epsilon,
    noise_radius_m: policy.privacy_level / policy.epsilon,
  };
}
