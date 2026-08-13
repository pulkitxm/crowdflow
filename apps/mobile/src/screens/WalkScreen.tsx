/**
 * The ordinary screen: you are walking, everything is fine.
 *
 * This is the state the app is in for most of the day, and the temptation is to
 * fill it — with a map, a countdown to the session, a merchandise offer, a
 * density figure to prove the system is working. None of that changes where the
 * user puts their feet in the next sixty seconds, so none of it is here. A calm
 * screen is what earns the right to be believed later, when it is not calm.
 */

import React from 'react';

import type { SpectatorView } from '../feed/types';
import { Hero, StepList, worstOf } from '../ui/route';
import { Screen } from '../ui/screen';

export function WalkScreen({ view }: { view: Extract<SpectatorView, { kind: 'walk' }> }) {
  return (
    <Screen view={view}>
      <Hero route={view.route} state={worstOf(view.route.steps)} />
      <StepList steps={view.route.steps} now={view.now} />
    </Screen>
  );
}
