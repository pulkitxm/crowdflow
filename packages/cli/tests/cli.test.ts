import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const bun = process.env.BUN_BIN ?? 'bun';
function run(...args: string[]): string { return execFileSync(bun, ['packages/cli/src/main.ts', ...args], { cwd: root, encoding: 'utf8' }); }

describe('TypeScript headless CLI', () => {
  it('lists every committed circuit pack', () => {
    const circuits = run('circuit', 'list').trim().split('\n');
    expect(circuits).toHaveLength(78);
    expect(circuits.some((line) => line.startsWith('silverstone'))).toBe(true);
    expect(circuits.some((line) => line.startsWith('zolder'))).toBe(true);
  });

  it('validates the seeded pack and reports authored standards', () => {
    expect(run('circuit', 'validate', 'silverstone')).toContain('contract and geometry OK');
    const standards = run('standards'); expect(standards).toContain('Operational density bands (authoritative)'); expect(standards).toContain('Measured, never assumed');
  });

  it('runs the measured mesh comparison from the TypeScript core', () => {
    const output = run('mesh', 'compare', '--nodes', '20', '--ticks', '10', '--seed', '7'); expect(output).toContain('spray-and-wait'); expect(output).toContain('mean coverage');
  });

  it('runs deterministically for the same seed', () => {
    const first = run('sim', 'run', 'silverstone', '--count', '100', '--ticks', '10', '--seed', '7');
    const second = run('sim', 'run', 'silverstone', '--count', '100', '--ticks', '10', '--seed', '7');
    expect(first).toBe(second);
  });
});
