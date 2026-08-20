
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
    minHeight: 96,
    justifyContent: 'center',
  },
  gateHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  gateMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
