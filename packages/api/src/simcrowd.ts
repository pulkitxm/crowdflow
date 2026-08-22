import type { Simulation } from '@crowdflow/core';
import { gridSizeForZoom } from './people.js';
import type { GridCell, PeopleQuery, PeopleQueryResult } from './wire.js';

export const CELL_ID_SAMPLE_MAX = 100;

export function simulatedPeopleQuery(sim: Simulation, circuitId: string, request: PeopleQuery): PeopleQueryResult {
  const size = gridSizeForZoom(request.zoom);
  const xs = request.coordinates.map((position) => position.x);
  const ys = request.coordinates.map((position) => position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const cells = new Map<string, GridCell>();
  let matched = 0;
  for (const occupant of sim.occupantPositions()) {
    const { x, y } = occupant.position;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    matched += 1;
    const cellMinX = Math.floor(x / size) * size;
    const cellMinY = Math.floor(y / size) * size;
    const id = `${cellMinX}:${cellMinY}`;
    const cell = cells.get(id) ?? {
      id, min_x: cellMinX, min_y: cellMinY, max_x: cellMinX + size, max_y: cellMinY + size,
      count: 0, person_ids: [],
    };
    cell.count += 1;
    if (cell.person_ids.length < CELL_ID_SAMPLE_MAX) cell.person_ids.push(occupant.id);
    cells.set(id, cell);
  }

  return {
    circuit_id: circuitId,
    coordinates: request.coordinates,
    zoom: request.zoom,
    grid_size_m: size,
    matched_count: matched,
    returned_count: 0,
    people: [],
    cells: [...cells.values()].sort((a, b) => a.id.localeCompare(b.id)),
    source: 'simulation',
  };
}
