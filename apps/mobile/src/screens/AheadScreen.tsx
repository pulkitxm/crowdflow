/**
 * Crowd building ahead — the screen the whole system exists to produce.
 *
 * The crossing is STILL WALKABLE. The user could look up right now and see people
 * moving across it, and if the app said "blocked" they would rightly stop
 * believing it. The app is speaking because the model says it will not be
 * walkable shortly, and the honest way to say that is to describe what is true
 * now ("filling up", "you can still get across") and let the offer carry the
 * implication. It never states the forecast, the horizon or the probability:
 * those explain the system's reasoning, not the user's next sixty seconds.
 *
 * Both options are real. "Stay on this route" is not a dark-pattern decline, it
 * is a legitimate choice — the diversion only needs a third of the people here,
 * and an app that will not take no for an answer gets deleted before the race.
 */

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
  // Invariant 4, enforced at the last mile: an offer the safety engine did not
  // approve, or one that has expired, is not shown at all. The user is left on a
  // route that is still walkable rather than sent somewhere unvetted.
  const showable = isExpired(view.offer, view.now) ? null : showableOffer(view.offer);
  const step = view.route.steps.find((s) => s.id === view.step_id);

  return (
    <Screen
      view={view}
      footer={
        showable ? (
          <View style={{ gap: space.sm, paddingBottom: space.sm }}>
            {/* The price, above the button, in a full sentence. Nobody should
                have to interpret a "+4" to know what they are agreeing to. */}
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
