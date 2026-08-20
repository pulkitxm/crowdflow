
import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import type { SpectatorView } from '../feed/types';
import { costText, journeyText } from '../feed/time';
import { isExpired, showableOffer } from '../feed/offer';
import { WAY_AHEAD_SENTENCE } from '../feed/words';
import { Body, Card, Eyebrow, Headline, PrimaryAction, SecondaryAction, StatusPill } from '../ui/atoms';
import { Hero, StepList, worstOf } from '../ui/route';
import { Screen } from '../ui/screen';

export function AheadScreen({
  view,
  onAccept,
  onDecline,
}: {
  view: Extract<SpectatorView, { kind: 'ahead' }>;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const showable = isExpired(view.offer, view.now) ? null : showableOffer(view.offer);
  const step = view.route.steps.find((s) => s.id === view.step_id);

  return (
    <Screen
      view={view}
      footer={
        showable ? (
          <View style={{ gap: space.sm, paddingBottom: space.sm }}>
            {}
            <Body style={{ fontWeight: '600' }}>
              The quieter way costs {costText(showable.cost_s)} — about{' '}
              {journeyText(showable.offer.instead.total_walk_s)} in all.
            </Body>
            <PrimaryAction
              label="Take the quieter way"
              cost={`${costText(showable.cost_s)} · ${journeyText(showable.offer.instead.total_walk_s)} total`}
              onPress={onAccept}
            />
            <SecondaryAction label="Stay on this route" onPress={onDecline} />
          </View>
        ) : null
      }
    >
      <Hero route={view.route} state={worstOf(view.route.steps)} />

      {step ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <Eyebrow>Ahead of you</Eyebrow>
            <Headline>{step.to}</Headline>
            <StatusPill state={step.way_ahead} big />
            <Body>{WAY_AHEAD_SENTENCE[step.way_ahead]}</Body>
            {showable ? <Body tone="soft">{showable.reason}</Body> : null}
          </View>
        </Card>
      ) : null}

      <StepList steps={view.route.steps} now={view.now} highlightId={view.step_id} />
    </Screen>
  );
}
