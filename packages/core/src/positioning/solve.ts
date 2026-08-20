/**
 * From a handful of ranged anchors to one position, with an error bar that means
 * something.
 *
 * Two solvers, and which one runs is decided by how many anchors were heard
 * rather than by configuration:
 *
 *   3+ anchors  weighted least squares (Gauss-Newton). A real trilateration:
 *               it can be wrong in a way the residual reveals.
 *   1-2 anchors weighted centroid. Not a trilateration and the contract says so
 *               through `anchors_used`, because with two circles the answer is
 *               two points and picking one is a coin toss dressed as geometry.
 *
 * Least squares is used rather than the closed-form linearised solution because
 * the closed form needs a reference anchor, and its answer depends on which
 * anchor gets picked — which means two phones hearing the same five APs can
 * report different positions for reasons that have nothing to do with where
 * they are standing. Iterating from a weighted centroid has no such asymmetry.
 *
 * The output is a `PositionFix`, and its two error terms are separate on
 * purpose. `accuracy_m` is what the geometry supports; `residual_m` is what the
 * solve could not explain. A tight accuracy beside a large residual is the
 * signature of a WRONG ANCHOR MAP — a surveyed position that has since moved,
 * or an AP that was re-cabled between events — and that is a venue problem, not
 * a handset problem. Collapsing them into one number destroys the only signal
 * that tells the two apart.
 */

import type { Position, PositionFix, PositionSource } from '@crowdflow/contracts';
import {
  ASSUMED_FIX_ACCURACY_FLOOR_M,
  ASSUMED_MIN_ANCHORS_FOR_FIX,
} from '@crowdflow/contracts';
import type { Range } from './pathloss.js';

/** Gauss-Newton bounds. Iterations are cheap; a solve that has not converged in
 *  a dozen steps is not going to, and a phone must not spend a battery finding
 *  that out. */
const MAX_ITERATIONS = 12;
const CONVERGED_M = 0.05;
/** Below this determinant the anchors are effectively colinear: the geometry
 *  constrains one axis and not the other, and the "solution" along the
 *  unconstrained axis is arbitrary. Fall back rather than emit it. */
const SINGULAR = 1e-9;

export interface Solution {
  position: Position;
  /** one-sigma, metres, from the geometry and the range errors */
  accuracy_m: number;
  /** RMS of the weighted range residuals, in metres */
  residual_m: number;
  anchors_used: number;
  /** false when the anchors were too few or too colinear to trilaterate */
  trilaterated: boolean;
  iterations: number;
}

/**
 * Weighted centroid. The seed for least squares, and the answer when there is
 * not enough geometry for anything better.
 *
 * The weight is 1/(d^2 + sigma^2): near anchors dominate because their range
 * error is proportionally smaller (see `rangeSigmaM`), and the sigma term keeps
 * a very close, very uncertain reading from taking over the estimate entirely.
 */
export function weightedCentroid(ranges: Range[]): Position {
  if (!ranges.length) throw new Error('a centroid needs at least one range');
  let sumX = 0; let sumY = 0; let sumW = 0;
  for (const range of ranges) {
    const weight = 1 / (range.distance_m ** 2 + range.sigma_m ** 2 + 1e-6);
    sumX += range.position.x * weight;
    sumY += range.position.y * weight;
    sumW += weight;
  }
  return { x: sumX / sumW, y: sumY / sumW };
}

/**
 * The spread of the anchors themselves, as a fallback error bar.
 *
 * When the geometry cannot produce a covariance, the honest statement about a
 * centroid is "somewhere among these anchors", and its size is how far apart
 * they are. Never smaller than the best range's sigma: a single anchor heard at
 * two metres does locate a phone to a few metres, and reporting that as zero
 * spread would be a lie in the other direction.
 */
function centroidAccuracy(ranges: Range[], centre: Position): number {
  const spread = Math.sqrt(
    ranges.reduce((sum, range) => sum + (range.position.x - centre.x) ** 2 + (range.position.y - centre.y) ** 2, 0)
      / ranges.length,
  );
  const nearest = Math.min(...ranges.map((range) => range.distance_m + range.sigma_m));
  return Math.max(ASSUMED_FIX_ACCURACY_FLOOR_M, spread, nearest);
}

/**
 * Weighted nonlinear least squares over the range residuals.
 *
 * Each observation contributes r_i = (|p - a_i| - d_i) / sigma_i, so an anchor
 * ranged to +/-2 m pulls three times as hard as one ranged to +/-6 m. The 2x2
 * normal equations are inverted in closed form — there is no reason to carry a
 * matrix library for a two-dimensional problem, and the determinant check is
 * the colinearity test for free.
 */
