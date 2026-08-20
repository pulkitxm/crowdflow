
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
  onSelectGate,
  onSelectOption,
}: {
  view: SpectatorView;
  onAccept?: () => void;
  onDecline?: () => void;
  onUndo?: () => void;
  onSelectGate?: (zoneId: string) => void;
  onSelectOption?: (optionId: string) => void;
}) {
  switch (view.kind) {
    case 'arrival':
      return <ArrivalScreen view={view} onSelectGate={onSelectGate} />;
    case 'walk':
      return <WalkScreen view={view} />;
    case 'ahead':
      return <AheadScreen view={view} onAccept={onAccept} onDecline={onDecline} />;
    case 'rerouted':
      return <ReroutedScreen view={view} onUndo={onUndo} />;
    case 'offline':
      return <OfflineScreen view={view} />;
    case 'hold':
      return <HoldScreen view={view} onSelectOption={onSelectOption} />;
    default:
      return null;
  }
}
