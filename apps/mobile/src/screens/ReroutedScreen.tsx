
import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import type { SpectatorView } from '../feed/types';
import { costMinutes } from '../feed/time';
import { Body, Card, Eyebrow, SecondaryAction } from '../ui/atoms';
import { Hero, StepList, worstOf } from '../ui/route';
import { Screen } from '../ui/screen';

export function ReroutedScreen({
  view,
  onUndo,
}: {
  view: Extract<SpectatorView, { kind: 'rerouted' }>;
  onUndo?: () => void;
}) {
  const added = costMinutes(view.added_s);
  return (
    <Screen
      view={view}
      footer={
        <View style={{ paddingBottom: space.sm }}>
          {}
          <SecondaryAction label="Go back to the old way" onPress={onUndo} />
        </View>
      }
    >
      <Hero route={view.route} state={worstOf(view.route.steps)} />

      <Body style={{ fontWeight: '600' }}>
        This adds about {added} {added === 1 ? 'minute' : 'minutes'}.
      </Body>
      <Body tone="soft" style={{ marginTop: -space.md }}>
        {view.reason}
      </Body>

      <StepList steps={view.route.steps} now={view.now} />

      <Card tone="outline">
        <View style={{ gap: space.sm }}>
          <Eyebrow>Instead of</Eyebrow>
          <StepList steps={view.instead_of.steps} now={view.now} struck />
        </View>
      </Card>
    </Screen>
  );
}
