
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
        <Headline numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>
          {option.label}
        </Headline>
        <Title numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
          {journeyText(option.total_s)}
        </Title>
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
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
