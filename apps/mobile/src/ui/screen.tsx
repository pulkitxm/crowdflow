import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space } from '../theme';
import type { SpectatorView } from '../feed/types';
import { freshnessText } from '../feed/time';
import { Body, Eyebrow, Label } from './atoms';
import { useMetrics, useStep } from './responsive';
import { usePalette } from './theme';

export function Screen({
  view,
  children,
  footer,
}: {
  view: SpectatorView;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const palette = usePalette();
  const { gutter, maxContentWidth, wide, tiny } = useMetrics();
  const step = useStep();
  const frame = wide
    ? { width: '100%' as const, maxWidth: maxContentWidth, alignSelf: 'center' as const }
    : { width: '100%' as const };

  const freshness = view.link.online
    ? freshnessText(view.link.updated_at, view.now)
    : `No signal · ${freshnessText(view.link.updated_at, view.now).toLowerCase()}`;

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: palette.paper }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <View
        style={[
          styles.header,
          frame,
          {
            borderBottomColor: palette.line,
            paddingHorizontal: gutter,
            paddingTop: step(space.sm),
            paddingBottom: step(space.sm),
          },
          tiny ? styles.headerStack : null,
        ]}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Eyebrow>You're at</Eyebrow>
          <Body style={{ fontWeight: '600' }} numberOfLines={1}>
            {view.route.from}
          </Body>
        </View>
        <Label
          tone="soft"
          style={{ fontWeight: '500', fontSize: 13, textAlign: tiny ? 'left' : 'right' }}
          numberOfLines={1}
        >
          {freshness}
        </Label>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: gutter,
          gap: step(space.lg),
          paddingBottom: step(space.xl),
          ...frame,
        }}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        {children}
      </ScrollView>

      {footer ? (
        <View
          style={[
            styles.footer,
            frame,
            {
              borderTopColor: palette.line,
              paddingHorizontal: gutter,
              paddingTop: step(space.md),
              paddingBottom: step(space.sm),
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    borderBottomWidth: 1,
  },
  headerStack: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
  footer: { borderTopWidth: 1 },
});
