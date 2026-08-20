#!/usr/bin/env bun
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { CrowdFlowServer } from './app.js';

function root(): string { let current = process.cwd(); while (current !== dirname(current)) { if (existsSync(join(current, 'circuits', 'index.yaml'))) return current; current = dirname(current); } throw new Error('could not locate circuits/index.yaml'); }
const args = process.argv.slice(2); const value = (name: string, fallback: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const server = new CrowdFlowServer(root());
const session = server.startSession({ circuit_id: value('circuit', 'silverstone'), scenario: value('scenario', 'egress'), population: Number(value('population', '2500')), seed: Number(value('seed', '42')), participation: Number(value('participation', '0.18')), speed: Number(value('speed', '1')), intervene: !args.includes('--no-intervene') });
server.startLive({ circuit_id: value('circuit', 'silverstone'), participation: Number(value('live-participation', '1')) });
if (!args.includes('--paused')) session.control('play');
const host = value('host', '127.0.0.1'); const port = Number(value('port', '8099'));
await server.listen(port, host); console.log(`CrowdFlow API http://${host}:${port}`);
