import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import type { CrossingNotice, Route, Step, WayAhead } from '../feed/types';
import { CROSSING_WORDS, UNKNOWN_NOTE, WAY_AHEAD_ROUTE_SENTENCE } from '../feed/words';
import { journeyText, untilText } from '../feed/time';
import { worstOf } from '../feed/severity';
import { Body, Display, Eyebrow, Headline, Label, StatusPill, statusColors } from './atoms';
import { useMetrics, useStep } from './responsive';
import { usePalette } from './theme';

export function Hero({ route, state }: { route: Route; state: WayAhead }) {
  const step = useStep();
  const { tiny } = useMetrics();
  return (
    <View style={{ gap: step(space.xs) }}>
      <Eyebrow>Going to</Eyebrow>
      <Headline numberOfLines={2}>{route.to}</Headline>
      <View style={[styles.heroRow, tiny ? styles.heroStack : null]}>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Display numberOfLines={1} shrinkToFit style={{ fontVariant: ['tabular-nums'] }}>
            {journeyText(route.total_walk_s)}
          </Display>
        </View>
        <View style={{ paddingBottom: tiny ? 0 : space.sm }}>
          <StatusPill state={state} big />
        </View>
      </View>
      <Body tone="soft">{WAY_AHEAD_ROUTE_SENTENCE[state]}</Body>
    </View>
  );
}

export { worstOf };

export function StepList({
  steps,
  now,
  struck = false,
  highlightId,
}: {
  steps: Step[];
  now: number;
  struck?: boolean;
  highlightId?: string;
}) {
  const palette = usePalette();
  const step = useStep();
  return (
    <View>
      {steps.map((item, index) => {
        const last = index === steps.length - 1;
        const highlighted = item.id === highlightId;
        const colors = statusColors(item.way_ahead, palette);
        const inset = step(space.sm + space.xs);
        return (
          <View key={item.id} style={[styles.stepRow, { gap: step(space.md) }]}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: struck ? palette.line : colors.edge,
                    borderColor: struck ? palette.line : colors.text,
                  },
                ]}
              />
              {!last ? <View style={[styles.railLine, { backgroundColor: palette.line }]} /> : null}
            </View>

            <View
              style={[
                styles.stepBody,
                { paddingBottom: step(space.md), gap: step(space.sm) },
                highlighted
                  ? {
                      backgroundColor: colors.fill,
                      borderRadius: radius.md,
                      paddingHorizontal: inset,
                      marginLeft: -inset,
                    }
                  : null,
              ]}
            >
              <View style={[styles.stepHead, { gap: step(space.sm) }]}>
                <Label
                  tone={struck ? 'soft' : 'ink'}
                  numberOfLines={2}
                  style={
                    struck
                      ? { textDecorationLine: 'line-through', flex: 1 }
                      : { fontSize: 18, lineHeight: 24, fontWeight: '700', flex: 1 }
                  }
                >
                  {item.to}
                </Label>
                <Label
                  tone="soft"
                  numberOfLines={1}
                  style={
                    struck
                      ? { textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }
                      : { fontVariant: ['tabular-nums'] }
                  }
                >
                  {journeyText(item.walk_s)}
                </Label>
              </View>

              {!struck ? (
                <View style={[styles.stepMeta, { gap: step(space.sm) }]}>
                  <StatusPill state={item.way_ahead} />
                  {item.crossing ? <CrossingLine crossing={item.crossing} now={now} /> : null}
                </View>
              ) : null}

              {!struck && item.way_ahead === 'unknown' ? (
                <Body tone="soft" style={{ fontSize: 15, lineHeight: 21 }}>
                  {UNKNOWN_NOTE}
                </Body>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function CrossingLine({ crossing, now }: { crossing: CrossingNotice; now: number }) {
  const palette = usePalette();
  const text = crossing.state.open
    ? crossing.state.closes_at === null
      ? CROSSING_WORDS.openUnknown
      : CROSSING_WORDS.openUntil(untilText(crossing.state.closes_at, now))
    : crossing.state.opens_at === null
      ? CROSSING_WORDS.closedUnknown
      : CROSSING_WORDS.closedUntil(untilText(crossing.state.opens_at, now));

  return (
    <View style={[styles.crossing, { borderColor: palette.line }]}>
      <Label tone="soft" numberOfLines={2} style={{ fontSize: 14, fontWeight: '500' }}>
        {crossing.name} · {text}
      </Label>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  heroStack: { flexDirection: 'column', alignItems: 'flex-start' },
  stepRow: { flexDirection: 'row' },
  rail: { alignItems: 'center', width: 14, paddingTop: 6 },
  dot: { width: 14, height: 14, borderRadius: radius.pill, borderWidth: 2 },
  railLine: { width: 2, flex: 1, marginVertical: 4 },
  stepBody: { flex: 1, minWidth: 0, paddingTop: 2 },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stepMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  crossing: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm + space.xs,
    paddingVertical: space.xs,
    flexShrink: 1,
  },
});
