/**
 * Arrival: which gate to walk to.
 *
 * This is the cheapest intervention of the day and the only free one. Asked
 * before anyone has started walking, a gate choice costs the spectator nothing —
 * they have not committed to a direction yet — and spreading a few thousand
 * people across three gates flattens the arrival peak that causes most of the
 * day's queueing. Ten minutes later the same relief costs four minutes of
 * backtracking, and by then most people will refuse it.
 *
 * So the screen leads with the choice rather than with a route, and it is honest
 * that the nearest gate is the busiest: hiding that would make the nearest gate
 * look broken rather than popular, and people would still walk to it.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import type { GateChoice, SpectatorView } from '../feed/types';
import { journeyText } from '../feed/time';
import { Body, Card, Eyebrow, Headline, Label, StatusPill, Title } from '../ui/atoms';
import { Screen } from '../ui/screen';
import { usePalette } from '../ui/theme';

export function ArrivalScreen({
  view,
  onSelectGate,
}: {
  view: Extract<SpectatorView, { kind: 'arrival' }>;
  onSelectGate?: (zoneId: string) => void;
}) {
  return (
    <Screen view={view}>
      <View style={{ gap: space.sm }}>
        <Eyebrow>Going to</Eyebrow>
        <Title>{view.route.to}</Title>
        <Body tone="soft">{view.note}</Body>
      </View>

      <View style={{ gap: space.md }}>
        {view.gates.map((gate) => (
          <GateRow
            key={gate.zone_id}
            gate={gate}
            onPress={onSelectGate ? () => onSelectGate(gate.zone_id) : undefined}
          />
        ))}
      </View>

      <Card tone="outline">
        <Body tone="soft" style={{ fontSize: 16, lineHeight: 23 }}>
          Whichever you pick, we will keep you posted on the walk in.
        </Body>
      </Card>
    </Screen>
  );
}

function GateRow({ gate, onPress }: { gate: GateChoice; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={gate.selected ? { selected: true } : undefined}
      accessibilityLabel={`${gate.name}, ${journeyText(gate.walk_s)} walk`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.gate,
        {
          backgroundColor: palette.surface,
          borderColor: gate.selected ? palette.ink : 'transparent',
          borderWidth: gate.selected ? 2 : 0,
          opacity: pressed && onPress ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.gateHead}>
        <Headline>{gate.name}</Headline>
        <Title>{journeyText(gate.walk_s)}</Title>
      </View>
      <View style={styles.gateMeta}>
        <StatusPill state={gate.way_ahead} />
      </View>
      {gate.note ? (
        // On its own line, always: a note that sometimes sits beside the pill and
        // sometimes below it makes three cards scan as three different designs.
        <Label tone="soft" style={{ fontWeight: '500' }}>
          {gate.note}
        </Label>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gate: {
    borderRadius: radius.lg,
    padding: space.md + space.xs,
    gap: space.sm,
    // Comfortably above the 48dp floor: this is the day's most consequential tap
    // and it is made in a car park with a coat over one arm.
    minHeight: 96,
    justifyContent: 'center',
  },
  gateHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  gateMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
