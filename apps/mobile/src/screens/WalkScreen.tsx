
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
