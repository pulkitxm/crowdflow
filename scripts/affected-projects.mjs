import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const projects = [
  { project: 'contracts', workspace: '@crowdflow/contracts', root: 'packages/contracts/' },
  { project: 'core', workspace: '@crowdflow/core', root: 'packages/core/' },
  { project: 'hf', workspace: '@crowdflow/hf', root: 'packages/hf/' },
  { project: 'agent', workspace: '@crowdflow/agent', root: 'packages/agent/' },
  { project: 'cli', workspace: '@crowdflow/cli', root: 'packages/cli/' },
  { project: 'api', workspace: '@crowdflow/api', root: 'packages/api/' },
  { project: 'dashboard', workspace: 'crowdflow-dashboard', root: 'apps/dashboard/' },
  { project: 'mobile', workspace: 'crowdflow-spectator', root: 'apps/mobile/' },
];

const consumers = {
  contracts: ['core', 'hf', 'agent', 'cli', 'api', 'dashboard', 'mobile'],
  core: ['hf', 'agent', 'cli', 'api', 'dashboard', 'mobile'],
  hf: ['cli', 'api', 'dashboard', 'mobile'],
  agent: [],
  cli: ['api', 'dashboard', 'mobile'],
  api: ['dashboard', 'mobile'],
  dashboard: [],
  mobile: [],
};

function expand(affected) {
  const queue = [...affected];
  while (queue.length) {
    const project = queue.shift();
    for (const consumer of consumers[project] ?? []) {
      if (affected.has(consumer)) continue;
      affected.add(consumer);
      queue.push(consumer);
    }
  }
  return affected;
}

export function affectedProjects(paths) {
  const all = new Set(projects.map(({ project }) => project));
  const shared = paths.some((path) =>
    path === 'package.json'
    || path === 'bun.lock'
    || path === 'tsconfig.base.json'
    || path === 'biome.json'
    || path === 'Makefile'
    || path.startsWith('scripts/')
    || path.startsWith('.github/workflows/'));
  const affected = shared || paths.some((path) => path.startsWith('circuits/'))
    ? all
    : new Set(projects.filter(({ root }) => paths.some((path) => path.startsWith(root))).map(({ project }) => project));
  expand(affected);
  return {
    workspaces: projects.filter(({ project }) => affected.has(project)),
    presentation: paths.some((path) => path.startsWith('presentation/')) || shared,
  };
}

function changedPaths() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA || 'HEAD';
  if (!base || /^0+$/.test(base)) return null;
  try {
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`]);
    return execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function runSelftest() {
  const core = affectedProjects(['packages/core/src/state/engine.ts']);
  if (core.workspaces.map(({ project }) => project).join(',') !== 'core,hf,agent,cli,api,dashboard,mobile') {
    throw new Error('core dependency propagation failed');
  }
  const dashboard = affectedProjects(['apps/dashboard/src/main.ts']);
  if (dashboard.workspaces.map(({ project }) => project).join(',') !== 'dashboard') {
    throw new Error('dashboard path isolation failed');
  }
  const presentation = affectedProjects(['presentation/index.html']);
  if (presentation.workspaces.length || !presentation.presentation) {
    throw new Error('presentation path isolation failed');
  }
  console.log('affected project self-test passed');
}

function main() {
  const paths = changedPaths();
  const affected = paths === null
    ? { workspaces: projects, presentation: true }
    : affectedProjects(paths);
  const workspaces = JSON.stringify(affected.workspaces);
  const lint = JSON.stringify([
    ...affected.workspaces,
    ...(affected.presentation ? [{ project: 'presentation', workspace: '' }] : []),
  ]);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(output, `workspaces=${workspaces}\nlint=${lint}\n`);
  } else {
    console.log(JSON.stringify({ paths, workspaces: affected.workspaces, lint: JSON.parse(lint) }, null, 2));
  }
}

if (process.argv.includes('--selftest')) runSelftest();
else main();
