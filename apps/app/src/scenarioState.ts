import type { ScenarioSnapshot } from '@crowdflow/contracts/wire';

export function acceptScenarioSnapshot(current: ScenarioSnapshot | null, incoming: ScenarioSnapshot): ScenarioSnapshot {
  return current && incoming.revision < current.revision ? current : incoming;
}
