/**
 * The parts that describe a walk: the headline number, the list of legs, and a
 * crossing's timetable.
 *
 * The list of legs is the closest thing this app has to a map, and that is on
 * purpose. A map of a venue you have never been to, held at arm's length in a
 * crowd, is a puzzle to solve; a list of the three places you will pass, in
 * order, is an instruction you can follow without stopping. It also cannot leak
 * where anybody else is standing, which a map inevitably starts to.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import type { CrossingNotice, Route, Step, WayAhead } from '../feed/types';
import { CROSSING_WORDS, UNKNOWN_NOTE, WAY_AHEAD_ROUTE_SENTENCE } from '../feed/words';
import { journeyText, untilText } from '../feed/time';
import { worstOf } from '../feed/severity';
import { Body, Display, Eyebrow, Headline, Label, StatusPill, statusColors } from './atoms';
import { usePalette } from './theme';

/**
 * The single most important thing on the screen: where you are going and how
 * many minutes away it is. Everything else on any screen is subordinate to this,
 * including whatever the system wants to tell you.
 */
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

/** Re-exported so screens import their route vocabulary from one place. */
export { worstOf };

export function StepList({
  steps,
  now,
  struck = false,
  highlightId,
}: {
  steps: Step[];
  now: number;
  /** Renders the legs as abandoned — used for the route a redirect replaced. */
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

/**
 * A crossing's timetable, in words.
 *
 * Absolute times arrive on the wire, so this keeps counting down correctly when
 * the phone has not heard from anyone in ten minutes — which is exactly when a
 * spectator standing at a closed bridge most wants to know.
 */
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
    // A rectangle, not a pill: a long crossing name wraps to two lines and a
    // stadium shape around two lines of text reads as a mistake.
    borderRadius: radius.sm,
    paddingHorizontal: space.sm + space.xs,
    paddingVertical: space.xs,
  },
});
