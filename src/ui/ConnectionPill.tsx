import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ConnectivityState } from '../core/contracts';
import { colors } from './theme';

export function ConnectionPill({ state }: { state: ConnectivityState }) {
  const details: Record<ConnectivityState, [string, string]> = {
    online: ['ONLINE', colors.moss], restored: ['RESTORED', colors.lime],
    'local-only': ['OFFLINE · LOCAL', colors.amber], starting: ['STARTING', colors.muted],
    stopped: ['STOPPED', colors.muted], error: ['CHECK NODE', colors.signal],
  };
  const [label, color] = details[state];
  return <View style={[styles.pill, { backgroundColor: `${color}20` }]}>
    <View style={[styles.dot, { backgroundColor: color }]} /><Text style={[styles.label, { color }]}>{label}</Text>
  </View>;
}
const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 30, paddingHorizontal: 10, paddingVertical: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  label: { fontWeight: '900', fontSize: 10, letterSpacing: .6 },
});
