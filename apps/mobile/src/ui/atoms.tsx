import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MIN_TOUCH, PRIMARY_ACTION_HEIGHT, fonts, radius, space, type } from '../theme';
import type { WayAhead } from '../feed/types';
import { WAY_AHEAD_WORD } from '../feed/words';
import { useMetrics, useStep, useTypeStyle } from './responsive';
import { usePalette } from './theme';

type TextTone = 'ink' | 'soft';

const DISPLAY_FACES: Record<string, string> = {
  '400': fonts.displaySemi,
  '500': fonts.displaySemi,
  '600': fonts.displaySemi,
  '700': fonts.displayBold,
  '800': fonts.displayBold,
  '900': fonts.displayBold,
  bold: fonts.displayBold,
  normal: fonts.displaySemi,
};

const BODY_FACES: Record<string, string> = {
  '100': fonts.bodyRegular,
  '200': fonts.bodyRegular,
  '300': fonts.bodyRegular,
  '400': fonts.bodyRegular,
  '500': fonts.bodyMedium,
  '600': fonts.bodySemi,
  '700': fonts.bodyBold,
  '800': fonts.bodyBold,
  '900': fonts.bodyBold,
  bold: fonts.bodyBold,
  normal: fonts.bodyRegular,
};

function isDisplayFace(family: string): boolean {
  return family === fonts.displaySemi || family === fonts.displayBold;
}

function faceFor(baseFamily: string, weight: TextStyle['fontWeight']): string {
  if (!weight) return baseFamily;
  const table = isDisplayFace(baseFamily) ? DISPLAY_FACES : BODY_FACES;
  return table[String(weight)] ?? baseFamily;
}

function toneColor(tone: TextTone, palette: ReturnType<typeof usePalette>) {
  return tone === 'soft' ? palette.inkSoft : palette.ink;
}

interface TypeProps {
  children: React.ReactNode;
  tone?: TextTone;
  color?: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  shrinkToFit?: boolean;
  accessibilityLabel?: string;
}

function make(variant: keyof typeof type) {
  return function Variant({
    children,
    tone = 'ink',
    color,
    style,
    numberOfLines,
    shrinkToFit,
    accessibilityLabel,
  }: TypeProps) {
    const palette = usePalette();
    const spec = useTypeStyle(variant);
    const { typeScale } = useMetrics();
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const { fontWeight, ...rest } = flat;
    const family =
      typeof rest.fontFamily === 'string'
        ? rest.fontFamily
        : faceFor(spec.fontFamily, fontWeight);
    const size =
      typeof rest.fontSize === 'number' ? Math.round(rest.fontSize * typeScale) : spec.fontSize;
    const height =
      typeof rest.lineHeight === 'number'
        ? Math.round(rest.lineHeight * typeScale)
        : spec.lineHeight;

    return (
      <Text
        accessibilityLabel={accessibilityLabel}
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={shrinkToFit}
        minimumFontScale={shrinkToFit ? 0.75 : undefined}
        maxFontSizeMultiplier={spec.maxFontSizeMultiplier}
        style={[
          {
            letterSpacing: spec.letterSpacing,
            color: color ?? toneColor(tone, palette),
          },
          rest,
          { fontFamily: family, fontSize: size, lineHeight: height },
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

export function Eyebrow({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  const spec = useTypeStyle('micro');
  return (
    <Text
      maxFontSizeMultiplier={spec.maxFontSizeMultiplier}
      style={{
        fontSize: spec.fontSize,
        lineHeight: spec.lineHeight,
        fontFamily: spec.fontFamily,
        letterSpacing: spec.letterSpacing,
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
  const step = useStep();
  return (
    <View
      style={[
        { borderRadius: radius.lg, padding: step(space.md + space.xs) },
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

export function StatusPill({ state, big = false }: { state: WayAhead; big?: boolean }) {
  const palette = usePalette();
  const colors = statusColors(state, palette);
  const spec = useTypeStyle(big ? 'label' : 'micro');
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
        maxFontSizeMultiplier={spec.maxFontSizeMultiplier}
        style={{
          color: colors.text,
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          fontFamily: big ? fonts.bodyBold : spec.fontFamily,
          letterSpacing: big ? 0.2 : spec.letterSpacing,
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

export type ActionState = 'ready' | 'busy' | 'done' | 'problem';

export function PrimaryAction({
  label,
  cost,
  onPress,
  state = 'ready',
  disabled = false,
}: {
  label: string;
  cost?: string;
  onPress?: () => void;
  state?: ActionState;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const step = useStep();
  const labelSpec = useTypeStyle('headline');
  const costSpec = useTypeStyle('label');
  const inert = disabled || state === 'busy' || !onPress;
  const surface =
    state === 'problem'
      ? palette.backingUp.text
      : state === 'done'
        ? palette.clear.text
        : palette.actionFill;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cost ? `${label}, ${cost}` : label}
      accessibilityState={{ disabled: inert, busy: state === 'busy' }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        {
          minHeight: Math.max(PRIMARY_ACTION_HEIGHT, step(PRIMARY_ACTION_HEIGHT)),
          backgroundColor: surface,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !inert ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={styles.primaryRow}>
        {state === 'busy' ? (
          <ActivityIndicator color={palette.actionText} style={{ marginRight: space.sm }} />
        ) : null}
        <Text
          maxFontSizeMultiplier={labelSpec.maxFontSizeMultiplier}
          numberOfLines={2}
          style={{
            color: palette.actionText,
            fontSize: labelSpec.fontSize,
            lineHeight: labelSpec.lineHeight,
            fontFamily: fonts.displayBold,
            textAlign: 'center',
            flexShrink: 1,
          }}
        >
          {label}
        </Text>
      </View>
      {cost ? (
        <Text
          maxFontSizeMultiplier={costSpec.maxFontSizeMultiplier}
          numberOfLines={1}
          style={{
            color: palette.actionText,
            fontSize: costSpec.fontSize,
            lineHeight: costSpec.lineHeight,
            fontFamily: fonts.bodyMedium,
            opacity: 0.85,
          }}
        >
          {cost}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SecondaryAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const step = useStep();
  const spec = useTypeStyle('body');
  const inert = disabled || !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        {
          minHeight: Math.max(MIN_TOUCH, step(MIN_TOUCH)),
          borderColor: pressed ? palette.ink : palette.line,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={spec.maxFontSizeMultiplier}
        numberOfLines={2}
        style={{
          color: palette.ink,
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          fontFamily: fonts.bodySemi,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  primary: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 2,
  },
  primaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + space.xs,
  },
});
