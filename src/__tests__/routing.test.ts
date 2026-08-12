import { describe, expect, it } from 'vitest';
import { demoVenue } from '../venue/demoVenue';

describe('on-device routing', () => {
  it('avoids C17 and uses preferred C11', () => {
    const path = demoVenue.shortestPath('gate_a', 'food_court', new Set(['zone_c17']), new Set(['zone_c11']));
    expect(path).toEqual(['gate_a', 'plaza_a', 'zone_c11', 'junction_south', 'food_court']);
  });

  it('falls back to a penalised avoided zone rather than failing', () => {
    const path = demoVenue.shortestPath('zone_c17', 'junction_center', new Set(['junction_center']));
    expect(path.at(-1)).toBe('junction_center');
  });
});
