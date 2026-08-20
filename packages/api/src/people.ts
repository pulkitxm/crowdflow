import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Position, PositionSource } from '@crowdflow/contracts';
import type { GridCell, PeopleQuery, PeopleQueryResult, PersonLocation, PersonRecord } from './wire.js';
export type { GridCell, PeopleQuery, PeopleQueryResult, PersonLocation, PersonRecord } from './wire.js';

interface PersonRow {
  person_id: number;
  circuit_id: string;
  joined_at: number;
  last_seen_at: number | null;
  status: 'active';
}

interface LocationRow extends PersonRow {
  x: number;
  y: number;
  speed_ms: number;
  accuracy_m: number;
  source: PositionSource;
  gate_id: string | null;
}

export function gridSizeForZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0) throw new Error('zoom must be a non-negative number');
  if (zoom < 2) return 100;
  if (zoom < 4) return 50;
  if (zoom < 8) return 25;
  return 10;
}

export class PeopleStore {
  private readonly database: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true, strict: true });
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS people (
        person_id INTEGER PRIMARY KEY,
        circuit_id TEXT NOT NULL,
        joined_at REAL NOT NULL,
        last_seen_at REAL,
        status TEXT NOT NULL CHECK(status = 'active')
      );
      CREATE TABLE IF NOT EXISTS locations (
        person_id INTEGER PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        speed_ms REAL NOT NULL,
        accuracy_m REAL NOT NULL,
        source TEXT NOT NULL,
        gate_id TEXT,
        updated_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS people_circuit_idx ON people(circuit_id, status);
      CREATE INDEX IF NOT EXISTS location_xy_idx ON locations(x, y);
    `);
  }

  login(personId: number, circuitId: string, now: number): PersonRecord {
    validatePersonId(personId);
    if (!circuitId.trim()) throw new Error('circuit_id is required');
    this.database.run(
      `INSERT INTO people(person_id, circuit_id, joined_at, last_seen_at, status)
       VALUES (?, ?, ?, NULL, 'active')
       ON CONFLICT(person_id) DO UPDATE SET circuit_id = excluded.circuit_id, status = 'active'`,
      personId,
      circuitId,
      now,
    );
    return this.get(personId)!;
  }

  exists(personId: number, circuitId: string): boolean {
    validatePersonId(personId);
    return this.database.query<{ found: number }, [number, string]>(
      "SELECT 1 AS found FROM people WHERE person_id = ? AND circuit_id = ? AND status = 'active'",
    ).get(personId, circuitId) != null;
  }

  updateLocation(
    personId: number,
    circuitId: string,
    position: Position,
    speedMs: number,
    accuracyM: number,
    source: PositionSource,
    now: number,
    gateId: string | null = null,
  ): PersonLocation {
    if (!this.exists(personId, circuitId)) throw new Error(`person ${personId} is not logged in to ${circuitId}`);
    this.database.run('UPDATE people SET last_seen_at = ? WHERE person_id = ?', now, personId);
    this.database.run(
      `INSERT INTO locations(person_id, x, y, speed_ms, accuracy_m, source, gate_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET
         x = excluded.x,
         y = excluded.y,
         speed_ms = excluded.speed_ms,
         accuracy_m = excluded.accuracy_m,
         source = excluded.source,
         gate_id = COALESCE(excluded.gate_id, locations.gate_id),
         updated_at = excluded.updated_at`,
      personId,
      position.x,
      position.y,
      speedMs,
      accuracyM,
      source,
      gateId,
      now,
    );
    return this.location(personId)!;
  }

  get(personId: number): PersonRecord | null {
    const row = this.database.query<PersonRow, [number]>(
      'SELECT person_id, circuit_id, joined_at, last_seen_at, status FROM people WHERE person_id = ?',
    ).get(personId);
    return row ? { ...row } : null;
  }

  location(personId: number): PersonLocation | null {
    const row = this.database.query<LocationRow, [number]>(
      `SELECT p.person_id, p.circuit_id, p.joined_at, p.last_seen_at, p.status,
              l.x, l.y, l.speed_ms, l.accuracy_m, l.source, l.gate_id
       FROM people p JOIN locations l ON l.person_id = p.person_id
       WHERE p.person_id = ? AND p.status = 'active'`,
    ).get(personId);
    return row ? toLocation(row) : null;
  }

  list(circuitId: string, count = 1000): PersonLocation[] {
    const limit = validateCount(count);
    return this.database.query<LocationRow, [string, number]>(
      `SELECT p.person_id, p.circuit_id, p.joined_at, p.last_seen_at, p.status,
              l.x, l.y, l.speed_ms, l.accuracy_m, l.source, l.gate_id
       FROM people p JOIN locations l ON l.person_id = p.person_id
       WHERE p.circuit_id = ? AND p.status = 'active'
       ORDER BY p.person_id LIMIT ?`,
    ).all(circuitId, limit).map(toLocation);
  }

  query(circuitId: string, request: PeopleQuery): PeopleQueryResult {
    validateCoordinates(request.coordinates);
    const size = gridSizeForZoom(request.zoom);
    const matches = this.list(circuitId, 100_000).filter((person) => pointInPolygon(person.position, request.coordinates));
    const people = matches.slice(0, validateCount(request.count ?? 1000));
    const cells = new Map<string, GridCell>();
    for (const person of matches) {
      const minX = Math.floor(person.position.x / size) * size;
      const minY = Math.floor(person.position.y / size) * size;
      const id = `${minX}:${minY}:${size}`;
      const cell = cells.get(id) ?? {
        id,
        min_x: minX,
        min_y: minY,
        max_x: minX + size,
        max_y: minY + size,
        count: 0,
        person_ids: [],
      };
      cell.count += 1;
      if (cell.person_ids.length < 100) cell.person_ids.push(person.person_id);
      cells.set(id, cell);
    }
    return {
      circuit_id: circuitId,
      coordinates: request.coordinates.map((position) => ({ ...position })),
      zoom: request.zoom,
      grid_size_m: size,
      matched_count: matches.length,
      returned_count: people.length,
      people,
      cells: [...cells.values()].sort((a, b) => a.min_y - b.min_y || a.min_x - b.min_x),
    };
  }

  close(): void {
    this.database.close();
  }
}

function validatePersonId(personId: number): void {
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Error('person_id must be a positive integer');
}

function validateCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error('count must be an integer from 1 to 100000');
  return count;
}

function validateCoordinates(coordinates: Position[]): void {
  if (coordinates.length !== 4) throw new Error('coordinates must contain exactly four points');
  if (coordinates.some((position) => !Number.isFinite(position.x) || !Number.isFinite(position.y))) throw new Error('coordinates must be finite');
  const area = coordinates.reduce((sum, point, index) => {
    const next = coordinates[(index + 1) % coordinates.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(area) < 0.001) throw new Error('coordinates must enclose an area');
}

function pointInPolygon(point: Position, polygon: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!;
    const before = polygon[previous]!;
    const crosses = current.y > point.y !== before.y > point.y;
    if (crosses && point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

function toLocation(row: LocationRow): PersonLocation {
  return {
    person_id: row.person_id,
    circuit_id: row.circuit_id,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    status: row.status,
    position: { x: row.x, y: row.y },
    speed_ms: row.speed_ms,
    accuracy_m: row.accuracy_m,
    source: row.source,
    gate_id: row.gate_id,
  };
}
