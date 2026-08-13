/**
 * A phone-shaped window, for looking at a phone app on a laptop.
 *
 * Demo scaffolding, not product. It exists because the people who decide whether
 * this ships will mostly meet it in a browser on a desk, and a full-bleed desktop
 * rendering of a one-handed outdoor app misrepresents it in both directions: the
 * type looks enormous and the constraint that produced it is invisible.
 *
 * On a real device the frame is not drawn at all — the phone is the frame.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** iPhone 15 logical points. A real size, so the layout is judged at real size. */
export const PHONE = { width: 390, height: 844 } as const;

/**
 * Simulated safe-area insets. On web the real insets are zero, so without these
 * the status-bar strip and the home indicator would not be reserved and the
 * desktop rendering would be subtly roomier than the device.
 */
const INSET_TOP = 20;
const INSET_BOTTOM = 12;

export function PhoneFrame({
  children,
  clock,
  online,
  bezel,
  height = PHONE.height,
}: {
  children: React.ReactNode;
  clock: string;
  online: boolean;
  /** Matches the app's theme so the hardware does not glow white in dark mode. */
  bezel: { body: string; screen: string; ink: string };
  /** Shortened on a laptop screen too small for a real phone. */
  height?: number;
}) {
  return (
    <View style={[styles.body, { backgroundColor: bezel.body, height: height + 24 }]}>
      <View style={[styles.screen, { backgroundColor: bezel.screen }]}>
        <View style={[styles.statusBar, { paddingTop: INSET_TOP }]}>
          <Text style={[styles.statusText, { color: bezel.ink }]}>{clock}</Text>
          <Text style={[styles.statusText, { color: bezel.ink }]}>
            {online ? 'LTE' : 'No service'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
        <View style={{ height: INSET_BOTTOM, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[styles.homeIndicator, { backgroundColor: bezel.ink, opacity: 0.35 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    width: PHONE.width + 24,
    borderRadius: 58,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 24 },
  },
  screen: {
    flex: 1,
    borderRadius: 46,
    overflow: 'hidden',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingBottom: 4,
  },
  statusText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  homeIndicator: { width: 128, height: 5, borderRadius: 3 },
});
