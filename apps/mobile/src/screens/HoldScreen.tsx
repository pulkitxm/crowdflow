/**
 * After the race — the screen that has to be willing to say WAIT.
 *
 * Every other screen in this app answers "which way". This one answers "now, or
 * later", and it is the harder product decision: an app that can only say "go"
 * pushes ninety thousand people into the same corridor in the same four minutes,
 * which is the single worst thing that happens at a circuit all weekend.
 *
 * Waiting only works if it is argued rather than asserted, so all three options
 * are priced the same way — door-to-car minutes, including the sitting — and the
 * recommendation is whichever number is smallest. If leaving now were quicker,
 * this screen would say leave now. It is also honest about what you spend the
 * time doing: twenty-two minutes with twelve of them sitting down beats thirty-one
 * with most of them standing on a staircase, and people know that when you tell
 * them.
 *
 * "Leave now" is always available. Someone with a train to catch is not being
 * irrational, and an app that hides the door is one people route around.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import type { LeaveOption, SpectatorView } from '../feed/types';
import { journeyText } from '../feed/time';
import { Body, Eyebrow, Headline, Label, StatusPill, Title } from '../ui/atoms';
import { CrossingLine } from '../ui/route';
import { Screen } from '../ui/screen';
import { usePalette } from '../ui/theme';

export function HoldScreen({
  view,
  onSelectOption,
}: {
  view: Extract<SpectatorView, { kind: 'hold' }>;
  onSelectOption?: (optionId: string) => void;
}) {
  // The crossing is the checkable fact behind the advice: the user can be told
  // to wait, and told what they are waiting for.
  const crossing = view.route.steps.find((s) => s.crossing)?.crossing ?? null;

  return (
    <Screen view={view}>
      <View style={{ gap: space.sm }}>
        <Eyebrow>Going to</Eyebrow>
        <Headline>{view.route.to}</Headline>
        <Title>{view.headline}</Title>
        <Body tone="soft">{view.because}</Body>
        {crossing ? (
          <View style={{ alignSelf: 'flex-start', paddingTop: space.xs }}>
            <CrossingLine crossing={crossing} now={view.now} />
          </View>
        ) : null}
      </View>

      <View style={{ gap: space.md }}>
        <Eyebrow>Your options, door to car</Eyebrow>
        {view.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            recommended={option.id === view.recommended_id}
            onPress={onSelectOption ? () => onSelectOption(option.id) : undefined}
          />
        ))}
      </View>
    </Screen>
  );
}

function OptionRow({
  option,
  recommended,
  onPress,
}: {
  option: LeaveOption;
  recommended: boolean;
  onPress?: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${option.label}, ${journeyText(option.total_s)} door to car. ${option.spent}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: recommended ? palette.surface : 'transparent',
          borderColor: recommended ? palette.ink : palette.line,
          borderWidth: recommended ? 2 : 1,
          opacity: pressed && onPress ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        <Headline>{option.label}</Headline>
        <Title>{journeyText(option.total_s)}</Title>
      </View>
      <Body tone="soft" style={{ fontSize: 16, lineHeight: 22 }}>
        {option.spent}
      </Body>
      <View style={styles.meta}>
        <StatusPill state={option.way_ahead} />
        {recommended && option.recommendation_note ? (
          <Label tone="soft" style={{ fontWeight: '600' }}>
            {option.recommendation_note}
          </Label>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    borderRadius: radius.lg,
    padding: space.md + space.xs,
    gap: space.sm,
    minHeight: 96,
    justifyContent: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
