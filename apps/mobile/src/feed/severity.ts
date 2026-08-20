
import type { Step, WayAhead } from './types';

const SEVERITY: Record<WayAhead, number> = {
  nominal: 0,
  unknown: 1,
  building: 2,
  critical: 3,
};

export function worstOf(steps: readonly Step[]): WayAhead {
  if (steps.length === 0) return 'unknown';
  return steps.reduce<WayAhead>(
    (worst, step) => (SEVERITY[step.way_ahead] > SEVERITY[worst] ? step.way_ahead : worst),
    'nominal',
  );
}
