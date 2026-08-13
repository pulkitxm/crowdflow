import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
function run(...args: string[]): string { return execFileSync(process.execPath, ['--import', 'tsx', 'packages/cli/src/main.ts', ...args], { cwd: root, encoding: 'utf8' }); }

describe('TypeScript headless CLI', () => {
  it('validates the seeded pack and reports authored standards', () => {
    expect(run('circuit', 'validate', 'silverstone')).toContain('integrity OK');
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
