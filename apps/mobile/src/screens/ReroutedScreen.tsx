/**
 * Redirected.
 *
 * The old route stays on screen, struck through. That costs a third of the
 * screen and it is worth it: a route that silently changes reads as a bug or a
 * betrayal, and the user has already walked part of the old one. Showing what
 * was replaced makes the change legible in one glance — this, not that, and here
 * is what it cost you.
 *
 * The cost is repeated in plain words after the fact, not only before. Someone
 * who tapped while walking may not have read it, and finding out later that a
 * redirect cost four minutes is how trust in a routing app ends.
 */

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
          {/* The user can always go back. The system recommends; it never traps. */}
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
