import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MIN_TOUCH, fonts, radius, space } from '../theme';
import { Body, Eyebrow, Label, Title } from './atoms';
import { useMetrics, useStep, useTypeStyle } from './responsive';
import { usePalette } from './theme';

export function Page({
  eyebrow,
  title,
  lede,
  onBack,
  backLabel = 'Back',
  children,
  footer,
  scroll = true,
}: {
  eyebrow?: string;
  title?: string;
  lede?: string;
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
}) {
  const palette = usePalette();
  const { gutter, maxContentWidth, wide } = useMetrics();
  const step = useStep();

  const heading =
    eyebrow || title || lede || onBack ? (
      <View style={{ gap: step(space.xs) }}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={onBack}
            hitSlop={16}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Label tone="soft" style={{ fontWeight: '600' }}>{`‹  ${backLabel}`}</Label>
          </Pressable>
        ) : null}
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {title ? <Title>{title}</Title> : null}
        {lede ? <Body tone="soft">{lede}</Body> : null}
      </View>
    ) : null;

  const frame: ViewStyle = wide
    ? { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }
    : { width: '100%' };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: palette.paper }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: step(space.xl),
            gap: step(space.lg),
            ...frame,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
        >
          {heading}
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, frame]}>
          {heading ? (
            <View style={{ paddingHorizontal: gutter, paddingVertical: step(space.md) }}>
              {heading}
            </View>
          ) : null}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={[
            styles.footer,
            frame,
            {
              borderTopColor: palette.line,
              paddingHorizontal: gutter,
              paddingTop: step(space.md),
              gap: step(space.sm),
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Section({
  label,
  note,
  children,
  style,
}: {
  label?: string;
  note?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const step = useStep();
  return (
    <View style={[{ gap: step(space.sm) }, style]}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      {children}
      {note ? (
        <Body tone="soft" style={styles.note}>
          {note}
        </Body>
      ) : null}
    </View>
  );
}

export function MetaRow({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  const palette = usePalette();
  const { tiny } = useMetrics();
  return (
    <View style={{ gap: 2 }}>
      <View style={[styles.metaRow, tiny ? styles.metaStack : null]}>
        <Body tone="soft" style={tiny ? undefined : { flex: 1 }}>
          {label}
        </Body>
        <Body
          color={palette.ink}
          style={{
            fontWeight: emphasis ? '700' : '600',
            textAlign: tiny ? 'left' : 'right',
            flexShrink: 1,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </Body>
      </View>
      {note ? (
        <Body tone="soft" style={styles.note}>
          {note}
        </Body>
      ) : null}
    </View>
  );
}

export type ChipTone = 'quiet' | 'strong' | 'warn';

export function Chip({ label, tone = 'quiet' }: { label: string; tone?: ChipTone }) {
  const palette = usePalette();
  const spec = useTypeStyle('micro');
  const colors =
    tone === 'strong'
      ? { background: palette.actionFill, text: palette.actionText, border: palette.actionFill }
      : tone === 'warn'
        ? { background: palette.slowing.fill, text: palette.slowing.text, border: palette.slowing.edge }
        : { background: 'transparent', text: palette.inkSoft, border: palette.line };
  return (
    <View
      style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}
    >
      <Body
        numberOfLines={1}
        style={{
          color: colors.text,
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          fontWeight: '700',
          letterSpacing: spec.letterSpacing,
        }}
      >
        {label.toUpperCase()}
      </Body>
    </View>
  );
}

export function ListRow({
  lead,
  title,
  subtitle,
  trailing,
  selected,
  disabled,
  onPress,
}: {
  lead?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const palette = usePalette();
  const step = useStep();
  const { tiny } = useMetrics();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: MIN_TOUCH + step(space.md),
          gap: step(space.md),
          paddingHorizontal: step(space.md),
          paddingVertical: step(space.md) - 2,
          backgroundColor: selected ? palette.surface : palette.paper,
          borderColor: selected ? palette.ink : palette.line,
          borderWidth: selected ? 2 : 1,
          opacity: pressed ? 0.75 : disabled ? 0.55 : 1,
        },
      ]}
    >
      {lead && !tiny ? <View style={styles.lead}>{lead}</View> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body color={palette.ink} style={{ fontWeight: '700' }} numberOfLines={2}>
          {title}
        </Body>
        {subtitle ? (
          <Label tone="soft" style={{ fontWeight: '500' }} numberOfLines={2}>
            {subtitle}
          </Label>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

export function RoundBadge({ round }: { round: number }) {
  const palette = usePalette();
  const { typeScale } = useMetrics();
  return (
    <View style={[styles.round, { borderColor: palette.line, width: Math.round(44 * typeScale) }]}>
      <Body
        tone="soft"
        style={{
          fontSize: Math.round(11 * typeScale),
          lineHeight: Math.round(13 * typeScale),
          fontWeight: '700',
          letterSpacing: 0.8,
        }}
      >
        R
      </Body>
      <Body
        color={palette.ink}
        style={{
          fontSize: Math.round(19 * typeScale),
          lineHeight: Math.round(22 * typeScale),
          fontFamily: fonts.displayBold,
          fontVariant: ['tabular-nums'],
        }}
      >
        {round}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  footer: { borderTopWidth: 1 },
  note: { fontSize: 15, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  metaStack: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.sm + space.xs,
    paddingVertical: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md },
  lead: { width: 44, alignItems: 'center' },
  trailing: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  round: { borderWidth: 1, borderRadius: radius.sm, alignItems: 'center', paddingVertical: 4 },
});
