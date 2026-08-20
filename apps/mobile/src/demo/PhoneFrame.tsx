
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const PHONE = { width: 390, height: 844 } as const;

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
  bezel: { body: string; screen: string; ink: string };
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
