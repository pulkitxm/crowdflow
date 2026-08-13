/**
 * The whole visual vocabulary of the app: six text sizes, a card, a status pill
 * and two kinds of button. Deliberately small. A spectator screen that needs a
 * seventh component is usually a screen that has started explaining itself.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { MIN_TOUCH, PRIMARY_ACTION_HEIGHT, radius, space, type } from '../theme';
import type { WayAhead } from '../feed/types';
import { WAY_AHEAD_WORD } from '../feed/words';
import { usePalette } from './theme';

type TextTone = 'ink' | 'soft';

function toneColor(tone: TextTone, palette: ReturnType<typeof usePalette>) {
  return tone === 'soft' ? palette.inkSoft : palette.ink;
}

interface TypeProps {
  children: React.ReactNode;
  tone?: TextTone;
  color?: string;
  style?: object;
  numberOfLines?: number;
}

function make(variant: keyof typeof type) {
  const spec = type[variant];
  return function Variant({ children, tone = 'ink', color, style, numberOfLines }: TypeProps) {
    const palette = usePalette();
    return (
      <Text
        numberOfLines={numberOfLines}
        style={[
          {
            fontSize: spec.size,
            lineHeight: spec.lineHeight,
            fontWeight: spec.weight,
            letterSpacing: spec.letterSpacing,
            color: color ?? toneColor(tone, palette),
          },
          style,
        ]}
      >
        {children}
      </Text>
    );
  };
}

export const Display = make('display');
export const Title = make('title');
export const Headline = make('headline');
export const Body = make('body');
export const Label = make('label');

/**
 * The small all-caps line above a fact ("YOU'RE AT"). It is a label, not a
 * heading: it tells you what kind of thing the next line is, then gets out of
 * the way, which is why it is the one place uppercase is allowed.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <Text
      style={{
        fontSize: type.micro.size,
        lineHeight: type.micro.lineHeight,
        fontWeight: type.micro.weight,
        letterSpacing: type.micro.letterSpacing,
        textTransform: 'uppercase',
        color: palette.inkSoft,
      }}
    >
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
  tone = 'surface',
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  tone?: 'surface' | 'outline';
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.card,
        tone === 'surface'
          ? { backgroundColor: palette.surface }
          : { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: palette.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The state of the way ahead, as a word.
 *
 * The word is the component; the colour is an accelerant. Under direct sun a
 * phone screen loses most of its saturation, and a fifth of the male audience
 * cannot separate the amber from the green anyway — so this never ships as a
 * bare dot, and the word is never abbreviated.
 */
export function StatusPill({ state, big = false }: { state: WayAhead; big?: boolean }) {
  const palette = usePalette();
  const colors = statusColors(state, palette);
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: colors.fill,
          borderColor: colors.edge,
          paddingVertical: big ? space.sm : space.xs,
          paddingHorizontal: big ? space.md : space.sm + space.xs,
        },
      ]}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: big ? type.label.size : type.micro.size,
          lineHeight: big ? type.label.lineHeight : type.micro.lineHeight,
          fontWeight: '700',
          letterSpacing: 0.2,
        }}
      >
        {WAY_AHEAD_WORD[state]}
      </Text>
    </View>
  );
}

export function statusColors(state: WayAhead, palette: ReturnType<typeof usePalette>) {
  switch (state) {
    case 'nominal':
      return palette.clear;
    case 'building':
      return palette.slowing;
    case 'critical':
      return palette.backingUp;
    case 'unknown':
      return palette.unknown;
  }
}

/**
 * The one action a screen asks for.
 *
 * `cost` is not decoration: the honest price of a redirect has to be readable
 * before the finger lands, so it is rendered inside the target as a second line
 * rather than in a confirmation dialog after the fact.
 */
export function PrimaryAction({
  label,
  cost,
  onPress,
}: {
  label: string;
  cost?: string;
  onPress?: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cost ? `${label}, ${cost}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: palette.actionFill, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.primaryLabel, { color: palette.actionText }]}>{label}</Text>
      {cost ? (
        <Text style={[styles.primaryCost, { color: palette.actionText }]}>{cost}</Text>
      ) : null}
    </Pressable>
  );
}

export function SecondaryAction({ label, onPress }: { label: string; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        { borderColor: palette.line, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.secondaryLabel, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.md + space.xs,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  primary: {
    minHeight: PRIMARY_ACTION_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 2,
  },
  primaryLabel: {
    fontSize: type.headline.size,
    lineHeight: type.headline.lineHeight,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryCost: {
    fontSize: type.label.size,
    lineHeight: type.label.lineHeight,
    fontWeight: '600',
    opacity: 0.85,
  },
  secondary: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + space.xs,
  },
  secondaryLabel: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: '600',
  },
});
