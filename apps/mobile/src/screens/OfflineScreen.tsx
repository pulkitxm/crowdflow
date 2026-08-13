/**
 * No signal.
 *
 * The one screen allowed to explain how the system works, because here the
 * explanation is reassurance rather than trivia: the user is standing in a field
 * with no bars, holding a phone that is still giving directions, and without a
 * sentence of explanation they will assume it is lying to them.
 *
 * It is also the screen that has to be honest about what it does not know. Two
 * different kinds of not-knowing appear here and they are said differently: the
 * advice is a few minutes old (stated as an age, never hidden), and one stretch
 * has nobody reporting from it at all (stated as no reports, never as clear).
 * Invariant 5 is a rendering rule before it is a data rule.
 */

import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import type { SpectatorView } from '../feed/types';
import { Body, Card, Eyebrow, Headline } from '../ui/atoms';
import { Hero, StepList, worstOf } from '../ui/route';
import { Screen } from '../ui/screen';

export function OfflineScreen({ view }: { view: Extract<SpectatorView, { kind: 'offline' }> }) {
  return (
    <Screen view={view}>
      <Card>
        <View style={{ gap: space.sm }}>
          <Eyebrow>No phone signal</Eyebrow>
          <Headline>Still working</Headline>
          <Body tone="soft">
            Your phone is passing directions to and from {view.link.mesh_peers} phones near you, so
            you keep getting them without a signal.
          </Body>
          <Body tone="soft">
            Crossing times below were sent before the signal went, and count down on your phone.
          </Body>
        </View>
      </Card>

      <Hero route={view.route} state={worstOf(view.route.steps)} />
      <StepList steps={view.route.steps} now={view.now} />
    </Screen>
  );
}
