
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import type { CrossingNotice, Route, Step, WayAhead } from '../feed/types';
import { CROSSING_WORDS, UNKNOWN_NOTE, WAY_AHEAD_ROUTE_SENTENCE } from '../feed/words';
import { journeyText, untilText } from '../feed/time';
import { worstOf } from '../feed/severity';
import { Body, Display, Eyebrow, Headline, Label, StatusPill, statusColors } from './atoms';
import { usePalette } from './theme';

export function Hero({ route, state }: { route: Route; state: WayAhead }) {
  return (
    <View style={{ gap: space.xs }}>
      <Eyebrow>Going to</Eyebrow>
      <Headline>{route.to}</Headline>
      <View style={styles.heroRow}>
        <Display>{journeyText(route.total_walk_s)}</Display>
        <View style={{ paddingBottom: space.sm }}>
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
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const highlighted = step.id === highlightId;
        const colors = statusColors(step.way_ahead, palette);
        return (
          <View key={step.id} style={styles.stepRow}>
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
              {!last ? (
                <View style={[styles.railLine, { backgroundColor: palette.line }]} />
              ) : null}
            </View>

            <View
              style={[
                styles.stepBody,
                highlighted
                  ? {
                      backgroundColor: colors.fill,
                      borderRadius: radius.md,
                      paddingHorizontal: space.sm + space.xs,
                      marginLeft: -(space.sm + space.xs),
                    }
                  : null,
              ]}
            >
              <View style={styles.stepHead}>
                <Label
                  tone={struck ? 'soft' : 'ink'}
                  style={
                    struck ? { textDecorationLine: 'line-through' } : { fontSize: 18, lineHeight: 24 }
                  }
                >
                  {step.to}
                </Label>
                <Label tone="soft" style={struck ? { textDecorationLine: 'line-through' } : undefined}>
                  {journeyText(step.walk_s)}
                </Label>
              </View>

              {!struck ? (
                <View style={styles.stepMeta}>
                  <StatusPill state={step.way_ahead} />
                  {step.crossing ? <CrossingLine crossing={step.crossing} now={now} /> : null}
                </View>
              ) : null}

              {!struck && step.way_ahead === 'unknown' ? (
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
      <Label tone="soft" style={{ fontSize: 14 }}>
        {crossing.name} · {text}
      </Label>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  stepRow: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 14, paddingTop: 6 },
  dot: { width: 14, height: 14, borderRadius: radius.pill, borderWidth: 2 },
  railLine: { width: 2, flex: 1, marginVertical: 4 },
  stepBody: { flex: 1, paddingBottom: space.md, gap: space.sm, paddingTop: 2 },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  stepMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  crossing: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm + space.xs,
    paddingVertical: space.xs,
  },
});