export function trilaterate(ranges: Range[], seed?: Position): Solution {
  if (ranges.length < 1) throw new Error('a solve needs at least one range');
  const start = seed ?? weightedCentroid(ranges);

  if (ranges.length < ASSUMED_MIN_ANCHORS_FOR_FIX) {
    return {
      position: start,
      accuracy_m: centroidAccuracy(ranges, start),
      residual_m: rms(ranges, start),
      anchors_used: ranges.length,
      trilaterated: false,
      iterations: 0,
    };
  }

  let point = start;
  let iterations = 0;
  let singular = false;

  for (; iterations < MAX_ITERATIONS; iterations++) {
    let jtj00 = 0; let jtj01 = 0; let jtj11 = 0; let jtr0 = 0; let jtr1 = 0;
    for (const range of ranges) {
      const dx = point.x - range.position.x;
      const dy = point.y - range.position.y;
      // A phone sitting exactly on an anchor has no gradient direction; nudge
      // rather than divide by zero. The nudge is far below any real accuracy.
      const distance = Math.hypot(dx, dy) || 1e-6;
      const weight = 1 / range.sigma_m;
      const j0 = (dx / distance) * weight;
      const j1 = (dy / distance) * weight;
      const residual = (distance - range.distance_m) * weight;
      jtj00 += j0 * j0; jtj01 += j0 * j1; jtj11 += j1 * j1;
      jtr0 += j0 * residual; jtr1 += j1 * residual;
    }
    const determinant = jtj00 * jtj11 - jtj01 * jtj01;
    if (Math.abs(determinant) < SINGULAR) { singular = true; break; }
    const stepX = -(jtj11 * jtr0 - jtj01 * jtr1) / determinant;
    const stepY = -(jtj00 * jtr1 - jtj01 * jtr0) / determinant;
    point = { x: point.x + stepX, y: point.y + stepY };
    if (Math.hypot(stepX, stepY) < CONVERGED_M) { iterations += 1; break; }
  }

  if (singular) {
    return {
      position: start,
      accuracy_m: centroidAccuracy(ranges, start),
      residual_m: rms(ranges, start),
      anchors_used: ranges.length,
      trilaterated: false,
      iterations,
    };
  }

  return {
    position: point,
    accuracy_m: accuracyAt(ranges, point),
    residual_m: rms(ranges, point),
    anchors_used: ranges.length,
    trilaterated: true,
    iterations,
  };
}

/**
 * One-sigma accuracy from the parameter covariance.
 *
 * cov = (J^T J)^-1, scaled by the reduced chi-square so that ranges which
 * disagree with each other widen the error bar instead of being averaged into a
 * confident wrong answer. The two axes are combined into a single circular
 * sigma — an ellipse would be more truthful, but nothing downstream can consume
 * one: `CrowdNode.accuracy_m` is scalar and a dot on a console is round.
 */
function accuracyAt(ranges: Range[], point: Position): number {
  let jtj00 = 0; let jtj01 = 0; let jtj11 = 0; let chi = 0;
  for (const range of ranges) {
    const dx = point.x - range.position.x;
    const dy = point.y - range.position.y;
    const distance = Math.hypot(dx, dy) || 1e-6;
    const weight = 1 / range.sigma_m;
    const j0 = (dx / distance) * weight;
    const j1 = (dy / distance) * weight;
    jtj00 += j0 * j0; jtj01 += j0 * j1; jtj11 += j1 * j1;
    chi += ((distance - range.distance_m) * weight) ** 2;
  }
  const determinant = jtj00 * jtj11 - jtj01 * jtj01;
  if (!(Math.abs(determinant) > SINGULAR)) return centroidAccuracy(ranges, point);
  // Degrees of freedom: observations minus the two solved parameters. With
  // exactly three anchors this is 1, so the reduced chi-square is a single
  // sample of a very noisy quantity.
  const dof = Math.max(1, ranges.length - 2);
  // Disagreement between ranges may only WIDEN the error bar, never narrow it.
  // The range sigmas are believed a priori — they come from the path-loss
  // gradient, not from this solve — so a set of readings that happens to be
  // mutually consistent is luck, not precision. Allowing chi/dof below 1 to
  // scale the covariance down is what made a four-anchor solve claim a few
  // metres of accuracy on a fix that was tens of metres out, roughly one time
  // in six.
  const scale = Math.max(1, chi / dof);
  const varianceX = (jtj11 / determinant) * scale;
  const varianceY = (jtj00 / determinant) * scale;
  return Math.max(ASSUMED_FIX_ACCURACY_FLOOR_M, Math.sqrt((varianceX + varianceY) / 2));
}

/** Unweighted RMS of the range residuals, in metres. Unweighted deliberately:
 *  this is the number that indicts the anchor map, and weighting it by the
 *  confidence in that same map would hide the problem. */
function rms(ranges: Range[], point: Position): number {
  const total = ranges.reduce((sum, range) => {
    const distance = Math.hypot(point.x - range.position.x, point.y - range.position.y);
    return sum + (distance - range.distance_m) ** 2;
  }, 0);
  return Math.sqrt(total / ranges.length);
}

/** The solution as the contract carries it. */
export function fixFrom(solution: Solution, source: PositionSource, timestamp: number): PositionFix {
  return {
    position: solution.position,
    accuracy_m: solution.accuracy_m,
    source,
    timestamp,
    anchors_used: solution.anchors_used,
    residual_m: solution.residual_m,
    speed_ms: null,
    heading_deg: null,
  };
}
