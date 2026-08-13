/**
 * The app itself: one function from a `SpectatorView` to a screen.
 *
 * There is no navigation stack, no tab bar and no home screen, because there is
 * no browsing to do. The system knows where you are and what is about to happen
 * there; the app's job is to show the one screen that answers it. Anything a
 * user would have to navigate to find is, by definition, not urgent enough to be
 * in this app.
 *
 * The switch is exhaustive over the union and ends in a `never`, so a new state
 * of the day cannot be added upstream without a screen being written for it.
 */

import React from 'react';

import type { SpectatorView } from './feed/types';
import { AheadScreen } from './screens/AheadScreen';
import { ArrivalScreen } from './screens/ArrivalScreen';
import { HoldScreen } from './screens/HoldScreen';
import { OfflineScreen } from './screens/OfflineScreen';
import { ReroutedScreen } from './screens/ReroutedScreen';
import { WalkScreen } from './screens/WalkScreen';

export function SpectatorApp({
  view,
  onAccept,
  onDecline,
  onUndo,
}: {
  view: SpectatorView;
  onAccept?: () => void;
  onDecline?: () => void;
  onUndo?: () => void;
}) {
  switch (view.kind) {
    case 'arrival':
      return <ArrivalScreen view={view} />;
    case 'walk':
      return <WalkScreen view={view} />;
    case 'ahead':
      return <AheadScreen view={view} onAccept={onAccept} onDecline={onDecline} />;
    case 'rerouted':
      return <ReroutedScreen view={view} onUndo={onUndo} />;
    case 'offline':
      return <OfflineScreen view={view} />;
    case 'hold':
      return <HoldScreen view={view} />;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}
