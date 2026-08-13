/**
 * The demo harness: a live clock, the six states of a race day, and a phone.
 *
 * Everything in this file is scaffolding. None of it ships to a spectator — the
 * product is `SpectatorApp`, which takes a view and renders a screen. The shell
 * exists so the whole day can be walked through in a browser without a backend,
 * and so that a reviewer can see both themes without changing their OS setting.
 *
 * The clock is real: countdowns on the crossing rows tick down while you watch,
 * because the feed carries absolute times rather than "closes in 8 minutes".
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { DAY, DAY_LABELS, DAY_ORDER, nowSeconds } from '../feed/mock';
import type { ViewKind } from '../feed/types';
import { SpectatorApp } from '../SpectatorApp';
import { palettes, radius, space, type ThemeName } from '../theme';
import { ThemeProvider } from '../ui/theme';
import { PHONE, PhoneFrame } from './PhoneFrame';

/** Wide enough to show a phone with a rail beside it rather than a stretched app. */
const DESKTOP_MIN_WIDTH = 940;

export function DemoShell() {
  const [kind, setKind] = useState<ViewKind>('arrival');
  const [theme, setTheme] = useState<ThemeName>('light');
  const now = useLiveClock();
  const { width, height } = useWindowDimensions();

  const view = useMemo(() => ({ ...DAY[kind], now }), [kind, now]);
  const palette = palettes[theme];
  const desktop = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;

  const app = (
    <ThemeProvider override={theme}>
      <SpectatorApp
        view={view}
        onAccept={() => setKind('rerouted')}
        onDecline={() => setKind('walk')}
        onUndo={() => setKind('walk')}
      />
    </ThemeProvider>
  );

  if (!desktop) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper }}>
        {app}
        <StateBar kind={kind} onPick={setKind} theme={theme} onTheme={setTheme} />
      </View>
    );
  }

  return (
    <View style={[styles.desk, { backgroundColor: theme === 'light' ? '#E7EBEC' : '#08090A' }]}>
      <View style={styles.deskInner}>
        <Rail kind={kind} onPick={setKind} theme={theme} onTheme={setTheme} />
        <PhoneFrame
          clock={DAY_LABELS[kind].when}
          online={view.link.online}
          // A 14" laptop is shorter than an iPhone is tall once the browser
          // chrome is counted, so the frame gives up height rather than letting
          // the screen run off the bottom of the page.
          height={Math.min(PHONE.height, height - 2 * space.xl - 24)}
          bezel={{
            body: theme === 'light' ? '#C7CFD1' : '#1A1E20',
            screen: palette.paper,
            ink: palette.ink,
          }}
        >
          <View style={{ width: PHONE.width, flex: 1 }}>{app}</View>
        </PhoneFrame>
      </View>
    </View>
  );
}

/**
 * Ticks once a second. Fast enough that a countdown feels live, slow enough that
 * nothing on screen flickers — the app only ever renders whole minutes.
 */
function useLiveClock(): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const id = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Rail({
  kind,
  onPick,
  theme,
  onTheme,
}: {
  kind: ViewKind;
  onPick: (k: ViewKind) => void;
  theme: ThemeName;
  onTheme: (t: ThemeName) => void;
}) {
  const ink = theme === 'light' ? '#0E1213' : '#F3F6F6';
  const soft = theme === 'light' ? '#5C6668' : '#98A2A4';
  const chip = theme === 'light' ? '#FFFFFF' : '#161A1B';

  return (
    <View style={styles.rail}>
      <View style={{ gap: space.xs }}>
        <Text style={[styles.railKicker, { color: soft }]}>CROWDFLOW · SPECTATOR</Text>
        <Text style={[styles.railTitle, { color: ink }]}>One job: where to walk next.</Text>
        <Text style={[styles.railNote, { color: soft }]}>
          Six states of a race day. The clock is live, so crossing countdowns move.
        </Text>
      </View>

      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm }}>
        {DAY_ORDER.map((k, index) => {
          const active = k === kind;
          return (
            <Pressable
              key={k}
              onPress={() => onPick(k)}
              style={[
                styles.railItem,
                { backgroundColor: active ? ink : chip, borderColor: active ? ink : 'transparent' },
              ]}
            >
              <Text style={[styles.railIndex, { color: active ? chip : soft }]}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.railItemTitle, { color: active ? chip : ink }]}>
                  {DAY_LABELS[k].title}
                </Text>
                <Text style={[styles.railItemWhen, { color: active ? chip : soft }]}>
                  {DAY_LABELS[k].when}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.themeRow}>
        {(['light', 'dark'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => onTheme(t)}
            style={[
              styles.themeChip,
              { backgroundColor: theme === t ? ink : chip, borderColor: theme === t ? ink : 'transparent' },
            ]}
          >
            <Text style={[styles.themeLabel, { color: theme === t ? chip : soft }]}>
              {t === 'light' ? 'Daylight' : 'Night'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The same switcher on a phone, kept deliberately ugly so it reads as a tool. */
function StateBar({
  kind,
  onPick,
  theme,
  onTheme,
}: {
  kind: ViewKind;
  onPick: (k: ViewKind) => void;
  theme: ThemeName;
  onTheme: (t: ThemeName) => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barInner}>
        {DAY_ORDER.map((k) => (
          <Pressable
            key={k}
            onPress={() => onPick(k)}
            style={[styles.barChip, { backgroundColor: k === kind ? '#FFFFFF' : 'transparent' }]}
          >
            <Text style={[styles.barLabel, { color: k === kind ? '#0E1213' : '#C7CFD1' }]}>
              {DAY_LABELS[k].title}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => onTheme(theme === 'light' ? 'dark' : 'light')}
          style={[styles.barChip, { borderColor: '#3A4143', borderWidth: 1 }]}
        >
          <Text style={[styles.barLabel, { color: '#C7CFD1' }]}>
            {theme === 'light' ? 'Night' : 'Daylight'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  desk: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  deskInner: { flexDirection: 'row', gap: space.xxl, alignItems: 'center' },
  rail: { width: 300, gap: space.lg },
  railKicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  railTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, lineHeight: 34 },
  railNote: { fontSize: 14, lineHeight: 20 },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  railIndex: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  railItemTitle: { fontSize: 16, fontWeight: '600' },
  railItemWhen: { fontSize: 13 },
  themeRow: { flexDirection: 'row', gap: space.sm },
  themeChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  themeLabel: { fontSize: 13, fontWeight: '600' },
  bar: { backgroundColor: '#0E1213' },
  barInner: { padding: space.sm, gap: space.sm, alignItems: 'center' },
  barChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
  barLabel: { fontSize: 13, fontWeight: '600' },
});
