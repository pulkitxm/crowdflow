
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space } from '../theme';
import type { SpectatorView } from '../feed/types';
import { freshnessText } from '../feed/time';
import { Body, Eyebrow, Label } from './atoms';
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
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.paper }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: palette.line }]}>
        <Eyebrow>You're at</Eyebrow>
        <Body style={{ fontWeight: '600' }}>{view.route.from}</Body>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        {children}
      </ScrollView>

      {footer ? (
        <View style={[styles.footer, { borderTopColor: palette.line }]}>{footer}</View>
      ) : null}

      <View style={styles.freshness}>
        <Label tone="soft" style={{ fontSize: 13, fontWeight: '500' }}>
          {view.link.online
            ? freshnessText(view.link.updated_at, view.now)
            : `No signal · ${freshnessText(view.link.updated_at, view.now).toLowerCase()}`}
        </Label>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm + space.xs,
    borderBottomWidth: 1,
    gap: 2,
  },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: 1, gap: space.sm },
  freshness: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
});
