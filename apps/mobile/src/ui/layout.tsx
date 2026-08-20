/**
 * The structural vocabulary: a page, a section, a row, a chip.
 *
 * `atoms.tsx` owns what things LOOK like — six text sizes, a card, a status
 * pill, two buttons. This file owns how a screen is ASSEMBLED, and it exists
 * because every screen had been assembling itself: each one repeated the same
 * SafeAreaView, the same ScrollView, the same 24dp padding, the same sticky
 * footer, and each one had drifted a few pixels from the others. Six screens
 * with six slightly different paddings does not read as six screens, it reads as
 * an unfinished product — and the app's own design brief says beauty is a
 * functional requirement, because a spectator app nobody opens is a sensor
 * network with no sensors.
 *
 * Nothing here is decorative. `Page` guarantees the footer is reachable
 * one-handed. `ListRow` guarantees a 64dp target, because the brief's minimum is
 * 48 and this is pressed while walking. `MetaRow` puts a label and its value on
 * one baseline so a column of them can be scanned rather than read.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MIN_TOUCH, radius, space, type } from '../theme';
import { Body, Eyebrow, Label, Title } from './atoms';
import { usePalette } from './theme';

/**
 * The frame for any screen that is not live guidance.
 *
 * A back affordance, a title block, a scrolling body and an optional pinned
 * footer. The footer is pinned rather than placed at the end of the scroll
 * because the ask must be reachable without reading to the bottom — somebody
 * standing in a moving crowd should not have to scroll to continue.
 */
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
  /** One sentence under the title. Two is a paragraph, and a paragraph on a
   *  phone held at arm's length does not get read. */
  lede?: string;
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Off when the body is its own list, which scrolls itself. */
  scroll?: boolean;
}) {
  const palette = usePalette();
  const heading = eyebrow || title || lede || onBack ? (
    <View style={styles.heading}>
      {onBack ? (
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12} style={styles.back}>
          <Label tone="soft" style={{ fontWeight: '600' }}>{`‹  ${backLabel}`}</Label>
        </Pressable>
      ) : null}
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {title ? <Title>{title}</Title> : null}
      {lede ? <Body tone="soft">{lede}</Body> : null}
    </View>
  ) : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.paper }]} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          {heading}
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {heading ? <View style={styles.headingFixed}>{heading}</View> : null}
          {children}
        </View>
      )}
      {footer ? <View style={[styles.footer, { borderTopColor: palette.line }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** A labelled group. The label is a signpost, not a heading — small, quiet, and
 *  always followed by the thing it names. */
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
  return (
    <View style={[{ gap: space.sm }, style]}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      {children}
      {note ? <Body tone="soft" style={styles.note}>{note}</Body> : null}
    </View>
  );
}

/**
 * A label and its value, on one baseline.
 *
 * The value is right-aligned and tabular so a column of these can be scanned
 * down the numbers rather than read line by line — the same reason the operator
 * console is monospaced, applied to the four or five figures the app is willing
 * to show.
 */
export function MetaRow({ label, value, note, emphasis }: { label: string; value: string; note?: string; emphasis?: boolean }) {
  const palette = usePalette();
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.metaRow}>
        <Body tone="soft" style={{ flex: 1 }}>{label}</Body>
        <Body
          color={palette.ink}
          style={{
            fontWeight: emphasis ? '700' : '600',
            textAlign: 'right',
            flexShrink: 1,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </Body>
      </View>
      {note ? <Body tone="soft" style={styles.note}>{note}</Body> : null}
    </View>
  );
}

export type ChipTone = 'quiet' | 'strong' | 'warn';

/**
 * A short fact, boxed.
 *
 * Used for a round number, a country, whether a venue has a map. Never for a
 * status that carries meaning — that is `StatusPill`, which enforces the
 * word-plus-colour rule. A chip is a label, and a label may be quiet.
 */
export function Chip({ label, tone = 'quiet' }: { label: string; tone?: ChipTone }) {
  const palette = usePalette();
  const colors = tone === 'strong'
    ? { background: palette.actionFill, text: palette.actionText, border: palette.actionFill }
    : tone === 'warn'
      ? { background: palette.slowing.fill, text: palette.slowing.text, border: palette.slowing.edge }
      : { background: 'transparent', text: palette.inkSoft, border: palette.line };
  return (
    <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Body style={{ color: colors.text, fontSize: type.micro.size, lineHeight: type.micro.lineHeight, fontWeight: '700', letterSpacing: 0.6 }}>
        {label.toUpperCase()}
      </Body>
    </View>
  );
}

/**
 * One tappable row of a list.
 *
 * `lead` is a fixed-width slot so titles align down the list however wide the
 * badges are — a ragged left edge is what makes a list of races look like a
 * dump of data rather than a table of them. `disabled` still renders and still
 * explains itself: a row greyed out with no reason is a dead end.
 */
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? palette.surface : palette.paper,
          borderColor: selected ? palette.ink : palette.line,
          borderWidth: selected ? 2 : 1,
          opacity: pressed ? 0.75 : disabled ? 0.55 : 1,
        },
      ]}
    >
      {lead ? <View style={styles.lead}>{lead}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Body color={palette.ink} style={{ fontWeight: '700' }} numberOfLines={2}>{title}</Body>
        {subtitle ? <Label tone="soft" style={{ fontWeight: '500' }} numberOfLines={2}>{subtitle}</Label> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

/** A round number, in a fixed-width box. The one piece of F1 vocabulary the app
 *  borrows outright, because everybody at a circuit already reads it. */
export function RoundBadge({ round }: { round: number }) {
  const palette = usePalette();
  return (
    <View style={[styles.round, { borderColor: palette.line }]}>
      <Body tone="soft" style={{ fontSize: 11, lineHeight: 13, fontWeight: '700', letterSpacing: 0.8 }}>R</Body>
      <Body color={palette.ink} style={{ fontSize: 19, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {round}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  heading: { gap: space.xs },
  headingFixed: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md },
  back: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginBottom: space.xs },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: 1, gap: space.sm },
  note: { fontSize: 15, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.sm + space.xs,
    paddingVertical: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md - 2,
    minHeight: MIN_TOUCH + 16,
  },
  lead: { width: 44, alignItems: 'center' },
  trailing: { alignItems: 'flex-end', gap: 4 },
  round: {
    width: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    paddingVertical: 4,
  },
});
